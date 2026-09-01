const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winControl', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close')
});
