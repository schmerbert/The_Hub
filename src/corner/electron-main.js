import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../core/env.js';
import { createDesktopController } from './desktop-controller.js';
import { startDesktopHost } from './desktop-host.js';

const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));
export const DESKTOP_QUIT_EXISTING_FLAG = '--quit-existing';

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
  const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } = await import('electron');
  const hasInstanceLock = app.requestSingleInstanceLock();
  const expansionQueue = createDesktopExpansionQueue();
  let desktop = null;
  let host = null;
  let shutdownPromise = null;
  let shutdownComplete = false;

  async function quit() {
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
      app.exit(exitCode);
    })();
    return shutdownPromise;
  }

  async function start() {
    loadEnvFile();
    host = await startDesktopHost();
    desktop = createDesktopController({
      BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain,
      baseUrl: host.url,
      preloadPath,
      requestQuit: quit,
      alwaysOnTop: configuredAlwaysOnTop(),
    });
    expansionQueue.attach(desktop);
    await desktop.create();
  }

  if (!hasInstanceLock || desktopLaunchIntent(process.argv) === 'quit-existing') app.quit();
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
      console.error('The Hub desktop failed to start:', error);
      try { await host?.close(); } catch {}
      desktop?.destroy();
      expansionQueue.clear();
      app.exit(1);
    });
  }
}
