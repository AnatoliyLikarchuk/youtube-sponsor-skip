(function () {
  // Direct fetch of captionTracks[].baseUrl returns an empty body (YouTube requires a proof-of-origin token),
  // so we capture the player's own /api/timedtext responses. Probe results: README.md.
  // Protocol: we post 'navigate' and 'track' (a Russian track exists); content.js asks the background whether the
  // video needs analysis and only then posts {source:'yss-ext', type:'fetch'}; we answer 'captions' or 'no_captions'.
  const post = (msg) => window.postMessage({ source: 'yss', ...msg }, '*');
  const captured = new Map(); // "<videoId>|<lang>" -> json3 text, last few videos only
  const waiters = new Map(); // same key -> resolve, while we wait for a caption response we triggered
  const tracks = new Map(); // videoId -> {player, track}

  function remember(url, text) {
    if (!text) return;
    try {
      const u = new URL(url, location.origin);
      if (!u.pathname.includes('/api/timedtext') || u.searchParams.get('tlang')) return; // skip auto-translations
      const key = u.searchParams.get('v') + '|' + (u.searchParams.get('lang') || '').split('-')[0];
      captured.delete(key);
      captured.set(key, text);
      while (captured.size > 3) captured.delete(captured.keys().next().value);
      const resolve = waiters.get(key);
      if (resolve) resolve(text);
    } catch (e) { /* ignore malformed URLs */ }
  }

  const origFetch = window.fetch;
  window.fetch = async function (input) {
    const res = await origFetch.apply(this, arguments);
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && url.includes('/api/timedtext')) res.clone().text().then((t) => remember(url, t)).catch(() => {});
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(url).includes('/api/timedtext')) {
      this.addEventListener('load', () => { try { remember(String(url), this.responseText); } catch (e) { /* non-text */ } });
    }
    return origOpen.apply(this, arguments);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const currentVideoId = () => new URL(location.href).searchParams.get('v');

  async function playerResponse(videoId) {
    for (let i = 0; i < 20; i++) {
      const p = document.getElementById('movie_player');
      const pr = p && p.getPlayerResponse && p.getPlayerResponse();
      if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) return { player: p, pr };
      await sleep(500);
    }
    return null;
  }

  function pickRussianTrack(list) { // duplicated in lib/captions.js for tests; keep in sync
    const ru = (list || []).filter((t) => (t.languageCode || '').split('-')[0] === 'ru');
    return ru.find((t) => t.kind !== 'asr') || ru.find((t) => t.kind === 'asr') || null;
  }

  function currentTrack(player) {
    try { const t = player.getOption('captions', 'track') || {}; return Object.keys(t).length ? t : null; } catch (e) { return null; }
  }

  async function fetchCaptions(player, videoId, track) {
    const key = videoId + '|ru';
    if (captured.has(key)) return { json3: captured.get(key), via: 'captured' };
    const got = new Promise((resolve) => waiters.set(key, resolve));
    const before = currentTrack(player); // the user's own caption choice, restored below
    player.loadModule('captions');
    player.setOption('captions', 'track', { languageCode: track.languageCode, kind: track.kind });
    const text = await Promise.race([got, sleep(8000).then(() => null)]);
    waiters.delete(key);
    if (currentVideoId() === videoId) { // never touch the player after the user moved on
      if (before) player.setOption('captions', 'track', before);
      else player.unloadModule('captions');
    }
    if (!text) throw new Error('intercept_timeout');
    return { json3: text, via: 'intercept' };
  }

  async function onFetch(videoId) {
    const found = tracks.get(videoId);
    if (!found || currentVideoId() !== videoId) return;
    try {
      const { json3, via } = await fetchCaptions(found.player, videoId, found.track);
      JSON.parse(json3); // throws on empty/invalid
      if (currentVideoId() !== videoId) return;
      console.info('[yss] captions via', via, videoId, json3.length, 'chars');
      post({ type: 'captions', videoId, json3, via, lang: found.track.languageCode, kind: found.track.kind || 'manual' });
    } catch (e) {
      console.info('[yss] captions failed', videoId, String(e));
      if (currentVideoId() === videoId) post({ type: 'no_captions', videoId });
    }
  }

  let running = null;
  async function handle() {
    const videoId = currentVideoId();
    if (!videoId || running === videoId) return;
    running = videoId;
    tracks.clear();
    post({ type: 'navigate', videoId });
    const found = await playerResponse(videoId);
    if (currentVideoId() !== videoId) return;
    const list = found && found.pr.captions && found.pr.captions.playerCaptionsTracklistRenderer
      ? found.pr.captions.playerCaptionsTracklistRenderer.captionTracks : [];
    const track = pickRussianTrack(list);
    if (!track) { console.info('[yss] no Russian captions', videoId); post({ type: 'no_captions', videoId }); return; }
    tracks.set(videoId, { player: found.player, track });
    post({ type: 'track', videoId });
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'yss-ext' || ev.data.type !== 'fetch') return;
    onFetch(ev.data.videoId);
  });
  document.addEventListener('yt-navigate-finish', handle);
  window.addEventListener('load', handle);
})();
