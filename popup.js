const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

function show(view) {
  if (!view || view.error) { $('headline').textContent = 'Расширение недоступно, перезагрузи страницу'; return; }
  $('headline').textContent = view.headline;
  $('items').replaceChildren(...view.items.map((item) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = `▶ ${item.label}`;
    btn.title = 'Перейти к началу вставки (она не будет пропущена)';
    btn.onclick = () => chrome.tabs.sendMessage(tab.id, { type: 'seek', to: item.start }).catch(() => {});
    li.append(btn);
    return li;
  }));
  $('pause').textContent = view.pauseLabel;
  $('pause').classList.toggle('paused', view.paused);
  $('spend').textContent = view.spend;
  $('reserve').textContent = view.reserve;
  $('reserve').hidden = !view.reserve;
}

$('pause').onclick = async () => show(await chrome.runtime.sendMessage({ type: 'togglePause', tabId: tab.id }));
$('options').onclick = () => chrome.runtime.openOptionsPage();
show(await chrome.runtime.sendMessage({ type: 'popupState', tabId: tab.id }));
