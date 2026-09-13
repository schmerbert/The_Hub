// World owns action-receipt custody. This projector derives reading progress
// without adding mutable state or allowing callers to depend on receipt tables.
export function documentReadCoverage(world, { sessionId, path, revision }) {
  world.assertVerified();
  const rows = world.sqlite.prepare("SELECT result_json FROM world_action_receipts WHERE session_id=? AND outcome='committed' AND tool_name='workshop_document_read' ORDER BY created_at,receipt_id").all(sessionId);
  const ranges = [];
  for (const row of rows) {
    let result; try { result = JSON.parse(row.result_json); } catch { continue; }
    if (result?.kind === 'workshop_document_read' && result?.source?.path === path && result?.documentRevision === revision && Number.isInteger(result.source.startLine) && Number.isInteger(result.source.endLine)) ranges.push([result.source.startLine, result.source.endLine]);
  }
  return ranges;
}
