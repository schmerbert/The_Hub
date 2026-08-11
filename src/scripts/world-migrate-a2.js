import { readConfig } from '../core/config.js';
import { inspectWorldA2UpgradeDatabase } from '../world/events.js';
import { WorldGraphStore } from '../world/graph.js';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(`Usage: npm run world:migrate-a2 -- [--apply --backup-confirmed]

Without --apply this command inspects the configured World database read-only.
Applying is limited to a verified journal-bearing A1 database and is never run by Hub startup.
Before --apply, create and verify a recoverable byte-for-byte backup, then pass --backup-confirmed.
Never apply this command to the live runtime database without an intentional maintenance window.`);
  process.exit(0);
}

const config = readConfig(process.env);
const inspection = inspectWorldA2UpgradeDatabase(config.worldPath, { mismatchLimit: 50 });
if (!args.has('--apply')) {
  console.log(JSON.stringify({ worldPath: config.worldPath, mode: 'inspect_read_only', ...inspection }, null, 2));
  if (!['current', 'upgrade_required'].includes(inspection.status)) process.exitCode = 1;
} else if (!args.has('--backup-confirmed')) {
  console.error(JSON.stringify({ worldPath: config.worldPath, status: 'backup_confirmation_required', backupExpectation: 'Create and verify a recoverable byte-for-byte backup, then rerun with --apply --backup-confirmed.' }, null, 2));
  process.exitCode = 2;
} else if (inspection.status !== 'upgrade_required') {
  console.error(JSON.stringify({ worldPath: config.worldPath, status: 'migration_refused', inspection }, null, 2));
  process.exitCode = 1;
} else {
  const world = new WorldGraphStore(config.worldPath);
  try {
    const result = world.migrateA2({ backupConfirmed: true });
    console.log(JSON.stringify({ worldPath: config.worldPath, mode: 'apply', ...result }, null, 2));
  } finally { world.close(); }
}
