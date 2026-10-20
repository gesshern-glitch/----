#!/usr/bin/env node
/**
 * 发布后自检：确认 GitHub Release 上的东西真的能让老版本软件自动更新
 *
 *   node scripts/verify-release.js          # 检查 package.json 里那个版本号
 *   node scripts/verify-release.js 1.3.0    # 指定版本号
 *
 * 检查项：
 *   1. tag 为 v<版本> 的 Release 是否存在
 *   2. 附件里是否同时有 安装包.exe、.blockmap、latest.yml
 *   3. latest.yml 里的 version 是否等于 package.json 的 version
 *   4. latest.yml 指向的安装包文件名，在 Release 附件里是否真的存在（名字对不上 = 用户点更新会 404）
 *   5. 附件实际大小与 latest.yml 记录的大小是否一致
 *   6. 顺带打印用户会在更新弹窗里看到的「更新日志」文案
 *
 * 公开仓库不用 token；私有仓库先设环境变量 GH_TOKEN。
 */
const fs = require('fs');
const path = require('path');
const { formatReleaseNotes } = require('../updateNotes');

const ROOT = path.resolve(__dirname, '..');

/** 纯逻辑部分：给 Release 的 JSON 和 latest.yml 文本，返回检查结论 */
function analyze(release, ymlText, expectVersion) {
  const problems = [];
  const notes = [];

  if (!release) {
    return { ok: false, problems: ['没找到这个版本的 Release（确认 tag 是 v' + expectVersion + '，并且已经 Publish 而不是 Draft）'], lines: [] };
  }

  const assets = (release.assets || []).map((a) => a.name);
  const yml = parseYamlish(ymlText);

  // 1. 三个必需附件
  if (!ymlText) problems.push('Release 里缺 latest.yml —— 没有它，老软件永远不会知道有新版本');
  if (!assets.some((n) => n.endsWith('.exe'))) problems.push('Release 里缺 .exe 安装包');
  if (!assets.some((n) => n.endsWith('.blockmap'))) notes.push('提示：.blockmap 建议一起上传（差量下载更省流量）');

  // 2. 版本一致
  if (yml.version && String(yml.version) !== String(expectVersion)) {
    problems.push(`latest.yml 里写的是 ${yml.version}，但 package.json 是 ${expectVersion}`);
  }
  if (!yml.version) problems.push('latest.yml 里没有 version 字段');

  // 3. 文件名对得上（历史上就踩过这个坑：中文包名 vs yml 里的英文名）
  const files = yml.files && yml.files.length ? yml.files : (yml.path ? [{ url: yml.path, size: yml.size }] : []);
  if (!files.length) problems.push('latest.yml 里没有 files/path，客户端找不到要下载哪个文件');
  const lines = [];
  files.forEach((f) => {
    const name = String(f.url || '').split('/').pop();
    const hit = assets.find((a) => a === name);
    if (!hit) {
      problems.push(`latest.yml 要下载「${name}」，但 Release 附件里没有这个名字（附件：${assets.join('、') || '无'}）`);
    } else {
      const asset = release.assets.find((a) => a.name === hit);
      if (f.size && asset.size && Number(f.size) !== Number(asset.size)) {
        problems.push(`「${name}」大小不符：yml 写 ${f.size}，实际 ${asset.size} 字节（重新打包后请三个文件一起重传）`);
      } else {
        lines.push(`✓ ${name}  ${Math.round(asset.size / 1048576)} MB`);
      }
    }
    if (!f.sha512 && !f.sha2) problems.push(`「${name}」没有 sha512/sha2 校验值，客户端会拒绝下载`);
  });

  // 4. 更新日志
  const notes2 = formatReleaseNotes(release.body);
  if (!notes2) notes.push('这个 Release 没填描述，用户弹窗里只会看到「这次作者没写更新日志」');

  return { ok: problems.length === 0, problems, lines, notes, changelog: notes2 };
}

