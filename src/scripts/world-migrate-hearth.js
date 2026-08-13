import { readConfig } from '../core/config.js';
import { WorldGraphStore } from '../world/graph.js';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(`Usage: npm run world:migrate-hearth -- [--apply --backup-confirmed]

Without --apply this command inspects the configured World database without changing it.
Applying requires an exact verified B1 World and explicit confirmation of a recoverable backup.`);
  process.exit(0);
}

const config = readConfig(process.env);
const world = new WorldGraphStore(config.worldPath, { topologyVersion: 'b1' });
try {
  const inspection = world.inspectHearthUpgrade();
  if (!args.has('--apply')) {
    console.log(JSON.stringify({ worldPath: config.worldPath, mode: 'inspect_read_only', ...inspection }, null, 2));
    if (!['current', 'upgrade_required'].includes(inspection.status)) process.exitCode = 1;
  } else if (!args.has('--backup-confirmed')) {
    console.error(JSON.stringify({ worldPath: config.worldPath, status: 'backup_confirmation_required', backupExpectation: inspection.backupExpectation }, null, 2));
    process.exitCode = 2;
  } else if (inspection.status !== 'upgrade_required') {
    console.error(JSON.stringify({ worldPath: config.worldPath, status: 'migration_refused', inspection }, null, 2));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ worldPath: config.worldPath, mode: 'apply', ...world.migrateHearth({ backupConfirmed: true }) }, null, 2));
} finally { world.close(); }
