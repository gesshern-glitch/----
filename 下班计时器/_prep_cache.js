// 手动预置 winCodeSign 缓存，绕开无权限创建符号链接导致的解压失败
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const cacheDir = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');
const sevenZip = path.join(__dirname, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const archive = path.join(cacheDir, 'winCodeSign-2.6.0.7z');
const targetDir = path.join(cacheDir, 'winCodeSign-2.6.0');
const url = 'https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';

fs.mkdirSync(cacheDir, { recursive: true });

// 清理之前失败残留的随机目录和压缩包
for (const it of fs.readdirSync(cacheDir)) {
  const p = path.join(cacheDir, it);
  if (it !== 'winCodeSign-2.6.0') fs.rmSync(p, { recursive: true, force: true });
}

function download(u, dest) {
  return new Promise((resolve, reject) => {
    https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('downloading winCodeSign-2.6.0.7z ...');
  await download(url, archive);
  console.log('downloaded', fs.statSync(archive).size, 'bytes');

  // 不加 -snld：符号链接条目会被解压为普通文本文件，不影响 Windows 工具
  const r = spawnSync(sevenZip, ['x', '-y', '-bd', archive, '-o' + targetDir], { encoding: 'utf8' });
  console.log('extract exit:', r.status);
  if (r.stdout) console.log(r.stdout.slice(-800));
  if (r.status !== 0 && r.stderr) console.log(r.stderr.slice(-800));

  const winDir = path.join(targetDir, 'windows-10');
  console.log('targetDir exists:', fs.existsSync(targetDir));
  if (fs.existsSync(targetDir)) {
    console.log('entries:', fs.readdirSync(targetDir).join(', '));
    if (fs.existsSync(winDir)) console.log('windows-10 entries:', fs.readdirSync(winDir).join(', '));
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
