const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winControl', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close')
});

/* 出勤数据读写：文件存放在 文档/下班计时器/ 下，用户可随时打开查看 */
contextBridge.exposeInMainWorld('store', {
  load: () => ipcRenderer.invoke('data-load'),
  save: (json, csv) => ipcRenderer.send('data-save', { json, csv }),
  saveSync: (json, csv) => ipcRenderer.sendSync('data-save-sync', { json, csv }),
  dataPath: () => ipcRenderer.invoke('data-path'),
  openFolder: () => ipcRenderer.send('data-open-folder')
});
