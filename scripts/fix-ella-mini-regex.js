const fs = require('fs');
const path = 'ella-mini.mjs';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
if (lines.length <= 17) {
  console.error('File too short');
  process.exit(1);
}
lines[16] = "  const plain = String(text || '').replace(/[^" + "\\n" + "\\p{L}\\p{N}\\s.,!?;:'\"()-]/gu, '');";
lines.splice(17, 1);
fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('patched ellamini');
