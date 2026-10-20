const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
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
let tray = null;
let isQuitting = false;          // 仅托盘菜单「退出」置位，否则 ✕ / 最小化都收起托盘
let hintShown = false;           // 首次收起时弹一次托盘提示
let autoUpdaterRef = null;       // electron-updater 实例（仅打包后存在）
let updaterReady = false;
let manualCheck = false;         //  true = 用户从托盘主动点「检查更新」，需要给出回应弹窗

/* ===== 托盘：点 ✕ / 最小化都不退出程序，收进右下角托盘，双击可重新打开 ===== */
function getTrayIcon() {
  // 打包后从 resources 目录读图标（extraResources 复制），开发态直接读 build 目录
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
  const img = nativeImage.createFromPath(iconPath);
  if (!img.isEmpty()) {
    return nativeImage.createThumbnailFromPath
      ? img.resize({ width: 16, height: 16 })
      : img;
  }
  // 图标文件缺失/加载失败时的兜底：代码画一个 16x16 蓝色圆点，避免崩溃
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const inside = dx * dx + dy * dy <= 49;
      const i = (y * size + x) * 4;
      buf[i] = 246; buf[i + 1] = 124; buf[i + 2] = 47;   // BGRA：#2f7cf6
      buf[i + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!hintShown && tray) {
    hintShown = true;
    tray.displayBalloon({
      title: '下班计时器已在后台运行',
      content: '计时照常进行。双击托盘图标可重新打开窗口；右键托盘图标可退出。'
    });
  }
}

/* ===== 弹窗小助手：窗口收起时也能正常弹（不传父窗口） ===== */
function showBox(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/* ===== 检查更新：只有打包后的 exe 才会真的去拉版本清单 ===== */
function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) {
      showBox({
        type: 'info',
        title: '检查更新',
        message: '现在是开发模式（npm start），不会检查更新。',
        detail: '自动更新只在安装后的 exe 里工作。',
        buttons: ['知道了'],
        noLink: true
      });
    }
    return;
  }
  if (!updaterReady || !autoUpdaterRef) {
    if (manual) {
      showBox({
        type: 'info',
        title: '检查更新',
        message: '更新模块还没准备好，请过几秒再试。',
        buttons: ['知道了'],
        noLink: true
      });
    }
    return;
  }
  manualCheck = !!manual;
  autoUpdaterRef.checkForUpdates().catch((e) => log(`[AutoUpdater] check failed: ${e.message}`));
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(getTrayIcon());
    tray.setToolTip('下班计时器');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: showWindow },
      { label: '检查更新', click: () => checkForUpdates(true) },
      { type: 'separator' },
      {
        label: '退出',
        click: () => { isQuitting = true; app.quit(); }
      }
    ]));
    tray.on('double-click', showWindow);
  } catch (err) {
    log(`[Tray] create failed: ${err.message}`);
    tray = null;
  }
}

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

  // 点 ✕ / 最小化都收进托盘，不退出程序（托盘「退出」置 isQuitting 后放行）
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideToTray();
    }
  });
  win.on('minimize', () => {
    if (!isQuitting) hideToTray();
  });

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

/* ===== 数据文件：文档/下班计时器/出勤记录.json（同时自动生成同名 CSV 便于 Excel 查看） ===== */
const dataDir = () => path.join(app.getPath('documents'), '下班计时器');
const dataFile = () => path.join(dataDir(), '出勤记录.json');
const csvFile = () => path.join(dataDir(), '出勤记录.csv');

function writeDataFiles(json, csv) {
  if (typeof json !== 'string' || json.length === 0 || json.length > 8 * 1024 * 1024) {
    log('[Data] save rejected: bad json payload');
    return false;
  }
  try {
    JSON.parse(json);
  } catch (err) {
    log(`[Data] save rejected: invalid json (${err.message})`);
    return false;
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), json, 'utf8');
  if (typeof csv === 'string') {
    // 加 BOM，避免 Excel 打开中文列头乱码
    fs.writeFileSync(csvFile(), '\ufeff' + csv, 'utf8');
  }
  log(`[Data] saved to ${dataFile()}`);
  return true;
}

