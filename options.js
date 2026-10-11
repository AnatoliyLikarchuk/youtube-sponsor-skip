import { DEFAULT_SETTINGS } from './lib/settings.js';
import { spentByDay, today } from './lib/budget.js';
import { createStore } from './lib/store.js';

const store = createStore(chrome.storage.local);
const $ = (id) => document.getElementById(id);

async function render() {
  const s = { ...DEFAULT_SETTINGS, ...(await store.get('settings', {})) };
  $('keyState').textContent = s.key ? 'задан' : 'не задан';
  $('limit').value = s.dailyLimitUsd;
  $('threshold').value = s.threshold;
  $('autoSkip').checked = s.autoSkip;
  $('status').textContent = s.disabledReason ? `Выключено: ${s.disabledReason}. Проверь версию модели и включи снова.` : '';
  $('enable').hidden = !s.disabledReason;
  const byDay = spentByDay(await store.get('budget', { entries: [] }));
  const days = Array.from({ length: 7 }, (_, i) => today(new Date(Date.now() - i * 86400000)));
  $('spend').innerHTML = '';
  for (const d of days) {
    const row = $('spend').insertRow();
    row.insertCell().textContent = d;
    row.insertCell().textContent = '$' + (byDay[d] || 0).toFixed(4);
  }
}

$('save').onclick = async () => {
  const key = $('key').value.trim();
  if (key && !key.startsWith('sk-or-')) { $('status').textContent = 'Ключ должен начинаться с sk-or-'; return; }
  const limit = Number($('limit').value), threshold = Number($('threshold').value);
  if (!(limit >= 0.02) || !(threshold > 0 && threshold < 1)) { $('status').textContent = 'Проверь лимит и порог'; return; }
  await store.mutate('settings', {}, (cur) => ({ ...cur, ...(key ? { key } : {}), dailyLimitUsd: limit, threshold, autoSkip: $('autoSkip').checked }));
  $('key').value = '';
  render();
};
$('enable').onclick = async () => { await store.mutate('settings', {}, (cur) => ({ ...cur, disabledReason: null })); render(); };
$('clearCache').onclick = async () => { await store.mutate('cache', {}, () => ({})); render(); };
render();