// 只做必要字段提取，不引第三方 yaml 库
function parseYamlish(text) {
  const out = { version: null, path: null, sha512: null, size: null, files: [] };
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  let inFiles = false;
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (/^\S/.test(line)) inFiles = false;
    const m = /^(\s*)(-\s+)?([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[3];
    let val = m[4].trim().replace(/^['"]|['"]$/g, '');
    if (m[2] && inFiles) {            // 新的一条 file
      if (cur) out.files.push(cur);
      cur = {};
    }
    if (val === '') continue;
    if (inFiles) {
      cur[key] = key === 'size' ? Number(val) : val;
    } else {
      out[key] = key === 'size' ? Number(val) : val;
    }
  }
  if (cur) out.files.push(cur);
  return out;
}

/** 上传前的本地自检：核对 release/ 里刚打出来的安装包与 latest.yml 对不对得上 */
function checkLocal(expectVersion, dirOverride) {
  const crypto = require('crypto');
  const dir = dirOverride || path.join(ROOT, 'release');
  const problems = [];
  const lines = [];
  const ymlPath = path.join(dir, 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    console.log('❌ 没找到 release/latest.yml，先跑 npm run dist');
    process.exitCode = 1;
    return;
  }
  const yml = parseYamlish(fs.readFileSync(ymlPath, 'utf8'));
  if (String(yml.version) !== String(expectVersion)) {
    problems.push(`latest.yml 是 ${yml.version}，但期望 ${expectVersion}（package.json 改完版本号要重新打包）`);
  }
  const files = yml.files && yml.files.length ? yml.files : [];
  files.forEach((f) => {
    const name = String(f.url || '').split('/').pop();
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { problems.push(`release/ 里没有 ${name}`); return; }
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash('sha512').update(buf).digest('base64');
    if (buf.length !== Number(f.size)) problems.push(`${name} 大小不符：实际 ${buf.length}，yml 写 ${f.size}`);
    if (sha !== f.sha512) problems.push(`${name} 的 sha512 与 yml 不一致（yml 不是这次跟着这个包生成的）`);
    if (!fs.existsSync(p + '.blockmap')) problems.push(`缺 ${name}.blockmap（上传时三个文件要一起）`);
    lines.push(`✓ ${name}  ${(buf.length / 1048576).toFixed(1)} MB`);
  });
  console.log('本地安装包：\n' + lines.join('\n'));
  if (problems.length) {
    console.log('\n❌ 有问题：');
    problems.forEach((x) => console.log('  - ' + x));
    process.exitCode = 1;
  } else {
    console.log('\n✅ 本地产物一致，可以上传了（exe + blockmap + latest.yml 三个一起）。');
  }
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const arg = process.argv[2];
  if (arg === '--local') {
    console.log('检查本地 release/ 目录');
    return checkLocal(pkg.version);
  }
  const version = arg || pkg.version;
  const pub = (pkg.build && pkg.build.publish) || {};
  const conf = Array.isArray(pub) ? pub[0] : pub;
  if (!conf || conf.provider !== 'github' || !conf.owner || !conf.repo) {
    console.error('package.json 里 build.publish 没配好 github owner/repo');
    process.exitCode = 2;
    return;
  }
  const tag = (conf.vVersionPrefix == null ? 'v' : conf.vVersionPrefix) + version;
  const api = `https://api.github.com/repos/${conf.owner}/${conf.repo}/releases/tags/${tag}`;
  console.log(`检查 ${api}`);

  const headers = { 'User-Agent': 'off-work-timer-verify', Accept: 'application/vnd.github+json' };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;

  let release = null;
  try {
    const r = await fetch(api, { headers });
    if (r.status === 404) release = null;
    else {
      const j = await r.json();
      release = j && j.tag_name ? j : null;
    }
  } catch (e) {
    console.error(`连不上 GitHub：${e.message}（需要在能上网的机器上跑）`);
    process.exitCode = 2;
    return;
  }

  let ymlText = '';
  const ymlAsset = release && (release.assets || []).find((a) => a.name === 'latest.yml');
  if (ymlAsset) {
    // 先走普通下载链接；不行再走 API 字节接口（有些网络环境只能访问 api.github.com）
    const tries = [
      { url: ymlAsset.browser_download_url, headers },
      { url: ymlAsset.url, headers: Object.assign({}, headers, { Accept: 'application/octet-stream' }) }
    ];
    for (const t of tries) {
      try {
        const r = await fetch(t.url, { headers: t.headers });
        if (r.ok) { ymlText = await r.text(); break; }
      } catch (e) { /* 试下一个 */ }
    }
    if (!ymlText) console.error('latest.yml 两个地址都拉不到（浏览器打开 ' + ymlAsset.browser_download_url + ' 看看）');
  }

  const res = analyze(release, ymlText, version);
  console.log('');
  if (res.lines.length) console.log('附件：\n' + res.lines.join('\n'));
  if (res.changelog) {
    console.log('\n用户在更新弹窗里会看到：');
    console.log('  更新日志：');
    res.changelog.split('\n').forEach((l) => console.log('  ' + l));
  }
  (res.notes || []).forEach((n) => console.log('\n· ' + n));
  if (!res.ok) {
    console.log('\n❌ 有问题：');
    res.problems.forEach((p) => console.log('  - ' + p));
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ 一切正常，装了旧版本的用户下次检查就能收到更新。');
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { analyze, parseYamlish, checkLocal };
