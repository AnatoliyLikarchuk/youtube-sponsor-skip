import { parseJson3 } from './lib/captions.js';
import { analyzeVideo } from './lib/pipeline.js';
import { ModelMismatch, AuthError, EXPECTED_MODEL } from './lib/jev.js';
import { PROMPT_VERSION } from './lib/prompt.js';
import { spentOn, today, BudgetExceeded } from './lib/budget.js';
import { getEntry, putEntry } from './lib/cache.js';
import { DEFAULT_SETTINGS } from './lib/settings.js';
import { createStore } from './lib/store.js';
import { makeAsk } from './lib/ask.js';
import { gate } from './lib/gate.js';
import { once } from './lib/once.js';
import { summarize } from './lib/summary.js';

// Spec §4: content scripts must never be able to read the key from storage.
// Chrome-only API; Safari lacks it, and a sync TypeError here would kill the whole service worker.
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});

const store = createStore(chrome.storage.local);
const CACHE_VERSION = `${PROMPT_VERSION}|${EXPECTED_MODEL}`;
const BADGES = { partial: '~', no_captions: 'CC', no_key: 'KEY', disabled: '!', budget: '$', error: 'ERR', busy: '…', paused: 'II' };
const inflight = new Map(); // videoId -> Promise, so tabs/reloads share one paid analysis

const settings = async () => ({ ...DEFAULT_SETTINGS, ...(await store.get('settings', {})) });
const spentToday = async () => spentOn(await store.get('budget', { entries: [] }), today());

// Per-tab state for the popup and tooltip lives in session storage (cleared when the browser closes).
const tabKey = (tabId) => `tab:${tabId}`;
const getTab = async (tabId) => (await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] || null;

function badgeFor(state, paused) {
  if (state && (state.status === 'ok' || state.status === 'cached')) return state.segments.length ? String(state.segments.length) : '';
  if (paused) return 'II';
  return state ? (BADGES[state.status] ?? '') : '';
}

async function render(tabId, state, s) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const view = summarize({ tab: state, paused: s.paused, spentUsd: await spentToday(), limitUsd: s.dailyLimitUsd, url: tab.url });
  chrome.action.setBadgeText({ tabId, text: badgeFor(state, s.paused) }).catch(() => {});
  chrome.action.setTitle({ tabId, title: view.title }).catch(() => {});
}

async function report(tabId, videoId, status, segments = []) {
  if (tabId == null) return;
  const state = { videoId, status, segments };
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
  await render(tabId, state, await settings());
}

async function setPaused(paused) {
  const next = await store.mutate('settings', {}, (cur) => ({ ...cur, paused }));
  const s = { ...DEFAULT_SETTINGS, ...next };
  await chrome.action.setBadgeText({ text: paused ? 'II' : '' });
  for (const tab of await chrome.tabs.query({})) await render(tab.id, await getTab(tab.id), s);
  return s;
}

chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove(tabKey(tabId)).catch(() => {}); });

async function check(videoId) {
  const s = await settings();
  const hit = getEntry(await store.get('cache', {}), videoId, CACHE_VERSION);
  return { s, verdict: gate(s, hit, await spentToday()) };
}

async function handleNeed({ videoId }, tabId) {
  const { s, verdict } = await check(videoId);
  if (!verdict.need) await report(tabId, videoId, verdict.status, verdict.segments);
  return { videoId, autoSkip: s.autoSkip, ...verdict };
}

async function analyze(videoId, json3, s) {
  let lines;
  try { lines = parseJson3(JSON.parse(json3)); } catch { return { status: 'no_captions', segments: [] }; }
  if (!lines.length) return { status: 'no_captions', segments: [] };
  try {
    const r = await analyzeVideo({ lines, ask: makeAsk({ store, key: s.key, limitUsd: s.dailyLimitUsd }), threshold: s.threshold });
    if (r.complete) await store.mutate('cache', {}, (c) => putEntry(c, videoId, { segments: r.segments }, CACHE_VERSION));
    return { status: r.complete ? 'ok' : 'partial', segments: r.segments };
  } catch (e) {
    if (e instanceof ModelMismatch) {
      await store.mutate('settings', {}, (cur) => ({ ...cur, disabledReason: e.message }));
      return { status: 'disabled', segments: [] };
    }
    if (e instanceof AuthError) return { status: 'no_key', segments: [] };
    if (e instanceof BudgetExceeded) return { status: 'budget', segments: [] };
    console.warn('[yss] analyze failed', String(e));
    return { status: 'error', segments: [] };
  }
}

async function handleAnalyze({ videoId, json3 }, tabId) {
  const { s, verdict } = await check(videoId); // re-check: settings or cache may have changed since 'need'
  let r;
  if (!verdict.need) r = verdict;
  else {
    await report(tabId, videoId, 'busy');
    r = await once(inflight, videoId, () => analyze(videoId, json3, s));
  }
  await report(tabId, videoId, r.status, r.segments);
  return { videoId, segments: r.segments, status: r.status, autoSkip: s.autoSkip };
}

async function popupState(tabId) {
  const s = await settings();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const view = summarize({ tab: await getTab(tabId), paused: s.paused, spentUsd: await spentToday(), limitUsd: s.dailyLimitUsd, url: tab && tab.url });
  return { ...view, paused: s.paused };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  const reply = (p) => { p.then(sendResponse, (e) => sendResponse({ error: String(e) })); return true; };
  const fail = () => sendResponse({ videoId: msg.videoId, need: false, segments: [], status: 'error', autoSkip: false });
  if (!msg) return false;
  if (msg.type === 'need') { handleNeed(msg, tabId).then(sendResponse, fail); return true; }
  if (msg.type === 'analyze') { handleAnalyze(msg, tabId).then(sendResponse, fail); return true; }
  if (msg.type === 'status') { report(tabId, msg.videoId, msg.status); return false; }
  if (msg.type === 'popupState') return reply(popupState(msg.tabId));
  if (msg.type === 'togglePause') return reply(settings().then((s) => setPaused(!s.paused)).then(() => popupState(msg.tabId)));
  return false;
});
