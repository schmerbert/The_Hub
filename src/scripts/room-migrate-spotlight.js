import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readConfig } from '../core/config.js';
import { verifyWorldSqlite } from '../world/events.js';
import { WorldGraphStore } from '../world/graph.js';
import {
  inspectSpotlightInstallationUpgrade,
  migrateSpotlightInstallation,
  SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND,
} from '../rooms/installation-runtime.js';

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(`Usage: ${SPOTLIGHT_INSTALLATION_MIGRATION_COMMAND}

Without --apply this command inspects the configured World database read-only.
Applying appends one strict room.installation.revised/v1 World event and its forward installation receipt atomically; Hub startup never applies it.
Before --apply, create and verify a recoverable byte-for-byte backup, then pass --backup-confirmed.`);
  process.exit(0);
}

const config = readConfig(process.env);
const verificationOptions = { mismatchLimit: 50, requireHearth: true, requireForest: true, requireBinderWindow: true, requireSpotlight: true };
if (!existsSync(config.worldPath)) {
  console.error(JSON.stringify({ worldPath: config.worldPath, status: 'database_missing' }, null, 2));
  process.exitCode = 1;
} else if (!args.has('--apply')) {
  let sqlite;
  try {
    sqlite = new DatabaseSync(config.worldPath, { readOnly: true });
    const verification = verifyWorldSqlite(sqlite, verificationOptions);
    if (!verification.verified) {
      console.log(JSON.stringify({ worldPath: config.worldPath, status: 'world_unverified', verification }, null, 2));
      process.exitCode = 1;
    } else if (!sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='room_installation_receipts'").get()) {
      console.log(JSON.stringify({ worldPath: config.worldPath, status: 'installation_receipt_missing', verification }, null, 2));
      process.exitCode = 1;
    } else {
      const inspection = inspectSpotlightInstallationUpgrade({ sqlite });
      console.log(JSON.stringify({ worldPath: config.worldPath, ...inspection, verification }, null, 2));
      if (!['current', 'upgrade_required'].includes(inspection.status)) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ worldPath: config.worldPath, status: 'inspection_failed', code: error.code || 'inspection_failed', message: error.message }, null, 2));
    process.exitCode = 1;
  } finally { sqlite?.close(); }
} else if (!args.has('--backup-confirmed')) {
  console.error(JSON.stringify({ worldPath: config.worldPath, status: 'backup_confirmation_required', backupExpectation: 'Create and verify a recoverable byte-for-byte backup, then rerun with --apply --backup-confirmed.' }, null, 2));
  process.exitCode = 2;
} else {
  let world;
  try {
    world = new WorldGraphStore(config.worldPath, { topologyVersion: 'spotlight' });
    const result = migrateSpotlightInstallation(world, { backupConfirmed: true });
    console.log(JSON.stringify({ worldPath: config.worldPath, ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ worldPath: config.worldPath, status: 'migration_refused', code: error.code || 'migration_refused', message: error.message, command: error.command }, null, 2));
    process.exitCode = error.code === 'room_installation_backup_required' ? 2 : 1;
  } finally { world?.close(); }
}
