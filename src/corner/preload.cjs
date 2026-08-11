const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({ getMode: 'corner:get-mode', setMode: 'corner:set-mode', modeChanged: 'corner:mode-changed' });
const MODES = new Set(['compact', 'expanded']);

contextBridge.exposeInMainWorld('cornerDesktop', Object.freeze({
  getMode: () => ipcRenderer.invoke(CHANNELS.getMode),
  setMode: mode => {
    if (!MODES.has(mode)) return Promise.reject(new TypeError('Corner desktop mode must be compact or expanded.'));
    return ipcRenderer.invoke(CHANNELS.setMode, mode);
  },
  onMode: callback => {
    if (typeof callback !== 'function') throw new TypeError('Corner desktop mode listener must be a function.');
    const handler = (_event, mode) => { if (MODES.has(mode)) callback(mode); };
    ipcRenderer.on(CHANNELS.modeChanged, handler);
    return () => ipcRenderer.removeListener(CHANNELS.modeChanged, handler);
  },
}));
