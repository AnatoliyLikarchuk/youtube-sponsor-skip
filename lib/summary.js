// Text for the toolbar tooltip and the popup, from the per-tab state the background keeps.
// spentUsd is the confirmed spend; heldUsd the reservations still waiting for a real cost (both count toward the limit).
export function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function videoIdFromUrl(url) {
  try { const u = new URL(url); return u.pathname === '/watch' ? u.searchParams.get('v') : null; } catch { return null; }
}

const mmss = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const STATUS = {
  busy: 'Анализирую субтитры…',
  pending: 'Жду субтитры…',
  paused: 'На паузе — Jev не вызывается',
  no_captions: 'Нет русских субтитров — пропускать нечего',
  no_key: 'Не задан ключ OpenRouter',
  budget: 'Дневной лимит исчерпан',
  disabled: 'Выключено: сменилась версия модели',
  error: 'Ошибка анализа',
};
const SUFFIX = { cached: ' (из кэша, бесплатно)', partial: ' (часть запросов не удалась)', ok: '' };

function found(n) {
  if (!n) return 'Рекламных вставок не найдено';
  return `${plural(n, ['Найдена', 'Найдено', 'Найдено'])} ${n} ${plural(n, ['рекламная вставка', 'рекламные вставки', 'рекламных вставок'])}`;
}

export function summarize({ tab, paused, spentUsd, heldUsd = 0, limitUsd, url }) {
  const onVideo = tab && tab.videoId && videoIdFromUrl(url) === tab.videoId;
  const segments = onVideo && tab.status in SUFFIX ? tab.segments : [];
  const headline = !onVideo ? 'Открой видео на YouTube'
    : tab.status in SUFFIX ? found(segments.length) + SUFFIX[tab.status]
      : STATUS[tab.status] || tab.status;
  const items = segments.map((s) => ({ start: s.start, end: s.end, label: `${mmss(s.start)}–${mmss(s.end)}` }));
  return {
    headline,
    items,
    spend: `Сегодня $${spentUsd.toFixed(3)} из $${limitUsd.toFixed(2)}`,
    reserve: heldUsd > 0 ? `+ $${heldUsd.toFixed(3)} в резерве: оборвавшиеся запросы, скорее всего бесплатные` : '',
    pauseLabel: paused ? '▶ Продолжить' : '⏸ Пауза',
    title: `Sponsor Skip${paused ? ' (пауза)' : ''} · ${headline}${items.length ? ': ' + items.map((i) => i.label).join(', ') : ''}`,
  };
}
