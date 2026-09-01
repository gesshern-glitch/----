const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

function createWindow() {
  const win = new BrowserWindow({
    width: 330,
    height: 525,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 注意：不使用 setBackgroundMaterial('acrylic')，
  // 因为 Acrylic 会铺满整个窗口矩形，导致圆角卡片外多出一个矩形框。
  // 改用透明窗口 + 圆角毛玻璃卡片，卡片外区域完全透明。

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.demo.offworktimer');

  // 自动更新：仅安装后的打包版启用（开发态跳过）。
  // 检查到新版后后台静默下载，下载完成弹系统通知，用户重启即安装。
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      /* 无网络或无新版时静默忽略 */
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
