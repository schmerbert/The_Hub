import { resolve } from 'node:path';
import { migrateForestTraversalV3 } from '../src/forest/traversal-store.js';

const [pathArg, backupArg] = process.argv.slice(2);
if (!pathArg || !backupArg) throw new Error('Usage: node scripts/migrate-forest-traversal-v3.mjs <store.sqlite> <backup.sqlite>');
console.log(JSON.stringify(migrateForestTraversalV3({ path:resolve(pathArg), backupPath:resolve(backupArg) }), null, 2));
