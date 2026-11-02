const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusIslands', {
  status: () => ipcRenderer.invoke('focus-islands:status'),
  action: (name, value) => ipcRenderer.invoke('focus-islands:action', name, value),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('focus-islands:status-changed', listener);
    return () => ipcRenderer.removeListener('focus-islands:status-changed', listener);
  },
});
