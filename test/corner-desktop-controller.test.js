import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createDesktopController, DESKTOP_IPC } from '../src/corner/desktop-controller.js';
import {
  createDesktopExpansionQueue,
  desktopLaunchIntent,
  DESKTOP_QUIT_EXISTING_FLAG,
  routeDesktopSecondInstance,
} from '../src/corner/electron-main.js';

function fixture({ alwaysOnTop = true } = {}) {
  const windows = [];
  const trays = [];
  const handlers = new Map();
  let quitCalls = 0;
  class WebContents extends EventEmitter {
    constructor() {
      super();
      this.id = 41;
      this.url = '';
      this.messages = [];
      this.openHandler = null;
      this.permissionRequest = null;
      this.permissionCheck = null;
      this.session = {
        setPermissionRequestHandler: handler => { this.permissionRequest = handler; },
        setPermissionCheckHandler: handler => { this.permissionCheck = handler; },
      };
    }
    getURL() { return this.url; }
    isDestroyed() { return false; }
    send(...message) { this.messages.push(message); }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = new WebContents(); this.visible = false; this.hidden = false; this.destroyed = false; this.topLevels = [];
      windows.push(this);
    }
    async loadURL(url) { this.loadedUrl = url; this.webContents.url = url; this.emit('ready-to-show'); }
    getBounds() { return this.bounds; }
    setBounds(bounds, animate) { this.bounds = bounds; this.animate = animate; }
    setAlwaysOnTop(value, level) { this.topLevels.push({ value, level }); }
    show() { this.visible = true; this.hidden = false; }
    hide() { this.visible = false; this.hidden = true; }
    focus() { this.focused = true; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  class FakeTray extends EventEmitter {
    constructor(icon) { super(); this.icon = icon; trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    destroy() { this.destroyed = true; }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const ipcMain = {
    handle: (name, handler) => handlers.set(name, handler),
    removeHandler: name => handlers.delete(name),
  };
  const controller = createDesktopController({
    BrowserWindow: FakeWindow,
    Tray: FakeTray,
    Menu: { buildFromTemplate: template => template },
    nativeImage: { createFromBuffer: body => ({ body }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => display,
      getDisplayMatching: () => display,
    },
    ipcMain,
    baseUrl: 'http://127.0.0.1:3123',
    preloadPath: 'C:\\hub\\preload.cjs',
    requestQuit: async () => { quitCalls += 1; },
    alwaysOnTop,
  });
  return { controller, windows, trays, handlers, quitCalls: () => quitCalls };
}

test('desktop controller creates a secure opaque compact window and tray', async () => {
  const f = fixture();
  await f.controller.create();
  const win = f.windows[0];
  assert.deepEqual({ x: win.options.x, y: win.options.y, width: win.options.width, height: win.options.height }, { x: 1800, y: 960, width: 96, height: 96 });
  assert.equal(win.options.frame, false);
  assert.equal(win.options.transparent, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.webSecurity, true);
  assert.equal(win.loadedUrl, 'http://127.0.0.1:3123/?shell=desktop');
  assert.deepEqual(win.webContents.openHandler(), { action: 'deny' });
  assert.equal(win.webContents.permissionCheck(), false);
  let permissionAllowed = true;
  win.webContents.permissionRequest(null, 'camera', value => { permissionAllowed = value; });
  assert.equal(permissionAllowed, false);
  assert.equal(f.trays[0].tooltip, 'The Hub — Corner');
  f.controller.destroy();
  assert.equal(f.handlers.size, 0);
});

test('desktop controller validates IPC sender, synchronizes modes, and hides ordinary close', async () => {
  const f = fixture();
  await f.controller.create();
  const win = f.windows[0];
  const trusted = { sender: win.webContents, senderFrame: { url: win.loadedUrl } };
  const foreign = { sender: { id: 999, getURL: () => 'http://127.0.0.1:3123/' }, senderFrame: { url: 'http://127.0.0.1:3123/' } };
  assert.throws(() => f.handlers.get(DESKTOP_IPC.getMode)(foreign), error => error.code === 'corner_desktop_ipc_refused');
  const wrongPage = { sender: win.webContents, senderFrame: { url: 'http://127.0.0.1:3123/api/health' } };
  assert.throws(() => f.handlers.get(DESKTOP_IPC.getMode)(wrongPage), error => error.code === 'corner_desktop_ipc_refused');
  assert.equal(f.handlers.get(DESKTOP_IPC.getMode)(trusted), 'compact');
  assert.equal(f.handlers.get(DESKTOP_IPC.setMode)(trusted, 'expanded'), 'expanded');
  assert.deepEqual(win.bounds, { x: 916, y: 376, width: 980, height: 680 });
  assert.deepEqual(win.topLevels.at(-1), { value: true, level: 'normal' });
  assert.throws(() => f.handlers.get(DESKTOP_IPC.setMode)(trusted, 'hidden'), TypeError);
  const closeEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  win.emit('close', closeEvent);
  assert.equal(closeEvent.prevented, true);
  assert.equal(win.hidden, true);
  assert.equal(f.controller.getMode(), 'compact');
});

test('desktop controller denies external navigation and tray quit uses the owned shutdown path', async () => {
  const f = fixture({ alwaysOnTop: false });
  await f.controller.create();
  const win = f.windows[0];
  const external = { prevented: false, preventDefault() { this.prevented = true; } };
  win.webContents.emit('will-navigate', external, 'https://example.com/');
  assert.equal(external.prevented, true);
  const samePage = { prevented: false, preventDefault() { this.prevented = true; } };
  win.webContents.emit('will-navigate', samePage, 'http://127.0.0.1:3123/?shell=desktop');
  assert.equal(samePage.prevented, false);
  assert.equal(win.options.alwaysOnTop, false);
  f.trays[0].menu.at(-1).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.quitCalls(), 1);
});

test('desktop expansion requests queue until asynchronous startup attaches the controller', () => {
  const queue = createDesktopExpansionQueue();
  const calls = [];
  assert.equal(queue.request(), null);
  assert.equal(queue.request(), null);
  assert.equal(queue.pending(), true);
  queue.attach({ expand: () => { calls.push('expand'); return 'expanded'; } });
  assert.deepEqual(calls, ['expand']);
  assert.equal(queue.pending(), false);
  assert.equal(queue.request(), 'expanded');
  assert.deepEqual(calls, ['expand', 'expand']);
});

test('desktop command-line routing preserves expansion and privately requests graceful quit', () => {
  const calls = [];
  const handlers = {
    requestQuit: () => calls.push('quit'),
    requestExpand: () => calls.push('expand'),
  };
  assert.equal(desktopLaunchIntent(['electron.exe', '.']), 'start');
  assert.equal(routeDesktopSecondInstance(['electron.exe', '.'], handlers), 'start');
  assert.equal(desktopLaunchIntent(['electron.exe', '.', DESKTOP_QUIT_EXISTING_FLAG]), 'quit-existing');
  assert.equal(routeDesktopSecondInstance(['electron.exe', '.', DESKTOP_QUIT_EXISTING_FLAG], handlers), 'quit-existing');
  assert.deepEqual(calls, ['expand', 'quit']);
  assert.throws(() => routeDesktopSecondInstance([], {}), /quit and expand handlers/);
});

test('double-click scripts expose start.bat, use the pinned Electron binary, and keep a graceful single-instance stop path', async () => {
  const [frontDoor, startScript, stopScript] = await Promise.all([
    readFile(new URL('../start.bat', import.meta.url), 'utf8'),
    readFile(new URL('../start-hub.bat', import.meta.url), 'utf8'),
    readFile(new URL('../stop-hub.bat', import.meta.url), 'utf8'),
  ]);
  assert.match(frontDoor, /call "%~dp0start-hub\.bat"/i);
  assert.doesNotMatch(frontDoor, /electron|taskkill/i);
  for (const script of [startScript, stopScript]) {
    assert.match(script, /cd \/d "%~dp0"/i);
    assert.match(script, /node_modules\\electron\\dist\\electron\.exe/i);
    assert.match(script, /Run npm install/i);
    assert.doesNotMatch(script, /taskkill/i);
  }
  assert.match(startScript, /start "" "%HUB_ELECTRON%" "\."/i);
  assert.match(stopScript, /"%HUB_ELECTRON%" "\." "--quit-existing"/i);
});

test('preload and renderer expose only window mode IPC while preserving narrow-browser behavior', async () => {
  const [preload, app, css, html] = await Promise.all([
    readFile(new URL('../src/corner/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(preload, /getMode/); assert.match(preload, /setMode/); assert.match(preload, /onMode/);
  assert.doesNotMatch(preload, /provider|sqlite|vault:|api\/wakes|filesystem|readFile/);
  assert.match(app, /!desktopShell && window\.matchMedia/);
  assert.match(app, /if \(desktopShell\) \{\s*conversationScroller = node\('div', 'conversation-scroll'\)/);
  assert.match(app, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /panelHost\.focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /html\[data-shell="desktop"\] #app\[data-mode="compact"\] \.chip/);
  assert.match(css, /#app\[data-mode="compact"\] \.chip \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  assert.match(css, /#app\[data-mode="expanded"\] \.bench \{[\s\S]*?height: 100%;[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.tray\[hidden\] \+ \.rail \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.workspace \{ display: grid; grid-template-columns: minmax\(250px, \.9fr\) 1\.1fr;/);
  assert.match(css, /\.conversation-scroll \{[\s\S]*?overflow-y: scroll;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(css, /html\[data-shell="desktop"\] \.conversation-scroll \{ -webkit-app-region: no-drag; \}/);
  assert.match(css, /\.panel-host \{[\s\S]*?overflow-y: scroll;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self'/);
});
