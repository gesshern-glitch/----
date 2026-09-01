const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/* ===== 日志（写入用户文档，便于远程排查问题） ===== */
const logFile = path.join(app.getPath('userData'), 'app.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch (_) { /* ignore */ }
  console.log(msg);
}

/* 全局异常捕获：防止任何未捕获错误导致进程静默退出 */
process.on('uncaughtException', (err) => log(`[FATAL] uncaughtException: ${err.stack || err.message}`));
process.on('unhandledRejection', (err) => log(`[FATAL] unhandledRejection: ${err}`));

let mainWindow = null;

/* ===== GPU 加速检测：部分机器显卡驱动不支持硬件加速，会导致透明窗口黑屏 ===== */
let useHWAccel = true;
try {
  // 检查是否有已知的问题显卡
  const gpuInfo = app.getGPUFeatureStatus && app.getGPUFeatureStatus();
  log(`GPU status: ${JSON.stringify(gpuInfo || 'unknown')}`);
} catch (_) { /* ignore */ }

function createWindow() {
  log('createWindow() called');

  const win = new BrowserWindow({
    width: 330,
    height: 525,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,                       // 先隐藏，等渲染完成再显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  win.setMenuBarVisibility(false);

  win.on('ready-to-show', () => {
    log('window ready-to-show');
    win.show();
  });

  win.webContents.on('did-finish-load', () => {
    log('did-finish-load');
  });

  win.webContents.on('did-fail-load', (e, code, desc) => {
    log(`did-fail-load: code=${code} desc=${desc}`);
  });

  win.loadFile('index.html').catch((err) => {
    log(`loadFile failed: ${err.message}`);
  });
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
  log(`app ready, isPackaged=${app.isPackaged}, version=${app.getVersion()}`);
  app.setAppUserModelId('com.demo.offworktimer');

  // 先创建窗口，确保用户能看到界面
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 自动更新：延迟加载 electron-updater，避免模块加载失败拖垮整个应用
  if (app.isPackaged) {
    setTimeout(() => {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.logger = { info: log, warn: log, error: log };

        autoUpdater.on('error', (err) => log(`[AutoUpdater] error: ${err.message}`));
        autoUpdater.on('update-available', (info) => log(`[AutoUpdater] available: ${info.version}`));
        autoUpdater.on('update-not-available', () => log('[AutoUpdater] up to date'));
        autoUpdater.on('download-progress', (p) => log(`[AutoUpdater] ${Math.round(p.percent)}%`));
        autoUpdater.on('update-downloaded', (info) => {
          log(`[AutoUpdater] downloaded: ${info.version}`);
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '发现新版本',
            message: `新版本 v${info.version} 已下载完成！`,
            buttons: ['立即更新', '稍后再说'],
            defaultId: 0,
            cancelId: 1
          }).then((result) => {
            if (result.response === 0) autoUpdater.quitAndInstall();
          });
        });

        autoUpdater.checkForUpdates().catch((e) => log(`[AutoUpdater] check failed: ${e.message}`));
        setInterval(() => {
          autoUpdater.checkForUpdates().catch(() => {});
        }, 30 * 60 * 1000);
      } catch (err) {
        log(`[AutoUpdater] module load failed: ${err.message}`);
        // 加载失败不影响应用正常使用
      }
    }, 5000);
  }
}).catch((err) => {
  log(`app.whenReady failed: ${err.stack || err.message}`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
