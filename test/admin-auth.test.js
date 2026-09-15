const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('remote Ella admin API requires login and accepts the configured password', async () => {
  const port = 34000 + (process.pid % 1000);
  const password = `test-admin-password-${process.pid}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELLA_PORT: String(port), ELLA_ADMIN_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ella test server did not start')), 10000);
      child.stdout.on('data', chunk => {
        if (String(chunk).includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.once('error', reject);
    });
    const denied = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(denied.status, 401);
    const incorrect = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `${password}-wrong` })
    });
    assert.equal(incorrect.status, 401);
    const session = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    assert.equal(session.status, 200);
    const cookie = session.headers.get('set-cookie').split(';', 1)[0];
    const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Cookie: cookie } });
    assert.equal(allowed.status, 200);
    const logout = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    const revoked = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Cookie: cookie } });
    assert.equal(revoked.status, 401);
  } finally {
    child.kill();
  }
});
