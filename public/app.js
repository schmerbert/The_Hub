const app = document.querySelector('#app');
const chip = document.querySelector('#chip');
const bench = document.querySelector('#bench');
const log = document.querySelector('#log');
const gap = document.querySelector('#gap');
const threadNote = document.querySelector('#thread-note');
const form = document.querySelector('#compose');
const input = document.querySelector('#input');
const sendButton = form.querySelector('button');
const statusEl = document.querySelector('#status');
const modeModel = document.querySelector('#mode-model');
const roomState = document.querySelector('#room-state');
const stationState = document.querySelector('#station-state');
const approvalState = document.querySelector('#approval-state');
const inspectWorldButton = document.querySelector('#inspect-world');
const inspectApprovalsButton = document.querySelector('#inspect-approvals');
const approvalsBadge = document.querySelector('#approvals-badge');
const tray = document.querySelector('#tray');
const trayTabs = document.querySelector('#tray-tabs');
const panelHost = document.querySelector('#panel-host');
const waveCompact = new window.CornerWave(document.querySelector('#wave-compact'), { amp: .22 });
const waveMain = new window.CornerWave(document.querySelector('#wave-main'), { amp: .3 });

let busy = false;
let currentWake = null;
let currentInspectionTab = 'summary';
let currentApprovals = [];
const wakeSlips = new Map();
let slipPoll = null;
let slipPollBusy = false;

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

function approvalSummary(approval) {
  const preview = approval?.preview || {};
  const path = preview.path || preview.toPath || preview.fromPath || (Array.isArray(preview.paths) ? preview.paths.join(', ') : null);
  if (approval?.kind === 'delete_path') return `Delete · ${path || 'path'}`;
  if (approval?.kind === 'git_checkout') return `Checkout · ${preview.branch || 'branch'}`;
  if (approval?.kind === 'commit') return `Commit · ${preview.message || 'message'}`;
  if (approval?.kind === 'git_add') return `Stage · ${path || 'paths'}`;
  if (approval?.kind === 'rename_path') return `Rename · ${preview.fromPath || '?'} → ${preview.toPath || '?'}`;
  if (approval?.kind === 'write_file') return `Write · ${path || 'file'}`;
  if (approval?.kind === 'create_path') return `Create · ${path || 'path'}`;
  if (approval?.kind === 'patch' || approval?.kind === 'unified_diff') return `Patch · ${path || 'diff'}`;
  return `${approval?.kind || 'cut'}${path ? ` · ${path}` : ''}`;
}

