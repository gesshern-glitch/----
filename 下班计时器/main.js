const { app, BrowserWindow, ipcMain, Notification } = require('electron');
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
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.logger = console;

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater] error:', err.message);
    });
    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] update available:', info.version);
      new Notification({ title: '下班计时器', body: `发现新版本 v${info.version}，正在下载...` }).show();
    });
    autoUpdater.on('update-not-available', () => {
      console.log('[AutoUpdater] already up to date');
    });
    autoUpdater.on('download-progress', (p) => {
      console.log(`[AutoUpdater] download ${Math.round(p.percent)}%`);
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] update downloaded:', info.version);
      new Notification({ title: '下班计时器', body: `新版本 v${info.version} 已就绪，点击重启更新`, click: true })
        .on('click', () => autoUpdater.quitAndInstall())
        .show();
    });

    // 启动时检查一次
    autoUpdater.checkForUpdates().catch((e) => console.error('[AutoUpdater] check failed:', e.message));
    // 之后每 30 分钟检查一次
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 30 * 60 * 1000);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
