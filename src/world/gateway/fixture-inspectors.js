import { KILN_FIXTURE_ID } from '../graph.js';

const FIXTURE_INSPECTORS = Object.freeze({
  'fixture.binder_window': ({ binderWindow }) => binderWindow || {
    kind: 'binder_window_projection',
    apiVersion: 'binder-window.v1',
    identity: 'window.binder',
    availability: 'dormant',
    reason: 'missing_snapshot',
    readable: false,
  },
  'fixture.workshop_clipboard': ({ world, sessionId }) => ({ kind: 'clipboard', brief: world.getBrief(sessionId) }),
  'fixture.workshop_workbench': ({ world, sessionId }) => {
    const pending = world.listApprovals(sessionId, { pendingOnly: true })
      .map(approval => ({ approvalId: approval.approvalId, kind: approval.kind, status: approval.status }));
    return { kind: 'workbench', pendingApprovals: pending.length, pending };
  },
  [KILN_FIXTURE_ID]: ({ world, fixtureId }) => ({ kind: 'kiln', ...(world.getFixtureRuntime(fixtureId) || { status: 'idle' }) }),
  'fixture.workshop_ledger': ({ git }) => {
    const status = git.status();
    const lines = status.stdout.split(/\r?\n/).filter(Boolean);
    const branch = lines.find(line => line.startsWith('## ')) || null;
    const changes = lines.filter(line => !line.startsWith('## '));
    return { kind: 'ledger', ok: status.ok, branch, dirty: changes.length > 0, truncated: Boolean(status.truncated), changeCount: changes.length };
  },
  'fixture.workshop_shelves': ({ workshop }) => {
    const listing = workshop.list('.');
    const entries = listing.entries.slice(0, 40).map(entry => ({ name: entry.name, type: entry.type }));
    return { kind: 'shelves', entries, truncated: listing.entries.length > entries.length };
  },
});

export const FIXTURE_INSPECTOR_IDS = Object.freeze(Object.keys(FIXTURE_INSPECTORS));

export function inspectFixtureContents({ world, workshop, git, binderWindow = null, sessionId, fixtureId }) {
  const inspector = FIXTURE_INSPECTORS[fixtureId];
  if (inspector) return inspector({ world, workshop, git, binderWindow, sessionId, fixtureId });
  return { kind: 'fixture', text: world.node(fixtureId)?.resident_text || '' };
}
