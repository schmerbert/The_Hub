const app = document.querySelector('#app');
const chip = document.querySelector('#chip');
const bench = document.querySelector('#bench');
const log = document.querySelector('#log');
const form = document.querySelector('#compose');
const input = document.querySelector('#input');
const sendButton = form.querySelector('button');
const statusEl = document.querySelector('#status');
const modeModel = document.querySelector('#mode-model');
const tray = document.querySelector('#tray');
const trayTabs = document.querySelector('#tray-tabs');
const panelHost = document.querySelector('#panel-host');
const waveCompact = new window.CornerWave(document.querySelector('#wave-compact'), { amp: .22 });
const waveMain = new window.CornerWave(document.querySelector('#wave-main'), { amp: .3 });

let busy = false;
let currentWake = null;
let currentInspectionTab = 'summary';

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function setState(state) {
  statusEl.textContent = state;
  statusEl.dataset.state = state;
  waveCompact.setState(state);
  waveMain.setState(state);
}

function setMode(next) {
  if (window.matchMedia('(max-width: 700px)').matches && next === 'compact') next = 'expanded';
  app.dataset.mode = next;
  bench.hidden = next !== 'expanded';
  chip.setAttribute('aria-expanded', String(next === 'expanded'));
  if (next === 'expanded') {
    waveMain.start();
    requestAnimationFrame(() => input.focus());
  }
}

function modeLabel(health) {
  if (health.residentMode === 'fake') return `fake demonstration · ${health.model}`;
  if (!health.liveCredentialsAvailable) return `unavailable · live DeepSeek · ${health.model}`;
  return `live DeepSeek · ${health.model}`;
}

function eventLabel(event) {
  if (event.actorKind === 'user') return 'You · ground';
  if (event.actorKind === 'resident') return 'Resident · model-signed';
  return 'Host · receipt/failure';
}

function renderThread(data) {
  log.replaceChildren();
  const wakes = new Map();
  for (const wake of data.wakes) wakes.set(wake.id, { wake, events: [] });
  for (const event of data.events) {
    const group = wakes.get(event.wakeId);
    if (group) group.events.push(event);
  }
  for (const group of wakes.values()) {
    const wakeElement = node('article', 'wake');
    for (const event of group.events) {
      const eventElement = node('div', `event ${event.actorKind}`);
      eventElement.append(node('span', 'event-label', eventLabel(event)), node('span', null, event.content));
      wakeElement.append(eventElement);
    }
    const actionRow = node('div', 'wake-actions');
    const inspect = node('button', 'inspect-button', 'Inspect wake');
    inspect.type = 'button';
    inspect.addEventListener('click', () => inspectWake(group.wake.id));
    actionRow.append(inspect);
    wakeElement.append(actionRow);
    log.append(wakeElement);
  }
  log.scrollTop = log.scrollHeight;
}

async function request(path, options) {
  const response = await fetch(path, options);
  let data;
  try { data = await response.json(); } catch { throw { code: 'host_unavailable', message: `Host returned HTTP ${response.status}.` }; }
  if (!response.ok) throw data.error || { code: 'host_error', message: 'Host request failed.' };
  return data;
}

function appendBlock(parent, label, content, className = '') {
  const block = node('section', `inspection-block ${className}`);
  block.append(node('div', 'inspection-label', label), node('div', 'inspection-value', content));
  parent.append(block);
}

function renderSummary(wake) {
  const panel = node('div', 'panel');
  appendBlock(panel, 'Wake', `${wake.status} · started ${wake.startedAt || 'unknown'}${wake.completedAt ? ` · completed ${wake.completedAt}` : ''}`);
  appendBlock(panel, 'Provider', `${wake.provider} · requested ${wake.requestedModel}${wake.resolvedModel ? ` · resolved ${wake.resolvedModel}` : ''}`);
  if (wake.failureCode) appendBlock(panel, 'Failure', `${wake.failureCode} — ${wake.failureMessage}`, 'omitted');
  appendBlock(panel, 'Context', `${wake.context.filter(item => item.included).length} included · ${wake.context.filter(item => !item.included).length} omitted`);
  return panel;
}

function renderContext(wake) {
  const panel = node('div', 'panel');
  for (const item of wake.context) {
    const state = item.included ? 'included' : 'omitted';
    const content = `${item.actorRole} · ${item.authority} · ${state}\nsource: ${item.sourceDescription}${item.sourceEventId ? `\nevent: ${item.sourceEventId}` : ''}\nhash: ${item.contentHash}${item.omissionReason ? `\nreason: ${item.omissionReason}` : ''}\n\n${item.content}`;
    appendBlock(panel, `#${item.ordinal} · ${item.itemKind}`, content, item.included ? '' : 'omitted');
  }
  return panel;
}

function renderReceipt(wake) {
  const panel = node('div', 'panel');
  appendBlock(panel, 'Provider response', wake.providerResponseId || 'none', 'inspection-code');
  appendBlock(panel, 'Finish reason', wake.finishReason || 'none');
  appendBlock(panel, 'System fingerprint', wake.systemFingerprint || 'none', 'inspection-code');
  appendBlock(panel, 'Usage/cache', wake.usage ? JSON.stringify(wake.usage, null, 2) : 'none', 'inspection-code');
  return panel;
}

function renderInspection() {
  trayTabs.replaceChildren();
  for (const tabName of ['summary', 'context', 'receipt']) {
    const tab = node('button', 'tray-tab', tabName);
    tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(currentInspectionTab === tabName));
    tab.addEventListener('click', () => { currentInspectionTab = tabName; renderInspection(); });
    trayTabs.append(tab);
  }
  panelHost.replaceChildren(currentInspectionTab === 'summary' ? renderSummary(currentWake) : currentInspectionTab === 'context' ? renderContext(currentWake) : renderReceipt(currentWake));
}

async function inspectWake(wakeId) {
  try {
    currentWake = await request(`/api/wakes/${encodeURIComponent(wakeId)}`);
    currentInspectionTab = 'summary'; tray.hidden = false; renderInspection(); panelHost.focus();
  } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

async function refresh() {
  const [health, thread] = await Promise.all([request('/api/health'), request('/api/thread')]);
  modeModel.textContent = modeLabel(health);
  renderThread(thread);
  const latest = thread.wakes.at(-1);
  if (!busy && latest?.status === 'failed') setState('failed');
  else if (!busy) setState('idle');
}

async function submitWake(event) {
  event.preventDefault();
  if (busy) return;
  const submitted = input.value;
  if (!submitted.trim()) return;
  busy = true; input.disabled = true; sendButton.disabled = true; setState('assembling');
  setTimeout(() => { if (busy) setState('calling provider'); }, 0);
  try {
    const wake = await request('/api/wakes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: submitted }) });
    input.value = '';
    setState('committed');
    await refresh();
    setState('committed');
    setTimeout(() => { if (!busy) setState('idle'); }, 1200);
    if (wake.id) currentWake = wake;
  } catch (error) {
    setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed');
    await refresh().catch(() => {});
  } finally { busy = false; input.disabled = false; sendButton.disabled = false; input.focus(); }
}

chip.addEventListener('click', () => setMode('expanded'));
document.querySelector('#btn-compact').addEventListener('click', () => setMode('compact'));
document.querySelector('#close-tray').addEventListener('click', () => { tray.hidden = true; currentWake = null; });
form.addEventListener('submit', submitWake);

waveCompact.start();
if (window.matchMedia('(max-width: 700px)').matches) setMode('expanded');
else setMode('compact');
refresh().catch(() => { modeModel.textContent = 'unavailable · host'; setState('host unavailable'); });
