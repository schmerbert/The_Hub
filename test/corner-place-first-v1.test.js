import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Corner presents truthful place before machinery and keeps Builder detail behind the wall', async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="place-name"/);
  assert.match(html, /id="place-bearing"/);
  assert.match(html, /id="reach-list"/);
  assert.match(html, />Behind the wall</);
  assert.match(app, /projection\?\.roomId \|\| health\.currentRoom\?\.roomId/);
  assert.match(app, /projection\?\.text \|\| health\.currentRoom\?\.text/);
  assert.match(app, /Array\.isArray\(world\?\.tools\)/);
  assert.match(app, /placeWorldSignature !== nextPlaceWorldSignature/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.match(css, /\.rail-body \{ display: grid; grid-template-columns:/);
  assert.match(css, /\.within-reach/);
  assert.match(css, /#app\[data-place="house"\]/);
  assert.match(css, /#app\[data-place="garden"\]/);
  assert.match(css, /#app\[data-place="forest"\]/);
  assert.match(css, /#app\[data-place="workshop"\]/);
  assert.match(css, /#app\[data-place="spotlight"\]/);
});

test('conversation typography is built only from textContent-backed nodes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /function readableText\(content\)/);
  assert.match(app, /body\.append\(node\('div', kind, line \|\|/);
  assert.match(app, /appendEventText\(eventElement, eventLabel\(event\), event\.content\)/);
  assert.doesNotMatch(app, /insertAdjacentHTML|DOMParser|createContextualFragment/);
});

test('Corner holds the composer behind explicit Forest readiness', async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="compose"/);
  assert.match(app, /function composerGate\(health\)/);
  assert.match(app, /status: 'Forest waking…'/);
  assert.match(app, /placeholder: 'Forest waking…'/);
  assert.match(app, /placeholder: 'Continuity unavailable'/);
  assert.match(app, /input\.disabled = locked/);
  assert.match(app, /sendButton\.disabled = locked/);
  assert.match(app, /syncComposer\(latestHealth\)/);
  assert.match(app, /readinessPoll = setInterval/);
  assert.match(css, /data-state="Forest waking…"/);
});

test('browser conversation owns a bounded wheel-scroll viewport', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.bench \{[^}]*height: min\(740px, calc\(100vh - 1\.5rem\)\);[^}]*grid-template-rows: auto minmax\(0, 1fr\);[^}]*overflow: hidden/s);
  assert.match(css, /\.rail \{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto;[^}]*overflow: hidden/s);
  assert.match(css, /\.rail-body \{[^}]*min-height: 0;[^}]*overflow: hidden/s);
  assert.match(css, /\.conversation-column \{[^}]*min-height: 0;[^}]*overflow-y: scroll;[^}]*overscroll-behavior: contain;[^}]*scrollbar-gutter: stable/s);
  assert.match(css, /\.bench \{ width: 100%; height: 100vh; min-height: 0;/);
  assert.match(css, /\.rail-body \{ grid-template-columns: 1fr; grid-template-rows: minmax\(0, 1fr\) auto; \}/);
  assert.match(css, /html\[data-shell="desktop"\] \.conversation-column \{ display: grid; grid-template-rows: minmax\(0, 1fr\); overflow: hidden; \}/);
});
