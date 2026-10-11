// Offline by default (prints the request count); --paid runs Jev on the spike's 6 videos and scores against gold.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseJson3 } from './lib/captions.js';
import { analyzeVideo } from './lib/pipeline.js';
import { buildRequests } from './lib/prompt.js';
import { makeChunks } from './lib/chunks.js';
import { callJev } from './lib/jev.js';
import { reserve, settle, markFailed, spentOn } from './lib/budget.js';

const SPIKE = new URL('../youtube-sponsor-spike/', import.meta.url);
const ROOT_ENV = new URL('../../.env', import.meta.url);
const LEDGER = new URL('./eval-ledger.json', import.meta.url);
const LIMIT_USD = 0.10, DAY = 'eval';
const paid = process.argv.includes('--paid');

const gold = JSON.parse(readFileSync(new URL('gold.json', SPIKE)));
const dataset = JSON.parse(readFileSync(new URL('dataset.json', SPIKE)));
const sha = Object.fromEntries(dataset.map((r) => [r.video, r.source_sha256]));
const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

const videos = Object.keys(gold).map((vid) => {
  const raw = readFileSync(new URL(`subs/${vid}.ru.json3`, SPIKE));
  if (createHash('sha256').update(raw).digest('hex') !== sha[vid]) throw new Error('source_changed:' + vid);
  return { vid, lines: parseJson3(JSON.parse(raw)) };
});

if (!paid) {
  const n = videos.reduce((s, v) => s + buildRequests(makeChunks(v.lines)).length, 0);
  console.log(`Offline: ${videos.length} videos, ${n} first-pass requests (+1 per found segment); limit $${LIMIT_USD}; no network.`);
  process.exit(0);
}

const env = readFileSync(ROOT_ENV, 'utf8');
const key = (env.match(/^\s*(?:export\s+)?(?:OPENROUTER_API_KEY|TYPESAFE_API_KEY)\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!key || !key.startsWith('sk-or-')) throw new Error('Expected an OpenRouter key; value not printed');
let ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER)) : { entries: [] };
const saveLedger = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
let seq = ledger.entries.length;
const ask = async (payload) => {
  const id = `r${++seq}`;
  ledger = reserve(ledger, { id, day: DAY, limitUsd: LIMIT_USD }); saveLedger();
  try {
    const { probs, cost } = await callJev(payload, { key });
    ledger = settle(ledger, id, cost); saveLedger();
    return probs;
  } catch (e) {
    ledger = markFailed(ledger, id, String(e.message || e).replaceAll(key, '[REDACTED]')); saveLedger();
    throw e;
  }
};

const tot = { ad: 0, missed: 0, wrong: 0, perVideoWrong: [] };
for (const { vid, lines } of videos) {
  let r;
  try {
    r = await analyzeVideo({ lines, ask, concurrency: 1 }); // sequential: in-flight reservations must not hit the limit
  } catch (e) {
    console.log(`${vid}: stopped (${e.message}); spent so far $${spentOn(ledger, DAY)}`);
    process.exitCode = 1;
    break;
  }
  const truth = gold[vid].filter((g) => !/^(rejected|ambiguous)/.test(g.verdict));
  const amb = gold[vid].filter((g) => g.verdict.startsWith('ambiguous'));
  const ad = truth.reduce((s, t) => s + t.end - t.start, 0);
  const caught = truth.reduce((s, t) => s + r.segments.reduce((x, p) => x + overlap(t, p), 0), 0);
  const ambHit = amb.reduce((s, a) => s + r.segments.reduce((x, p) => x + overlap(a, p), 0), 0);
  const wrong = r.segments.reduce((s, p) => s + p.end - p.start, 0) - caught - ambHit;
  tot.ad += ad; tot.missed += ad - caught; tot.wrong += wrong; tot.perVideoWrong.push(wrong);
  console.log(`${vid}: ${r.complete ? '' : '(incomplete) '}skips ${r.segments.map((s) => `${s.start.toFixed(0)}-${s.end.toFixed(0)}`).join(', ') || '—'}; `
    + `missed ${(ad - caught).toFixed(0)}/${ad.toFixed(0)}s, content skipped ${wrong.toFixed(0)}s, ${r.requests} requests`);
}
const recall = 1 - tot.missed / tot.ad;
console.log(JSON.stringify({ recall: +recall.toFixed(3), wrongSkipSec: +tot.wrong.toFixed(1), maxWrongPerVideo: +Math.max(...tot.perVideoWrong).toFixed(1), spentUsd: spentOn(ledger, DAY) }));
console.log(recall >= 0.9 && Math.max(...tot.perVideoWrong) <= 15 ? 'PASS (spec section 1)' : 'FAIL (spec section 1)');
