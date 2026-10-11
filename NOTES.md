# Development notes (probe, regression, live checks)

## Caption access probe (Task 1 result)
2026-10-10, Chromium 152 (Claude app browser pane), not logged in to YouTube.
- `direct` (fetch `captionTracks[].baseUrl&fmt=json3`): HTTP 200 with an **empty body** on `b6Buh_1YdnM`; the player's own
  request carries `pot=` (proof-of-origin token). Removed from `page-hook.js`.
- `intercept`: after `loadModule('captions')` + `setOption('captions','track',{languageCode:'ru',kind:'asr'})` the player
  fetched `/api/timedtext?...&pot=...&fmt=json3` via **XHR**; the hook captured 338 590 chars of valid json3 on `3u0xhS7ccgk`.
- The player may fetch captions before anything waits for them (seen on the first page load), so the hook stores every
  `timedtext` response by `videoId|lang` and reuses it (`via: captured`).
- `getOption('captions','track')` returns `{}` when captions are off; the hook unloads the module only if it turned them on.
- Not verified yet: the hook running at `document_start` inside the real extension (checked in Task 9 manual run).

## Accuracy regression (Task 10, 2026-10-11)
`node eval.mjs --paid` on the 6 spike videos, spent $0.0148 (approved $0.10). Raw script verdict: FAIL on max wrong skip
(30.2 s/video). Two extra skips are not in SponsorBlock gold; Anatoliy ruled both are ads:
`Abe60sEUzhc` 968–998 (screen-glass promo, "обязательно покупайте") and `RMTl_hQHmAY` 3160–3175 (thanks to build partners).
With them counted as ads: recall ≈0.91 (missed 36 of ~409 s), max wrong skip 11 s/video → **PASS (spec §1)**.
Known misses: 20 s Авто.ру pre-roll at 0:00 (`RMTl_hQHmAY`), 6 s tail of the Avito read.

## Live check (2026-10-11)
Anatoliy, own Chrome: `3u0xhS7ccgk` — the Мегафон read was skipped automatically with the toast. Undo, cache, SPA navigation and the budget-limit badge are not checked yet.
Popup (pause/resume, timestamps, spend) and tooltip confirmed working by Anatoliy the same day.
