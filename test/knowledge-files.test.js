const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('uploaded knowledge is extracted, searchable, and removed from retrieval when archived', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ella-knowledge-'));
  const port = 35000 + (process.pid % 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELLA_PORT: String(port), ELLA_MEMORY_FILE: path.join(root, 'memory.json'), ELLA_ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('knowledge test server did not start')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    const form = new FormData();
    form.append('file', new Blob(['Ella uses local Ollama for private answers.']), 'notes.txt');
    const upload = await fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, { method: 'POST', body: form });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.equal(uploaded.file.status, 'INDEXED');
    assert.equal(uploaded.file.chunkCount, 1);
    const search = await fetch(`http://127.0.0.1:${port}/api/knowledge/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'private Ollama answers' }) });
    const searchBody = await search.json();
    assert.equal(search.status, 200);
    assert.equal(searchBody.found, true);
    assert.equal(searchBody.matches[0].filename, 'notes.txt');
    const archived = await fetch(`http://127.0.0.1:${port}/api/knowledge/files/${uploaded.file.id}`, { method: 'DELETE' });
    assert.equal(archived.status, 200);
    const after = await fetch(`http://127.0.0.1:${port}/api/knowledge/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'private Ollama answers' }) });
    assert.equal((await after.json()).found, false);
  } finally {
    child.kill();
  }
});
