const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cozy', {
  status: () => ipcRenderer.invoke('cozy:status'),
  action: (name, value) => ipcRenderer.invoke('cozy:action', name, value),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('cozy:status-changed', listener);
    return () => ipcRenderer.removeListener('cozy:status-changed', listener);
  },
});
