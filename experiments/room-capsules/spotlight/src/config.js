import { readFileSync } from 'node:fs';

export function readLocalJson(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function loadManifest() {
  return readLocalJson('../room.json');
}

export function loadRecordedReplay() {
  return readLocalJson('../fixtures/recorded-replay.json');
}
