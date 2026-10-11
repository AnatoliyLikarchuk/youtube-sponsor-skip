import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, plural, videoIdFromUrl } from '../lib/summary.js';

const url = 'https://www.youtube.com/watch?v=3u0xhS7ccgk&t=5';
const tab = (status, segments = []) => ({ videoId: '3u0xhS7ccgk', status, segments });
const base = { paused: false, spentUsd: 0.0123, limitUsd: 0.2, url };

test('plural follows Russian rules', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ['вставка', 'вставки', 'вставок'])),
    ['вставка', 'вставки', 'вставок', 'вставок', 'вставка', 'вставки', 'вставок']);
});

test('videoIdFromUrl reads only watch pages', () => {
  assert.equal(videoIdFromUrl(url), '3u0xhS7ccgk');
  assert.equal(videoIdFromUrl('https://www.youtube.com/'), null);
  assert.equal(videoIdFromUrl(undefined), null);
});

test('found segments: headline, timestamps and tooltip', () => {
  const s = summarize({ ...base, tab: tab('ok', [{ start: 478, end: 543 }, { start: 1270, end: 1300 }]) });
  assert.equal(s.headline, 'Найдено 2 рекламные вставки');
  assert.deepEqual(s.items.map((i) => i.label), ['7:58–9:03', '21:10–21:40']);
  assert.equal(s.items[0].start, 478);
  assert.equal(s.spend, 'Сегодня $0.012 из $0.20');
  assert.equal(s.pauseLabel, '⏸ Пауза');
  assert.equal(s.title, 'Sponsor Skip · Найдено 2 рекламные вставки: 7:58–9:03, 21:10–21:40');
});

test('cached, none found and one found', () => {
  assert.equal(summarize({ ...base, tab: tab('cached', [{ start: 0, end: 20 }]) }).headline, 'Найдена 1 рекламная вставка (из кэша, бесплатно)');
  assert.equal(summarize({ ...base, tab: tab('ok') }).headline, 'Рекламных вставок не найдено');
  assert.equal(summarize({ ...base, tab: tab('partial', [{ start: 0, end: 20 }]) }).headline, 'Найдена 1 рекламная вставка (часть запросов не удалась)');
});

test('status messages', () => {
  const h = (status) => summarize({ ...base, tab: tab(status) }).headline;
  assert.equal(h('busy'), 'Анализирую субтитры…');
  assert.equal(h('pending'), 'Жду субтитры…');
  assert.equal(h('paused'), 'На паузе — Jev не вызывается');
  assert.equal(h('no_captions'), 'Нет русских субтитров — пропускать нечего');
  assert.equal(h('no_key'), 'Не задан ключ OpenRouter');
  assert.equal(h('budget'), 'Дневной лимит исчерпан');
  assert.equal(h('disabled'), 'Выключено: сменилась версия модели');
  assert.equal(h('error'), 'Ошибка анализа');
});

test('a tab that is not on the analysed video says so', () => {
  const s = summarize({ ...base, url: 'https://www.youtube.com/', tab: tab('ok', [{ start: 1, end: 9 }]) });
  assert.equal(s.headline, 'Открой видео на YouTube');
  assert.deepEqual(s.items, []);
  assert.equal(summarize({ ...base, tab: null }).headline, 'Открой видео на YouTube');
});

test('pause shows the resume button and a pause note in the tooltip', () => {
  const s = summarize({ ...base, paused: true, tab: tab('cached', [{ start: 0, end: 20 }]) });
  assert.equal(s.pauseLabel, '▶ Продолжить');
  assert.equal(s.title, 'Sponsor Skip (пауза) · Найдена 1 рекламная вставка (из кэша, бесплатно): 0:00–0:20');
});
