const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const VAULT_FILE = process.env.ELLA_VAULT_FILE || path.join(os.homedir(), '.ella', 'vault.dpapi.json');
function protect(value) {
  if (process.platform !== 'win32') throw new Error('Windows protected credential storage is required.');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$input | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.on('error', () => reject(new Error('Protected vault is unavailable.'))); child.on('close', code => code === 0 && output.trim() ? resolve(output.trim()) : reject(new Error('Protected vault write failed.'))); child.stdin.end(value);
  });
}
function load() { try { return fs.existsSync(VAULT_FILE) ? JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) : {}; } catch (_error) { throw new Error('Protected vault is unavailable.'); } }
function save(data) { fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true }); const temp = `${VAULT_FILE}.tmp-${process.pid}`; fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temp, VAULT_FILE); }
async function setCredential(id, value, label = id) { if (!id || !value) throw new Error('Credential id and value are required.'); const data = load(); data[id] = { label: String(label).slice(0, 100), protectedValue: await protect(String(value)), updatedAt: new Date().toISOString() }; save(data); }
function removeCredential(id) { const data = load(); delete data[id]; save(data); }
function listMetadata() { return Object.entries(load()).map(([id, item]) => ({ id, label: item.label, updatedAt: item.updatedAt })); }
module.exports = { VAULT_FILE, setCredential, removeCredential, listMetadata };