ipcMain.handle('data-load', () => {
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    log(`[Data] loaded ${dataFile()}`);
    return JSON.parse(raw);
  } catch (err) {
    // 文件不存在或损坏：返回 null，由渲染进程初始化空数据（必要时迁移旧记录）
    log(`[Data] load failed (${err.code || err.message}), start empty`);
    return null;
  }
});

ipcMain.handle('data-path', () => dataFile());

ipcMain.on('data-save', (event, payload) => {
  const { json, csv } = payload || {};
  writeDataFiles(json, csv);
});

// 窗口关闭前同步落盘，避免防抖中的最后一笔记录丢失
ipcMain.on('data-save-sync', (event, payload) => {
  const { json, csv } = payload || {};
  event.returnValue = writeDataFiles(json, csv);
});

ipcMain.on('data-open-folder', () => {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    if (fs.existsSync(dataFile())) shell.showItemInFolder(dataFile());
    else shell.openPath(dataDir());
  } catch (err) {
    log(`[Data] open folder failed: ${err.message}`);
  }
});

app.whenReady().then(() => {
  log(`app ready, isPackaged=${app.isPackaged}, version=${app.getVersion()}`);
  app.setAppUserModelId('com.demo.offworktimer');

  // 先创建窗口，确保用户能看到界面
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });

  app.on('before-quit', () => { isQuitting = true; });

  // 自动更新：延迟加载 electron-updater，避免模块加载失败拖垮整个应用
  if (app.isPackaged) {
    setTimeout(() => {
      try {
        const { autoUpdater } = require('electron-updater');
        const { formatReleaseNotes } = require('./updateNotes');
        autoUpdaterRef = autoUpdater;
        autoUpdater.autoDownload = false;   // 先问过用户，不要背地里吃掉几十兆流量
        autoUpdater.logger = { info: log, warn: log, error: log };

        autoUpdater.on('error', (err) => {
          log(`[AutoUpdater] error: ${err.message}`);
          if (manualCheck) {
            manualCheck = false;
            showBox({
              type: 'warning',
              title: '检查更新失败',
              message: '暂时连不上更新服务器，请稍后再试。',
              detail: err.message,
              buttons: ['知道了'],
              noLink: true
            });
          }
        });

        // 发现新版本：把 GitHub Release 里填的更新日志一起展示，用户确认后才下载
        autoUpdater.on('update-available', (info) => {
          log(`[AutoUpdater] available: ${info.version}`);
          manualCheck = false;
          const notes = formatReleaseNotes(info.releaseNotes);
          showBox({
            type: 'info',
            title: '发现新版本',
            message: `下班计时器 v${info.version} 已发布（当前 v${app.getVersion()}）`,
            detail: notes ? `更新日志：\n${notes}\n\n要现在下载吗？下载完成后重启生效。` : '这次作者没写更新日志。\n\n要现在下载吗？',
            buttons: ['现在下载', '以后再说'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          }).then((result) => {
            if (result.response === 0) {
              autoUpdater.downloadUpdate().catch((e) => log(`[AutoUpdater] download failed: ${e.message}`));
            }
          });
        });

        autoUpdater.on('update-not-available', () => {
          log('[AutoUpdater] up to date');
          if (manualCheck) {
            manualCheck = false;
            showBox({
              type: 'info',
              title: '检查更新',
              message: `已经是最新版本 v${app.getVersion()}`,
              buttons: ['好'],
              noLink: true
            });
          }
        });

        autoUpdater.on('download-progress', (p) => log(`[AutoUpdater] ${Math.round(p.percent)}%`));

        autoUpdater.on('update-downloaded', (info) => {
          log(`[AutoUpdater] downloaded: ${info.version}`);
          showBox({
            type: 'info',
            title: '更新已就绪',
            message: `新版本 v${info.version} 已下载完成，重启后生效。`,
            detail: '当前计时数据存在本地文件里，重装不会丢。',
            buttons: ['立即更新', '稍后再说'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          }).then((result) => {
            if (result.response === 0) autoUpdater.quitAndInstall();
          });
        });

        updaterReady = true;
        checkForUpdates(false);
        setInterval(() => checkForUpdates(false), 30 * 60 * 1000);
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
  // 窗口真正关闭（托盘退出流程）后销毁托盘并结束进程
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
});
