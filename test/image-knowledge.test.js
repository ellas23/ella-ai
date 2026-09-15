const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('image knowledge uploads, analyzes locally, answers questions, searches, and archives', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-image-knowledge-'));
  const vision = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'vision'] }));
      if (req.url === '/api/generate') return res.end(JSON.stringify({ response: 'The image shows a blue square on a white background.' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(resolve => vision.listen(0, '127.0.0.1', resolve));
  const visionPort = vision.address().port;
  const port = 36000 + (process.pid % 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELLA_PORT: String(port), ELLA_MEMORY_FILE: path.join(root, 'memory.json'), ELLA_ADMIN_PASSWORD: '', ELLA_OLLAMA_URL: `http://127.0.0.1:${visionPort}`, ELLA_VISION_MODEL: 'gemma3:4b' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('image test server did not start')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(2, 16); png.writeUInt32BE(3, 20);
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'diagram.png');
    const upload = await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, { method: 'POST', body: form });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.equal(uploaded.file.status, 'INDEXED');
    assert.deepEqual(uploaded.file.dimensions, { width: 2, height: 3 });
    assert.match(uploaded.file.analysis, /blue square/);
    const ask = await fetch(`http://127.0.0.1:${port}/api/knowledge/images/${uploaded.file.id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What is shown?' }) });
    assert.equal((await ask.json()).ok, true);
    const search = await fetch(`http://127.0.0.1:${port}/api/knowledge/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'blue square' }) });
    assert.equal((await search.json()).found, true);
    const bad = new FormData(); bad.append('file', new Blob(['not an image']), 'bad.png');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, { method: 'POST', body: bad })).status, 415);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/knowledge/files/${uploaded.file.id}`, { method: 'DELETE' })).status, 200);
  } finally {
    child.kill(); await new Promise(resolve => vision.close(resolve));
  }
});
