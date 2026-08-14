import {
  clearLiveWake,
  clearOptimisticUser,
  createLiveState,
  projectLiveState,
  recoverHubEventHistory,
  reduceHubEvent,
  registerHubEventSource,
  setLiveConnection,
  setOptimisticUser,
} from './live-state.js';
import {
  captureConversationScroll,
  restoreConversationScroll,
} from './render-state.js';

const app = document.querySelector('#app');
const chip = document.querySelector('#chip');
const bench = document.querySelector('#bench');
const log = document.querySelector('#log');
const liveConversation = document.querySelector('#live-conversation');
const liveGap = document.querySelector('#live-gap');
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
const trayHeading = document.querySelector('#tray-heading');
const trayTabs = document.querySelector('#tray-tabs');
const panelHost = document.querySelector('#panel-host');
const waveCompact = new window.CornerWave(document.querySelector('#wave-compact'), { amp: .22 });
const waveMain = new window.CornerWave(document.querySelector('#wave-main'), { amp: .3 });
const desktopShell = window.cornerDesktop || null;
document.documentElement.dataset.shell = desktopShell ? 'desktop' : 'browser';
let conversationScroller = log;
if (desktopShell) {
  conversationScroller = node('div', 'conversation-scroll');
  log.before(conversationScroller);
  conversationScroller.append(log, liveConversation, liveGap, gap);
}

let busy = false;
let currentWake = null;
let currentInspectionTab = 'summary';
let currentApprovals = [];
let currentWorld = null;
let currentWorldTab = 'marble';
let currentMarbleSelection = 'overview';
const wakeSlips = new Map();
let slipPoll = null;
let slipPollBusy = false;
let liveState = createLiveState();
let terminalReconcileSequence = 0;
const terminalReconciliations = new Map();
let resyncInFlight = false;
let liveEventSource = null;
let unregisterLiveEvents = null;
let liveRecoveryTimer = null;
let liveUnloading = false;
let liveRenderFrame = null;
const openThinkingDisclosures = new Set();

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

