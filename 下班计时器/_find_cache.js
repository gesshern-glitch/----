const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, 'node_modules');
const results = [];
function walk(dir, depth) {
  if (depth > 8) return;
  let items;
  try { items = fs.readdirSync(dir); } catch { return; }
  for (const it of items) {
    if (it.endsWith('.bin') || it === '.bin' || it === '.cache' || it === '.vite') continue;
    const p = path.join(dir, it);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (it.endsWith('.js') && st.size < 300000) {
      let txt;
      try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (txt.includes('winCodeSign-2.6.0') || (txt.includes('getCacheDirectory') && txt.includes('unpack'))) {
        results.push(p);
      }
    }
  }
}
walk(base, 0);
console.log(results.join('\n'));
