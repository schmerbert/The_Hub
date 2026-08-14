import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Corner carries an expandable navigable Marble Inspector backed by installation witnesses', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="inspect-world"/);
  assert.match(app, /world\.installations/);
  assert.match(app, /renderMarbleInspector/);
  assert.match(app, /renderWitnessDetail/);
  assert.match(app, /currentMarbleSelection/);
  assert.match(app, /manifestHash/);
  assert.match(app, /witnessHash/);
  assert.match(app, /Ceiling.*mount.*schema.*handler.*approval/);
  assert.match(app, /app\.dataset\.surface = 'marble'/);
  assert.match(css, /#app\[data-surface="marble"\] \.workspace/);
  assert.match(css, /\.marble-browser/);
  assert.match(css, /\.wire-status\.verified/);
  assert.match(css, /\.wire-status\.optional/);
  assert.match(css, /\.wire-status\.missing/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.marble-browser \{ grid-template-columns: 1fr;/);
});

test('Marble Inspector remains a read-only projection with no mutation endpoint', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const inspector = app.slice(app.indexOf('function renderWitnessDetail'), app.indexOf('function renderApprovals'));
  assert.doesNotMatch(inspector, /method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(inspector, /\/api\/approvals|\/api\/messages/);
});