function applyMode(next) {
  if (!desktopShell && window.matchMedia('(max-width: 700px)').matches && next === 'compact') next = 'expanded';
  app.dataset.mode = next;
  bench.hidden = next !== 'expanded';
  chip.setAttribute('aria-expanded', String(next === 'expanded'));
  if (next === 'expanded') {
    waveMain.start();
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  return next;
}

async function setMode(next) {
  if (!desktopShell) return applyMode(next);
  try { return applyMode(await desktopShell.setMode(next)); }
  catch { setState('host unavailable'); return app.dataset.mode; }
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
  for (const detail of parent.querySelectorAll('details[data-disclosure-id]')) {
    if (detail.open) openThinkingDisclosures.add(detail.dataset.disclosureId);
    else openThinkingDisclosures.delete(detail.dataset.disclosureId);
  }
  parent.replaceChildren();
  for (const slip of slips) {
    if (slip.kind === 'thinking') {
      const detail = node('details', 'slip slip-thinking');
      detail.dataset.disclosureId = slip.id;
      detail.open = openThinkingDisclosures.has(slip.id);
      detail.addEventListener('toggle', () => {
        if (detail.open) openThinkingDisclosures.add(slip.id);
        else openThinkingDisclosures.delete(slip.id);
      });
      detail.append(node('summary', null, slip.label), node('p', null, slip.detail));
      parent.append(detail);
    } else if (slip.kind === 'speech') {
      const event = node('div', 'event resident intermediate-resident');
      event.append(node('span', 'event-label', slip.label), node('span', null, slip.detail));
      parent.append(event);
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

function renderLiveCard(card) {
  const row = node('section', `slip live-card card-${card.cardKind}`);
  row.append(node('div', 'live-card-heading', `${card.label} · ${card.state}`));
  if (card.detail) row.append(node('pre', 'live-card-detail', card.detail));
  if (card.pointer) row.append(node('div', 'live-card-pointer', card.pointer));
  if (card.cardKind === 'approval' && card.state === 'pending' && card.decidable && card.approvalId) {
    const actions = node('div', 'slip-decide');
    const confirm = node('button', null, 'Confirm');
    confirm.type = 'button';
    confirm.addEventListener('click', async () => {
      try { await decideApproval(card.approvalId, 'confirm'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
    });
    const reject = node('button', null, 'Reject');
    reject.type = 'button';
    reject.addEventListener('click', async () => {
      try { await decideApproval(card.approvalId, 'reject'); } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
    });
    actions.append(confirm, reject);
    row.append(actions);
  }
  return row;
}

function renderLiveTimeline(projection) {
  for (const detail of liveGap.querySelectorAll('details[data-disclosure-id]')) {
    if (detail.open) openThinkingDisclosures.add(detail.dataset.disclosureId);
    else openThinkingDisclosures.delete(detail.dataset.disclosureId);
  }
  const elements = [];
  for (const segment of projection.timeline) {
    if (segment.kind === 'phase') elements.push(node('div', 'slip phase', segment.label));
    if (segment.kind === 'thinking') {
      const disclosureId = `${projection.wakeId}:${segment.id}`;
      const detail = node('details', 'slip slip-thinking live-thinking');
      detail.dataset.disclosureId = disclosureId;
      detail.open = openThinkingDisclosures.has(disclosureId);
      detail.addEventListener('toggle', () => {
        if (detail.open) openThinkingDisclosures.add(disclosureId);
        else openThinkingDisclosures.delete(disclosureId);
      });
      detail.append(node('summary', null, 'Thinking'), node('p', null, segment.text));
      elements.push(detail);
    }
    if (segment.kind === 'speech' && segment.text) {
      const event = node('div', 'event resident provisional-resident intermediate-resident');
      event.append(node('span', 'event-label', 'Resident · en route'), node('span', null, segment.text));
      elements.push(event);
    }
    if (segment.kind === 'tool') {
      const detail = node('details', 'slip live-tool-call');
      const toolCall = segment.toolCall;
      const name = toolCall.name || toolCall.id || `#${toolCall.index}`;
      detail.append(node('summary', null, `Preparing tool · ${name}`));
      if (toolCall.id) detail.append(node('pre', 'live-machine-text', `id: ${toolCall.id}`));
      elements.push(detail);
    }
    if (segment.kind === 'card') elements.push(renderLiveCard(segment.card));
  }
  if (projection.draft && !projection.timeline.some(segment => segment.kind === 'speech')) {
    const event = node('div', 'event resident provisional-resident');
    event.append(node('span', 'event-label', 'Resident · provisional'), node('span', null, projection.draft));
    elements.push(event);
  }
  liveGap.replaceChildren(...elements);
}

function renderLive({ scrollSnapshot = null, forceTail = false } = {}) {
  const preservedScroll = scrollSnapshot || captureConversationScroll(conversationScroller, { forceTail });
  const projection = projectLiveState(liveState);
  const conversation = [];
  if (projection.optimisticUser) {
    const event = node('div', 'event user optimistic-user');
    event.append(node('span', 'event-label', 'You · sending'), node('span', null, projection.optimisticUser.content));
    conversation.push(event);
  }
  if (conversation.length) {
    const wake = node('article', 'wake live-wake');
    wake.append(...conversation);
    liveConversation.replaceChildren(wake);
  } else liveConversation.replaceChildren();

  renderLiveTimeline(projection);
  restoreConversationScroll(conversationScroller, preservedScroll);
}

function scheduleLiveRender() {
  if (liveRenderFrame !== null) return;
  liveRenderFrame = requestAnimationFrame(() => {
    liveRenderFrame = null;
    renderLive();
  });
}

function reconcileOptimisticUser(thread) {
  const optimistic = liveState.optimisticUser;
  if (!optimistic?.wakeId) return;
  const committed = (thread.events || []).some(event => event.wakeId === optimistic.wakeId && event.eventKind === 'utterance' && event.actorKind === 'user' && event.content === optimistic.content);
  if (committed) liveState = clearOptimisticUser(liveState);
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
  const preservedScroll = captureConversationScroll(conversationScroller);
  log.replaceChildren();
  reconcileOptimisticUser(data);
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
    const utterances = group.events.filter(item => item.eventKind === 'utterance' && (item.actorKind === 'user' || item.actorKind === 'resident'));
    for (const event of utterances.filter(item => item.actorKind === 'user')) {
      const eventElement = node('div', `event ${event.actorKind}`);
      eventElement.append(node('span', 'event-label', eventLabel(event)), node('span', null, event.content));
      wakeElement.append(eventElement);
    }
    const steps = wakeSlips.get(group.wake.id);
    if (steps?.length) {
      const rows = node('div', 'gap wake-timeline');
      renderSlips(rows, steps);
      wakeElement.append(rows);
    }
    for (const event of utterances.filter(item => item.actorKind === 'resident')) {
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
  renderLive({ scrollSnapshot: preservedScroll });
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
  appendBlock(panel, 'Glass casts', wake.glassCasts?.length ? JSON.stringify(wake.glassCasts, null, 2) : 'none', 'inspection-code');
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

function witnessState(state) {
  if (state === true || state === 'installed') return 'verified';
  if (state === 'optional_unwired') return 'optional';
  return 'missing';
}

function statusPill(label, state) {
  return node('span', `wire-status ${witnessState(state)}`, label);
}

function renderWitnessDetail(witness, selection) {
  const detail = node('div', 'marble-detail');
  const heading = node('div', 'marble-detail-heading');
  heading.append(node('span', null, selection === 'overview' ? witness.roomId : selection));
  heading.append(statusPill(witness.verified ? 'verified' : `${witness.gaps.length} gaps`, witness.verified));
  detail.append(heading);
  if (selection === 'overview') {
    appendBlock(detail, 'Installed path', `${witness.topology.requestedParent}\n→ ${witness.roomId}\n→ ${witness.topology.entranceId}`);
    appendBlock(detail, 'Evidence', `manifest ${witness.manifestHash}\nwitness ${witness.witnessHash}`, 'inspection-code');
    appendBlock(detail, 'Loose wires', witness.gaps.length ? witness.gaps.join('\n') : 'none', witness.gaps.length ? 'omitted' : '');
    return detail;
  }
  if (selection === 'topology') {
    for (const [label, value] of Object.entries(witness.topology)) appendBlock(detail, label, String(value), value === false ? 'omitted' : '');
    return detail;
  }
  if (selection === 'sockets') {
    for (const socket of witness.sockets) {
      const block = node('section', 'wire-card');
      block.append(node('div', 'wire-card-heading', socket.id), statusPill(socket.binding?.state || 'missing', socket.binding?.state));
      block.append(node('div', 'wire-path', `${socket.capability}\n→ ${socket.binding?.implementation || 'unbound'}`));
      detail.append(block);
    }
    return detail;
  }
  if (selection === 'custody') {
    for (const route of witness.custody) {
      const block = node('section', 'wire-card');
      block.append(node('div', 'wire-card-heading', route.id), statusPill(route.binding?.state || 'missing', route.binding?.state));
      block.append(node('div', 'wire-path', route.binding?.implementation || 'unbound'));
      detail.append(block);
    }
    return detail;
  }
  const affordance = witness.affordances.find(item => item.id === selection);
  if (affordance) {
    appendBlock(detail, 'Path', `${witness.roomId}\n→ ${affordance.fixtureId}\n→ ${affordance.id}\n→ ${affordance.effect}`);
    for (const tool of affordance.tools) {
      const block = node('section', 'tool-wire');
      const complete = tool.ceiling && tool.mounted && tool.schemaHash && tool.handler && tool.approvalClass;
      block.append(node('div', 'wire-card-heading', tool.name), statusPill(complete ? 'closed' : 'loose', Boolean(complete)));
      block.append(node('div', 'wire-path', `Ceiling ${tool.ceiling ? '✓' : '×'} → mount ${tool.mounted ? '✓' : '×'} → schema ${tool.schemaHash ? '✓' : '×'} → handler ${tool.handler ? '✓' : '×'} → approval ${tool.approvalClass || 'missing'}`));
      if (tool.schemaHash) block.append(node('div', 'wire-hash', tool.schemaHash));
      detail.append(block);
    }
    return detail;
  }
  return detail;
}

function renderMarbleInspector(world) {
  const witness = world.installations?.[0];
  const panel = node('div', 'marble-inspector');
  if (!witness) { appendBlock(panel, 'Installation witness', 'No room installation witness is available.', 'omitted'); return panel; }
  const summary = node('div', 'marble-summary');
  summary.append(node('div', 'marble-orb', witness.verified ? '●' : '!'));
  const title = node('div');
  title.append(node('div', 'marble-title', witness.roomId), node('div', 'marble-subtitle', witness.verified ? 'All declared wires close' : `${witness.gaps.length} loose wires`));
  summary.append(title, statusPill(witness.verified ? 'verified' : 'drift', witness.verified));
  const body = node('div', 'marble-browser');
  const nav = node('nav', 'marble-nav');
  const choices = [
    ['overview', 'Overview'], ['topology', 'Topology'],
    ...witness.affordances.map(item => [item.id, item.id.replace('affordance.', '').replaceAll('_', ' ')]),
    ['sockets', 'Sockets'], ['custody', 'Custody'],
  ];
  const detailHost = node('div', 'marble-detail-host');
  function select(id) {
    currentMarbleSelection = id;
    for (const button of nav.querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.selection === id));
    detailHost.replaceChildren(renderWitnessDetail(witness, id));
  }
  for (const [id, label] of choices) {
    const button = node('button', 'marble-nav-item', label);
    button.type = 'button'; button.dataset.selection = id;
    button.addEventListener('click', () => select(id));
    nav.append(button);
  }
  body.append(nav, detailHost);
  panel.append(summary, body);
  select(choices.some(([id]) => id === currentMarbleSelection) ? currentMarbleSelection : 'overview');
  return panel;
}

function renderWorldSurface() {
  trayTabs.replaceChildren();
  for (const [id, label] of [['marble', 'Marble'], ['world', 'World data']]) {
    const tab = node('button', 'tray-tab', label);
    tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(currentWorldTab === id));
    tab.addEventListener('click', () => { currentWorldTab = id; renderWorldSurface(); });
    trayTabs.append(tab);
  }
  panelHost.replaceChildren(currentWorldTab === 'marble' ? renderMarbleInspector(currentWorld) : renderWorld(currentWorld));
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
  try { currentWorld = await request('/api/world'); currentWorldTab = 'marble'; currentMarbleSelection = 'overview'; trayHeading.textContent = 'Marble inspector'; app.dataset.surface = 'marble'; tray.hidden = false; renderWorldSurface(); panelHost.focus({ preventScroll: true }); }
  catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

async function inspectApprovals() {
  try {
    const data = await request('/api/approvals');
    currentApprovals = data.approvals || [];
    trayHeading.textContent = 'Approvals'; delete app.dataset.surface; tray.hidden = false;
    trayTabs.replaceChildren();
    panelHost.replaceChildren(renderApprovals(currentApprovals));
    panelHost.focus({ preventScroll: true });
  } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

function renderInspection() {
  trayHeading.textContent = 'Wake inspection'; delete app.dataset.surface;
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
    currentInspectionTab = 'summary'; tray.hidden = false; renderInspection(); panelHost.focus({ preventScroll: true });
  } catch (error) { setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed'); }
}

async function refresh() {
  const [health, thread] = await Promise.all([request('/api/health'), request('/api/thread?scope=active')]);
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
  if (!busy || slipPollBusy || liveState.connection === 'open') return;
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

function reconcileWakeOnce(wakeId, terminalKind = 'wake.completed') {
  if (!wakeId) return Promise.resolve();
  const existing = terminalReconciliations.get(wakeId);
  if (existing) return existing;
  const reconciliation = (async () => {
    await retainWakeSlips(wakeId).catch(() => {});
    await refresh().catch(() => {});
    liveState = clearLiveWake(liveState, wakeId);
    renderLive();
    stopSlipPoll();
    gap.replaceChildren();
    setState(terminalKind === 'wake.failed' ? 'failed' : 'committed');
  })();
  terminalReconciliations.set(wakeId, reconciliation);
  return reconciliation;
}

async function reconcileTerminal(terminal) {
  if (!terminal || terminal.sequence <= terminalReconcileSequence) return;
  terminalReconcileSequence = terminal.sequence;
  await reconcileWakeOnce(terminal.wakeId, terminal.kind);
}

async function resyncLiveEvents() {
  if (resyncInFlight) return;
  resyncInFlight = true;
  let recovered = false;
  closeLiveEventSource();
  liveState = setLiveConnection(liveState, 'disconnected');
  renderLive();
  try {
    liveState = await recoverHubEventHistory(liveState, (afterSequence, limit) => request(`/api/events/history?after=${afterSequence}&limit=${limit}`));
    renderLive();
    const projection = projectLiveState(liveState);
    setState(projection.status);
    if (projection.terminal) await reconcileTerminal(projection.terminal);
    recovered = true;
  } catch {
    liveState = setLiveConnection(liveState, 'disconnected');
    renderLive();
    startSlipPoll();
    scheduleLiveRecovery();
  } finally {
    resyncInFlight = false;
    if (recovered) openLiveEventSource(liveState.lastSequence);
  }
}

function receiveHubEvent(messageEvent) {
  let envelope;
  try { envelope = JSON.parse(messageEvent.data); } catch { return; }
  const next = reduceHubEvent(liveState, envelope);
  if (next === liveState) return;
  liveState = next;
  const projection = projectLiveState(liveState);
  scheduleLiveRender();
  setState(projection.status);
  if (projection.resyncRequired) void resyncLiveEvents();
  if (projection.terminal) void reconcileTerminal(projection.terminal);
}

function closeLiveEventSource() {
  unregisterLiveEvents?.();
  unregisterLiveEvents = null;
  liveEventSource?.close();
  liveEventSource = null;
}

function scheduleLiveRecovery() {
  if (liveUnloading || liveRecoveryTimer !== null) return;
  liveRecoveryTimer = setTimeout(() => {
    liveRecoveryTimer = null;
    if (liveState.resyncRequired) void resyncLiveEvents();
    else openLiveEventSource(liveState.lastSequence);
  }, 1000);
}

function openLiveEventSource(afterSequence) {
  if (liveUnloading || typeof EventSource !== 'function' || liveEventSource) return;
  const path = Number.isInteger(afterSequence) ? `/api/events?after=${afterSequence}` : '/api/events';
  const source = new EventSource(path);
  liveEventSource = source;
  unregisterLiveEvents = registerHubEventSource(source, receiveHubEvent);
  source.addEventListener('open', () => {
    if (liveEventSource !== source) return;
    liveState = setLiveConnection(liveState, 'open');
    renderLive();
  });
  source.addEventListener('error', () => {
    if (liveEventSource !== source) return;
    liveState = setLiveConnection(liveState, 'disconnected');
    renderLive();
    if (busy) void pollSlips();
  });
}

if (typeof EventSource === 'function') {
  openLiveEventSource();
  window.addEventListener('beforeunload', () => {
    liveUnloading = true;
    if (liveRecoveryTimer !== null) clearTimeout(liveRecoveryTimer);
    closeLiveEventSource();
  }, { once: true });
} else liveState = setLiveConnection(liveState, 'unavailable');

async function submitWake(event) {
  event.preventDefault();
  if (busy) return;
  const submitted = input.value;
  if (!submitted.trim()) return;
  const localId = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`;
  liveState = setOptimisticUser(liveState, submitted, localId);
  renderLive({ forceTail: true });
  busy = true; input.disabled = true; sendButton.disabled = true; setState('assembling');
  setTimeout(() => { if (busy) setState('orienting'); }, 0);
  startSlipPoll();
  try {
    const wake = await request('/api/wakes?projection=compact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: submitted }) });
    input.value = '';
    if (!liveState.optimisticUser?.wakeId) liveState = clearOptimisticUser(liveState);
    if (wake.__failedWake || wake.status === 'failed') {
      setState('failed');
      await refresh();
      liveState = clearLiveWake(liveState, wake.id);
      renderLive();
      if (wake.id) { currentWake = wake; currentInspectionTab = 'summary'; tray.hidden = false; renderInspection(); }
      statusEl.title = wake.failureMessage || wake.failureCode || 'Wake failed';
      return;
    }
    setState('committed');
    await reconcileWakeOnce(wake.id);
    setState('committed');
    setTimeout(() => { if (!busy) setState('idle'); }, 1200);
    if (wake.id) currentWake = wake;
  } catch (error) {
    setState(error.code === 'host_unavailable' ? 'host unavailable' : 'failed');
    statusEl.title = error.message || error.code || 'failed';
    await refresh().catch(() => {});
    liveState = clearLiveWake(clearOptimisticUser(liveState));
    renderLive();
  } finally {
    stopSlipPoll();
    gap.replaceChildren();
    busy = false; input.disabled = false; sendButton.disabled = false; input.focus({ preventScroll: true });
  }
}

chip.addEventListener('click', () => { void setMode('expanded'); });
document.querySelector('#btn-compact').addEventListener('click', () => { void setMode('compact'); });
inspectWorldButton.addEventListener('click', inspectWorld);
inspectApprovalsButton.addEventListener('click', inspectApprovals);
document.querySelector('#close-tray').addEventListener('click', () => { tray.hidden = true; currentWake = null; currentWorld = null; delete app.dataset.surface; trayHeading.textContent = 'Wake inspection'; });
form.addEventListener('submit', submitWake);

waveCompact.start();
if (desktopShell) {
  const disposeDesktopMode = desktopShell.onMode(applyMode);
  window.addEventListener('beforeunload', disposeDesktopMode, { once: true });
  desktopShell.getMode().then(applyMode).catch(() => applyMode('compact'));
} else if (window.matchMedia('(max-width: 700px)').matches) applyMode('expanded');
else applyMode('compact');
refresh().catch(() => { modeModel.textContent = 'unavailable · host'; setState('host unavailable'); });
