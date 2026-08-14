import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnvFile } from '../core/env.js';
import { createDesktopController } from './desktop-controller.js';
import { startDesktopHost } from './desktop-host.js';

const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const desktopLogPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.runtime', 'desktop-startup.log');
export const DESKTOP_QUIT_EXISTING_FLAG = '--quit-existing';

function desktopLog(stage, detail = {}) {
  try {
    mkdirSync(dirname(desktopLogPath), { recursive: true });
    appendFileSync(desktopLogPath, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, stage, ...detail })}\n`, 'utf8');
  } catch {}
}

function configuredAlwaysOnTop(env = process.env) {
  return !['0', 'false', 'off', 'no'].includes(String(env.HUB_CORNER_ALWAYS_ON_TOP || 'true').toLowerCase());
}

export function createDesktopExpansionQueue() {
  let controller = null;
  let pending = false;
  return {
    request() {
      if (controller) return controller.expand();
      pending = true;
      return null;
    },
    attach(nextController) {
      if (!nextController || typeof nextController.expand !== 'function') throw new TypeError('A desktop controller with expand() is required.');
      controller = nextController;
      if (pending) {
        pending = false;
        controller.expand();
      }
      return controller;
    },
    clear() { controller = null; },
    pending: () => pending,
  };
}

export function desktopLaunchIntent(commandLine) {
  return Array.isArray(commandLine) && commandLine.includes(DESKTOP_QUIT_EXISTING_FLAG) ? 'quit-existing' : 'start';
}

export function routeDesktopSecondInstance(commandLine, { requestQuit, requestExpand } = {}) {
  if (typeof requestQuit !== 'function' || typeof requestExpand !== 'function') throw new TypeError('Desktop second-instance routing requires quit and expand handlers.');
  const intent = desktopLaunchIntent(commandLine);
  if (intent === 'quit-existing') requestQuit();
  else requestExpand();
  return intent;
}

if (process.versions.electron) {
  desktopLog('process_started', { argv: process.argv.slice(1) });
  const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } = await import('electron');
  const hasInstanceLock = app.requestSingleInstanceLock();
  desktopLog('instance_lock_checked', { hasInstanceLock });
  const expansionQueue = createDesktopExpansionQueue();
  let desktop = null;
  let host = null;
  let shutdownPromise = null;
  let shutdownComplete = false;

  async function quit() {
    desktopLog('quit_requested');
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      let exitCode = 0;
      desktop?.setQuitting(true);
      try { await host?.close(); }
      catch (error) { exitCode = 1; console.error('The Hub desktop failed to close cleanly:', error); }
      try { desktop?.destroy(); }
      catch (error) { exitCode = 1; console.error('The Corner shell failed to close cleanly:', error); }
      expansionQueue.clear();
      shutdownComplete = true;
      desktopLog('shutdown_complete', { exitCode });
      app.exit(exitCode);
    })();
    return shutdownPromise;
  }

  async function start() {
    desktopLog('app_ready');
    loadEnvFile();
    host = await startDesktopHost();
    desktopLog('host_started', { url: host.url });
    desktop = createDesktopController({
      BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain,
      baseUrl: host.url,
      preloadPath,
      requestQuit: quit,
      alwaysOnTop: configuredAlwaysOnTop(),
    });
    expansionQueue.attach(desktop);
    await desktop.create();
    desktopLog('corner_created');
  }

  if (!hasInstanceLock || desktopLaunchIntent(process.argv) === 'quit-existing') {
    desktopLog('launch_declined', { hasInstanceLock, intent: desktopLaunchIntent(process.argv) });
    app.quit();
  }
  else {
    app.setName('The Hub — Corner');
    app.on('second-instance', (_event, commandLine) => {
      routeDesktopSecondInstance(commandLine, {
        requestQuit: () => { void quit(); },
        requestExpand: () => { expansionQueue.request(); },
      });
    });
    app.on('activate', () => { expansionQueue.request(); });
    app.on('before-quit', event => {
      if (shutdownComplete) return;
      event.preventDefault();
      void quit();
    });
    app.whenReady().then(start).catch(async error => {
      desktopLog('startup_failed', { name: error?.name || null, code: error?.code || null, message: error?.message || String(error) });
      console.error('The Hub desktop failed to start:', error);
      try { await host?.close(); } catch {}
      desktop?.destroy();
      expansionQueue.clear();
      app.exit(1);
    });
  }
}
