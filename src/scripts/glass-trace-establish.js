import { resolve } from 'node:path';
import { loadEnvFile } from '../core/env.js';
import { readConfig } from '../core/config.js';
import { HubDatabase } from '../ledger/source.js';

loadEnvFile();
const config = readConfig(process.env);
const path = resolve(config.dbPath);
const db = new HubDatabase(path, { openSession: false });
try {
  const result = db.establishGlassTraceEpoch(); const epoch = result.epoch;
  console.log(JSON.stringify({ status: result.status, path, epochId: epoch.id, boundaryKind: epoch.boundaryKind,
    preBoundaryHeadHash: epoch.preBoundaryHeadHash, establishedAt: epoch.establishedAt }, null, 2));
} finally { db.close(); }
