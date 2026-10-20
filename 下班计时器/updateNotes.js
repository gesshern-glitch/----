// 更新日志文本整理：把 GitHub Release 正文（Markdown）变成弹窗里干净的几行字
// 单独成文件便于用 node 直接跑断言验证，不依赖 Electron

// releaseNotes 在 GitHub 来源下有两种形态：
//   1) 字符串：只有最新版本一条
//   2) 数组：[{ version, note }, ...]（跨多个版本时逐条拼接）
function flatten(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : (n && (n.note || n.text)) || ''))
      .join('\n');
  }
  return String(notes);
}

// 去掉 Markdown 痕迹：# 标题、**加粗**、`代码`、[文字](链接)、<br>、---
function stripMarkdown(line) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .trim();
}

function formatReleaseNotes(notes, opts) {
  const maxLines = (opts && opts.maxLines) || 12;
  const maxLen = (opts && opts.maxLen) || 120;

  const lines = flatten(notes)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(stripMarkdown)
    .filter((l) => l && !/^(-{3,}|\*{3,}|_{3,})$/.test(l)) // 跳过 --- 分隔线
    .filter((l) => !/^https?:\/\//i.test(l))               // 跳过裸链接
    .map((l) => l.replace(/^[-*+]\s+/, '· '))              // 列表符号统一成 ·
    .map((l) => (l.length > maxLen ? l.slice(0, maxLen) + '…' : l))
    .slice(0, maxLines);

  // “更新日志：”这类开头的小标题剔掉（弹窗自己已经有标题了，避免重复）
  if (lines.length > 1 && /^(更新日志|变更日志|changelog|release\s*notes|what'?s\s*new)[:：]?$/i.test(lines[0])) {
    lines.shift();
  }

  return lines.join('\n');
}

module.exports = { formatReleaseNotes, stripMarkdown };
