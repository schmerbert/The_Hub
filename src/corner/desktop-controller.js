import { activeDisplay, COMPACT_WINDOW_SIZE, CORNER_MARGIN, cornerBounds, EXPANDED_WINDOW_SIZE } from './window-geometry.js';

export const DESKTOP_MODES = Object.freeze(['compact', 'expanded']);
export const DESKTOP_IPC = Object.freeze({ getMode: 'corner:get-mode', setMode: 'corner:set-mode', modeChanged: 'corner:mode-changed' });

const TRAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2NkYGD4z0ABYBzVMKoBBgQGwP//GRgYGEc1jGoAA0Y1jGoAA0Y1jGoAA0Y1jGoAAG8sAxX0G3gqAAAAAElFTkSuQmCC';

function assertedMode(value) {
  if (!DESKTOP_MODES.includes(value)) throw new TypeError('Corner desktop mode must be compact or expanded.');
  return value;
}

function pageAddress(baseUrl) {
  const url = new URL('/', baseUrl);
  url.searchParams.set('shell', 'desktop');
  return url;
}

export function createDesktopController({
  BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain,
  baseUrl, preloadPath, requestQuit, alwaysOnTop = true, margin = CORNER_MARGIN,
} = {}) {
  if (![BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain].every(Boolean)) throw new TypeError('Electron desktop adapters are required.');
  if (typeof requestQuit !== 'function') throw new TypeError('A desktop quit handler is required.');
  const pageUrl = pageAddress(baseUrl);
  const trustedOrigin = pageUrl.origin;
  let mode = 'compact';
  let window = null;
  let tray = null;
  let quitting = false;
  let ipcInstalled = false;

  function display() { return activeDisplay(screen, window); }
  function boundsFor(next) { return cornerBounds(display(), next === 'expanded' ? EXPANDED_WINDOW_SIZE : COMPACT_WINDOW_SIZE, margin); }
  function trustedSender(event) {
    if (!window || window.isDestroyed() || event?.sender?.id !== window.webContents.id) return false;
    const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    try {
      const address = new URL(senderUrl);
      return address.origin === trustedOrigin && address.pathname === pageUrl.pathname && address.searchParams.get('shell') === 'desktop';
    } catch { return false; }
  }
  function requireTrustedSender(event) {
    if (!trustedSender(event)) throw Object.assign(new Error('Untrusted Corner desktop IPC sender.'), { code: 'corner_desktop_ipc_refused' });
  }
  function emitMode() {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) return;
    window.webContents.send(DESKTOP_IPC.modeChanged, mode);
  }
  function setMode(next, { show = true, animate = true } = {}) {
    mode = assertedMode(next);
    if (!window || window.isDestroyed()) return mode;
    window.setBounds(boundsFor(mode), animate);
    if (alwaysOnTop) window.setAlwaysOnTop(true, 'normal');
    emitMode();
    if (show) { window.show(); window.focus(); }
    return mode;
  }
  function expand() { return setMode('expanded'); }
  function compact(options) { return setMode('compact', options); }
  function installIpc() {
    if (ipcInstalled) return;
    ipcMain.handle(DESKTOP_IPC.getMode, event => { requireTrustedSender(event); return mode; });
    ipcMain.handle(DESKTOP_IPC.setMode, (event, next) => { requireTrustedSender(event); return setMode(assertedMode(next)); });
    ipcInstalled = true;
  }
  function secureWebContents() {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      let allowed = false;
      try { allowed = new URL(target).origin === trustedOrigin && new URL(target).pathname === pageUrl.pathname; } catch {}
      if (!allowed) event.preventDefault();
    });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
  }
  function createTray() {
    const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'));
    tray = new Tray(icon);
    tray.setToolTip('The Hub — Corner');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Expand', click: expand },
      { label: 'Collapse to corner', click: () => compact() },
      { type: 'separator' },
      { label: 'Quit', click: () => { void requestQuit(); } },
    ]));
    tray.on('click', () => {
      if (window?.isVisible() && mode === 'expanded') compact();
      else expand();
    });
  }
  async function create() {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({
      ...cornerBounds(activeDisplay(screen), COMPACT_WINDOW_SIZE, margin),
      frame: false,
      transparent: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      alwaysOnTop: Boolean(alwaysOnTop),
      backgroundColor: '#121a17',
      title: 'The Hub — Corner',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    secureWebContents();
    installIpc();
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      compact({ show: false, animate: false });
      window.hide();
    });
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) { window.setBounds(boundsFor(mode), false); window.show(); }
    });
    createTray();
    await window.loadURL(pageUrl.href);
    return window;
  }
  function setQuitting(value = true) { quitting = Boolean(value); }
  function destroy() {
    quitting = true;
    if (ipcInstalled) {
      ipcMain.removeHandler(DESKTOP_IPC.getMode);
      ipcMain.removeHandler(DESKTOP_IPC.setMode);
      ipcInstalled = false;
    }
    tray?.destroy(); tray = null;
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }
  return { create, expand, compact, setMode, getMode: () => mode, setQuitting, destroy, trustedOrigin: () => trustedOrigin, window: () => window, tray: () => tray };
}