async function decideApproval(approvalId, decision) {
  await request(`/api/approvals/${encodeURIComponent(approvalId)}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  await refresh();
  if (!tray.hidden && panelHost.querySelector('.inspection-block')) await inspectApprovals();
}

function renderSlips(parent, slips) {
  parent.replaceChildren();
  for (const slip of slips) {
    if (slip.kind === 'thinking') {
      const detail = node('details', 'slip slip-thinking');
      detail.append(node('summary', null, slip.label), node('p', null, slip.detail));
      parent.append(detail);
    } else if (slip.kind === 'pending' && slip.decidable && slip.approvalId) {
      const row = node('div', 'slip pending slip-pending');
      const label = node('span', 'slip-pending-label', slip.label);
      if (slip.detail) label.title = slip.detail;
      const actions = node('div', 'slip-decide');
      const confirm = node('button', null, 'Confirm');
      confirm.type = 'button';
      confirm.addEventListener('click', async () => {
        try { await decideApproval(slip.approvalId, 'confirm'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
      });
      const reject = node('button', null, 'Reject');
      reject.type = 'button';
      reject.addEventListener('click', async () => {
        try { await decideApproval(slip.approvalId, 'reject'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
      });
      actions.append(confirm, reject);
      row.append(label, actions);
      parent.append(row);
    } else {
      const row = node('div', `slip ${slip.kind}`, slip.label);
      if (slip.detail) row.title = slip.detail;
      parent.append(row);
    }
  }
}

function activeSessionId(data) {
  return data.session?.id || null;
}

function wakesForActiveSession(data) {
  const sessionId = activeSessionId(data);
  return (data.wakes || []).filter(wake => wake.sessionId === sessionId);
}

function describeLifespan(data) {
  const closed = (data.sessions || []).filter(session => session.kind === 'lifespan' && session.status === 'closed').length;
  if (closed > 0) return `This lifespan · ${closed} earlier closed`;
  return 'This lifespan';
}

function renderThread(data) {
  log.replaceChildren();
  if (threadNote) threadNote.textContent = describeLifespan(data);
  const sessionId = activeSessionId(data);
  const activeWakes = wakesForActiveSession(data);
  const activeIds = new Set(activeWakes.map(wake => wake.id));
  for (const wakeId of [...wakeSlips.keys()]) {
    if (!activeIds.has(wakeId)) wakeSlips.delete(wakeId);
  }
  const wakes = new Map();
  for (const wake of activeWakes) wakes.set(wake.id, { wake, events: [] });
  for (const event of data.events || []) {
    if (event.sessionId !== sessionId) continue;
    const group = wakes.get(event.wakeId);
    if (group) group.events.push(event);
  }
  for (const group of wakes.values()) {
    const wakeElement = node('article', 'wake');
    for (const event of group.events.filter(item => item.eventKind === 'utterance' && (item.actorKind === 'user' || item.actorKind === 'resident'))) {
      const eventElement = node('div', `event ${event.actorKind}`);
      eventElement.append(node('span', 'event-label', eventLabel(event)), node('span', null, event.content));
      wakeElement.append(eventElement);
    }
    const steps = wakeSlips.get(group.wake.id);
    if (steps?.length) {
      const detail = node('details', 'slips');
      detail.append(node('summary', 'slip phase', `Steps · ${steps.length}`));
      const rows = node('div', 'gap');
      renderSlips(rows, steps);
      detail.append(rows);
      wakeElement.append(detail);
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
  if (!response.ok) {
    if (data && typeof data === 'object' && (data.failureCode || data.status === 'failed')) return { ...data, __failedWake: true };
    throw data.error || { code: 'host_error', message: data.failureMessage || 'Host request failed.' };
  }
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
  if (wake.hearth?.scrollMarkdown) {
    appendBlock(panel, 'Hearth tended - custody held', wake.hearth.scrollMarkdown, 'hearth-scroll');
    const expose = node('button', 'inspect-button', 'Expose wiring');
    expose.type = 'button';
    expose.addEventListener('click', () => { currentInspectionTab = 'wiring'; renderInspection(); });
    panel.append(expose);
  }
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

function renderWiring(wake) {
  const panel = node('div', 'panel');
  appendBlock(panel, 'Machine receipt', wake.hearth?.returnJson || 'none', 'inspection-code');
  appendBlock(panel, 'Return Scrub / Spine pointers', wake.phases.map(phase => `${phase.phase}: ${phase.returnScrubReceiptId || 'none'} · raw ${phase.rawReturnRecordId || 'none'}`).join('\n'), 'inspection-code');
  appendBlock(panel, 'Operational detail', JSON.stringify(wake.wiring || wake.phases, null, 2), 'inspection-code');
  return panel;
}

function renderWorld(world) {
  const panel = node('div', 'panel');
  appendBlock(panel, 'Current room', `${world.projection.roomId}\n${world.projection.text}`);
  appendBlock(panel, 'Engaged fixture', world.projection.engagedFixtureId || 'none');
  appendBlock(panel, 'Heartbeat', world.projection.heartbeat?.line || 'quiet');
  appendBlock(panel, 'Fixtures', world.projection.fixtures.map(item => `${item.id} · ${item.text}${item.state?.status && item.state.status !== 'idle' ? ` · ${item.state.status}` : ''}`).join('\n') || 'none', 'inspection-code');
  appendBlock(panel, 'Declared exits', world.projection.exits.map(exit => `${exit.edgeId} · ${exit.doorId} → ${exit.to}`).join('\n') || 'none', 'inspection-code');
  appendBlock(panel, 'Effective actions', world.tools.map(tool => tool.function.name).join('\n') || 'none', 'inspection-code');
  appendBlock(panel, 'Approvals', (world.approvals || []).map(item => `${item.approvalId} · ${item.kind} · ${item.status}`).join('\n') || 'none', 'inspection-code');
  appendBlock(panel, 'Graph wiring', JSON.stringify(world.graph, null, 2), 'inspection-code');
  return panel;
}

function renderApprovals(approvals) {
  const panel = node('div', 'panel');
  if (!approvals.length) {
    appendBlock(panel, 'Approvals', 'No approvals for this lifespan.');
    return panel;
  }
  for (const approval of approvals) {
    const block = node('section', 'inspection-block');
    block.append(node('div', 'inspection-label', `${approvalSummary(approval)} · ${approval.status}`));
    block.append(node('div', 'inspection-value', approval.approvalId));
    const preview = node('details', 'inspection-preview');
    preview.append(node('summary', null, 'Raw preview'));
    preview.append(node('pre', 'inspection-value inspection-code', JSON.stringify(approval.preview, null, 2)));
    block.append(preview);
    if (approval.status === 'pending') {
      const row = node('div', 'wake-actions');
      const confirm = node('button', 'inspect-button', 'Confirm');
      confirm.type = 'button';
      confirm.addEventListener('click', async () => {
        try { await decideApproval(approval.approvalId, 'confirm'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
      });
      const reject = node('button', 'inspect-button', 'Reject');
      reject.type = 'button';
      reject.addEventListener('click', async () => {
        try { await decideApproval(approval.approvalId, 'reject'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
      });
      row.append(confirm, reject);
      block.append(row);
    }
    panel.append(block);
  }
  return panel;
}

async function inspectWorld() {
  try { const world = await request('/api/world'); tray.hidden = false; trayTabs.replaceChildren(); panelHost.replaceChildren(renderWorld(world)); panelHost.focus(); }
  catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

async function inspectApprovals() {
  try {
    const data = await request('/api/approvals');
    currentApprovals = data.approvals || [];
    tray.hidden = false;
    trayTabs.replaceChildren();
    panelHost.replaceChildren(renderApprovals(currentApprovals));
    panelHost.focus();
  } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

function renderInspection() {
  trayTabs.replaceChildren();
  for (const tabName of ['summary', 'context', 'receipt', 'wiring']) {
    const tab = node('button', 'tray-tab', tabName);
    tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(currentInspectionTab === tabName));
    tab.addEventListener('click', () => { currentInspectionTab = tabName; renderInspection(); });
    trayTabs.append(tab);
  }
  panelHost.replaceChildren(currentInspectionTab === 'summary' ? renderSummary(currentWake) : currentInspectionTab === 'context' ? renderContext(currentWake) : currentInspectionTab === 'wiring' ? renderWiring(currentWake) : renderReceipt(currentWake));
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
  roomState.textContent = health.currentRoom?.roomId || 'unknown room';
  stationState.textContent = health.engagedFixtureId || health.engagedStationId ? `Engaged · ${health.engagedFixtureId || health.engagedStationId}` : 'No fixture';
  if (health.heartbeat?.line) stationState.textContent += ` · ${health.heartbeat.line}`;
  const pending = health.pendingApprovals || 0;
  if (pending > 0) {
    approvalState.hidden = false;
    approvalState.textContent = `${pending} pending approval${pending === 1 ? '' : 's'}`;
    if (approvalsBadge) {
      approvalsBadge.hidden = false;
      approvalsBadge.textContent = String(pending);
    }
    inspectApprovalsButton?.setAttribute('aria-label', `Approvals · ${pending} pending`);
  } else {
    approvalState.hidden = true;
    approvalState.textContent = '';
    if (approvalsBadge) {
      approvalsBadge.hidden = true;
      approvalsBadge.textContent = '';
    }
    inspectApprovalsButton?.setAttribute('aria-label', 'Approvals');
  }
  renderThread(thread);
  const latest = wakesForActiveSession(thread).at(-1);
  if (!busy && latest?.status === 'failed') setState('failed');
  else if (!busy) setState('idle');
}

async function pollSlips() {
  if (!busy || slipPollBusy) return;
  slipPollBusy = true;
  try {
    const health = await request('/api/health');
    if (!health.activeWakeId) return;
    const projected = await request(`/api/wakes/${encodeURIComponent(health.activeWakeId)}/slips`);
    renderSlips(gap, projected.slips || []);
  } catch {}
  finally { slipPollBusy = false; }
}

function startSlipPoll() {
  stopSlipPoll();
  pollSlips();
  slipPoll = setInterval(pollSlips, 400);
}

function stopSlipPoll() {
  if (slipPoll) clearInterval(slipPoll);
  slipPoll = null;
}

async function retainWakeSlips(wakeId) {
  if (!wakeId) return;
  const projected = await request(`/api/wakes/${encodeURIComponent(wakeId)}/slips`);
  wakeSlips.set(wakeId, projected.slips || []);
}

async function submitWake(event) {
  event.preventDefault();
  if (busy) return;
  const submitted = input.value;
  if (!submitted.trim()) return;
  busy = true; input.disabled = true; sendButton.disabled = true; setState('assembling');
  setTimeout(() => { if (busy) setState('orienting'); }, 0);
  startSlipPoll();
  try {
    const wake = await request('/api/wakes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: submitted }) });
    input.value = '';
    if (wake.__failedWake || wake.status === 'failed') {
      setState('failed');
      await refresh();
      if (wake.id) { currentWake = wake; currentInspectionTab = 'summary'; tray.hidden = false; renderInspection(); }
      statusEl.title = wake.failureMessage || wake.failureCode || 'Wake failed';
      return;
    }
    setState('committed');
    await retainWakeSlips(wake.id);
    await refresh();
    setState('committed');
    setTimeout(() => { if (!busy) setState('idle'); }, 1200);
    if (wake.id) currentWake = wake;
  } catch (error) {
    setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed');
    statusEl.title = error.message || error.code || 'failed';
    await refresh().catch(() => {});
  } finally {
    stopSlipPoll();
    gap.replaceChildren();
    busy = false; input.disabled = false; sendButton.disabled = false; input.focus();
  }
}

chip.addEventListener('click', () => setMode('expanded'));
document.querySelector('#btn-compact').addEventListener('click', () => setMode('compact'));
inspectWorldButton.addEventListener('click', inspectWorld);
inspectApprovalsButton.addEventListener('click', inspectApprovals);
document.querySelector('#close-tray').addEventListener('click', () => { tray.hidden = true; currentWake = null; });
form.addEventListener('submit', submitWake);

waveCompact.start();
if (window.matchMedia('(max-width: 700px)').matches) setMode('expanded');
else setMode('compact');
refresh().catch(() => { modeModel.textContent = 'unavailable · host'; setState('host unavailable'); });
