(() => {
  // Subscribe synchronously: page-hook may post before the dynamic import resolves.
  const skipperModule = import(chrome.runtime.getURL('lib/skipper.js'));
  let currentVideoId = null, skipper = null, autoSkip = true;
  const attached = new WeakSet();
  const fmt = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  // YouTube plays its own ads in the same <video>; their currentTime/duration are not the video's.
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing');
  const send = async (msg) => { try { return await chrome.runtime.sendMessage(msg); } catch (e) { console.info('[yss] extension unavailable', String(e)); return null; } };

  function toast(text, buttonText, onClick) {
    document.getElementById('yss-toast')?.remove();
    const host = document.getElementById('movie_player') || document.body;
    const el = document.createElement('div');
    el.id = 'yss-toast';
    el.style.cssText = 'position:absolute;left:16px;bottom:72px;z-index:99;background:rgba(0,0,0,.8);color:#fff;'
      + 'font:14px Roboto,Arial,sans-serif;padding:8px 12px;border-radius:6px;display:flex;gap:12px;align-items:center';
    const span = document.createElement('span');
    span.textContent = text;
    const btn = document.createElement('button');
    btn.textContent = buttonText;
    btn.style.cssText = 'background:none;border:0;color:#3ea6ff;font:inherit;cursor:pointer';
    btn.onclick = () => { onClick(); el.remove(); };
    el.append(span, btn);
    host.append(el);
    setTimeout(() => el.remove(), 8000);
  }

  function attach(video) {
    if (attached.has(video)) return;
    attached.add(video);
    video.addEventListener('seeking', () => { if (skipper && !adShowing()) skipper.onSeek(video.currentTime); });
    video.addEventListener('timeupdate', () => {
      if (!skipper || adShowing()) return;
      const hit = skipper.onTime(video.currentTime, video.duration);
      if (!hit) return;
      const len = fmt(hit.seg.end - hit.seg.start);
      if (autoSkip) {
        video.currentTime = hit.to;
        toast(`Пропущена реклама, ${len}`, 'Вернуть', () => { video.currentTime = skipper.undo(hit.seg); });
      } else {
        toast(`Реклама, ${len}`, 'Пропустить', () => { video.currentTime = hit.to; });
      }
    });
  }

  async function apply(result) {
    const { createSkipper, acceptResult } = await skipperModule;
    if (!acceptResult(currentVideoId, result)) return;
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;
    autoSkip = result.autoSkip;
    skipper = createSkipper(result.segments);
    attach(video);
    console.info('[yss]', result.status, result.segments.map((s) => `${fmt(s.start)}–${fmt(s.end)}`).join(', ') || 'no ads');
  }

  // Popup timestamp click: jump to the start of a sponsor read; the seek marks it watched, so it is not skipped.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'seek' || !Number.isFinite(msg.to)) return;
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && !adShowing()) video.currentTime = msg.to;
  });

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'yss') return;
    const msg = ev.data;
    if (msg.type === 'navigate') {
      currentVideoId = msg.videoId; skipper = null; document.getElementById('yss-toast')?.remove();
      send({ type: 'status', status: 'pending', videoId: msg.videoId });
      return;
    }
    if (currentVideoId === null) currentVideoId = msg.videoId;
    if (msg.videoId !== currentVideoId) return;
    if (msg.type === 'no_captions') { send({ type: 'status', status: 'no_captions', videoId: msg.videoId }); return; }
    if (msg.type === 'track') {
      const result = await send({ type: 'need', videoId: msg.videoId });
      if (!result) return;
      if (result.need) window.postMessage({ source: 'yss-ext', type: 'fetch', videoId: msg.videoId }, '*');
      else apply(result);
      return;
    }
    if (msg.type !== 'captions' || typeof msg.json3 !== 'string') return;
    apply(await send({ type: 'analyze', videoId: msg.videoId, json3: msg.json3 }));
  });
})();
