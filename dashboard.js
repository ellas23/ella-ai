const api = (path, options = {}) => fetch(path, { cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }).then(async response => {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.replace('/admin-login.html');
    throw new Error('Ella dashboard authentication required.');
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
});
const $ = id => document.getElementById(id);
let config = null, logs = [], memories = [], querySourceData = null, tldrSourceData = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
async function startEllaServices() {
  const button = $('startEllaServices');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'STARTING';
  try {
    const result = await api('/api/ella/start', { method: 'POST', body: '{}' });
    button.textContent = result.message || 'STARTING';
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const lifecycle = await api('/api/ella/status');
        if (lifecycle.apiVersion === 'ella-lifecycle-v2' && ['READY', 'DEGRADED'].includes(String(lifecycle.data?.state || '').toUpperCase()) && lifecycle.data.freshness === 'fresh') {
          button.textContent = 'READY';
          await load();
          return;
        }
      } catch (_) { /* the backend is still starting */ }
    }
    throw new Error('Backend did not become ready within 90 seconds.');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'FAILED';
    button.title = error.message;
    markOffline(error.message);
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = 'Start Ella services'; }, 5000);
  }
}
function markOffline(reason = 'Backend is unavailable.') {
  const message = String(reason);
  if ($('systemStatusLine')) $('systemStatusLine').textContent = `OFFLINE | ${message}`;
  if ($('healthSummary')) $('healthSummary').textContent = `OFFLINE · ${message}`;
  if ($('healthChecks')) $('healthChecks').innerHTML = '<span class="unavailable">Backend health is unavailable; no live service state is shown.</span>';
  if ($('statusCards')) $('statusCards').innerHTML = ['Ella', 'Node', 'Ollama', 'Whisper', 'Pi worker'].map(name => `<div class="card"><small>${name}</small><b>OFFLINE</b></div>`).join('');
  if ($('heroState')) $('heroState').textContent = 'OFFLINE';
  if ($('state')) $('state').textContent = 'OFFLINE';
}
function applyPreferences() {
  const theme = localStorage.getItem('ella-theme') || 'dark';
  document.documentElement.classList.toggle('light', theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches));
  document.body.classList.toggle('light', document.documentElement.classList.contains('light'));
  if ($('themeMode')) $('themeMode').value = theme;
  const workspace = localStorage.getItem('ella-workspace') || 'Operator'; if ($('workspaceMode')) $('workspaceMode').value = workspace; document.querySelectorAll('.workspace-button').forEach(item => item.classList.toggle('active', item.dataset.workspace === workspace)); document.body.dataset.workspace = workspace.toLowerCase();
}
document.addEventListener('DOMContentLoaded', () => $('startEllaServices')?.addEventListener('click', startEllaServices));
document.addEventListener('DOMContentLoaded', () => $('logout')?.addEventListener('click', async () => {
  const button = $('logout');
  button.disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    location.href = '/admin-login.html';
  }
}));

function setValue(id, value) { if ($(id)) $(id).value = value ?? ''; }
function setChecked(id, value) { if ($(id)) $(id).checked = !!value; }
function applyConfig(data) {
  config = data; const v = data.voice || {}, b = data.brain || {}, p = data.personality || {};
  setValue('voiceModel', v.model); setValue('voiceLanguage', v.language); setValue('beamSize', v.beamSize); setValue('wakeWord', v.wakeWord);
  setValue('microphoneDevice', v.microphone?.device); setValue('clapSpikeRatio', v.doubleClap?.spikeRatio ?? 7); setValue('clapMinLevel', v.doubleClap?.minLevel ?? 400); setValue('clapCooldown', v.doubleClap?.cooldownSeconds ?? 0.8);
  setChecked('doubleClapEnabled', v.doubleClap?.enabled);
  setChecked('vad', v.vad); setChecked('wakeEnabled', v.wakeWordEnabled); setValue('brainModel', b.model); setValue('temperature', b.temperature);
  setValue('contextLength', b.contextLength); setValue('maxTokens', b.maxTokens); setChecked('aiEnabled', b.enabled);
  setValue('personalityName', p.name); setValue('tone', p.tone); setValue('speakingStyle', p.speakingStyle); setValue('personalityText', p.personality);
  setValue('systemInstructions', p.systemInstructions); setValue('rules', p.rules); setValue('customBehavior', p.customBehavior); setChecked('automaticMemory', data.automaticMemory);
}
function openDetail(metric) {
  const pages = { cpu: ['analytics', 'cpuPercent'], ram: ['analytics', 'ramPercent'], ollama: ['brain'], whisper: ['voice'], worker: ['system'], coding: ['system'], storage: ['analytics', 'diskFreePercent'], email: ['email'] };
  const target = pages[metric]; if (!target) return;
  const nav = document.querySelector(`.nav[data-page="${target[0]}"]`); if (nav) nav.click();
  if (target[1] && $('chartMetric')) { $('chartMetric').value = target[1]; loadAnalytics().catch(() => {}); }
}
function bindStatusCards() { document.querySelectorAll('[data-detail]').forEach(card => { card.onclick = () => openDetail(card.dataset.detail); card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') openDetail(card.dataset.detail); }; }); }
function renderOverview(data) {
  const coding = data.coding || {}, system = data.system || {}, memory = system.memory || {}, disk = system.disk || {};
  const lifecycle = data.lifecycle || data.status || { state: 'UNKNOWN', freshness: 'unknown', reason: 'No lifecycle status was returned.' };
  const lifecycleState = String(lifecycle.state || 'UNKNOWN').toUpperCase();
  const cards = [
    ['Ella', lifecycleState, 'ella'], ['Node', data.node?.state || (data.node?.online ? 'READY' : 'OFFLINE'), 'node'],
    ['Ollama', data.ollama?.status || 'UNAVAILABLE', 'ollama'], ['Whisper', data.whisper?.status || 'UNAVAILABLE', 'whisper'],
    ['Pi worker', data.worker?.status || 'UNAVAILABLE', 'worker'], ['Local coding', coding.LOCAL_CODING_WORKER_AVAILABLE ? 'AVAILABLE' : 'UNAVAILABLE', 'coding'],
    ['VS Code Agent', coding.VS_CODE_DETECTED ? (coding.AUTONOMOUS_EXECUTION_AVAILABLE ? 'AUTONOMOUS' : 'DETECTED / UNAVAILABLE') : 'UNAVAILABLE', 'coding'],
    ['CPU', system.cpuPercent == null ? 'UNAVAILABLE' : `${system.cpuPercent}%`, 'cpu'], ['RAM', memory.usedPercent == null ? 'UNAVAILABLE' : `${memory.usedPercent}%`, 'ram'],
    ['GPU', system.gpu?.status || 'UNAVAILABLE', 'gpu'], ['Temperature', system.temperature?.status || 'UNAVAILABLE', 'temperature'],
    ['Storage', disk.freePercent == null ? 'UNAVAILABLE' : `${disk.freePercent}% FREE`, 'storage'], ['Email', 'OPEN EMAIL', 'email']
  ];
  $('statusCards').innerHTML = cards.map(([name, value, detail]) => `<div class="card" data-detail="${detail}"><small>${esc(name)}</small><b>${esc(value)}</b></div>`).join(''); bindStatusCards();
  const clock = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  $('systemStatusLine').textContent = `${clock} | Lifecycle ${lifecycleState} | ${lifecycle.reason || 'No reason provided'} | Checked ${lifecycle.lastChecked || 'never'} | Freshness ${lifecycle.freshness || 'unknown'} | CPU ${system.cpuPercent == null ? 'UNAVAILABLE' : `${system.cpuPercent}%`} | RAM ${memory.usedPercent == null ? 'UNAVAILABLE' : `${memory.usedPercent}%`} | Disk free ${disk.freePercent == null ? 'UNAVAILABLE' : `${disk.freePercent}%`} | Ollama ${String(data.ollama?.status || 'offline').toUpperCase()} | Whisper ${String(data.whisper?.status || 'stopped').toUpperCase()} | Model: ${data.ollama?.activeModel || data.ollama?.configuredModel || 'UNAVAILABLE'} | Ella: ${data.publicUrls?.ella || 'OFFLINE'} | Bob: ${data.publicUrls?.bob || 'OFFLINE'}`;
  if ($('codingCapabilities')) $('codingCapabilities').textContent = `VS Code: ${coding.VS_CODE_DETECTED ? 'DETECTED' : 'NOT DETECTED'} | Agent CLI: ${coding.AGENT_CLI_AVAILABLE ? 'AVAILABLE' : 'UNAVAILABLE'} | Autonomous execution: ${coding.AUTONOMOUS_EXECUTION_AVAILABLE ? 'AVAILABLE' : 'UNAVAILABLE'}`;
  const state = String(data.ella?.state || lifecycleState).toLowerCase(); const displayState = state === 'processing' ? 'THINKING' : state.toUpperCase(); $('state').textContent = displayState; if ($('heroState')) $('heroState').textContent = displayState; $('ellaOrb').className = `orb ${state}`;
  $('transcript').textContent = data.ella?.transcript?.user || 'Waiting for transcript?'; $('response').textContent = data.ella?.transcript?.ella || 'Waiting for Ella?';
  const cpu = Number(system.cpuPercent || 0), ram = Number(memory.usedPercent || 0); $('cpuMeter').style.transform = `rotate(${cpu * 3.6 - 35}deg)`; $('ramMeter').style.transform = `rotate(${ram * 3.6 - 35}deg)`;
  $('aiMeter').style.borderTopColor = data.ollama?.status === 'online' ? 'var(--green)' : 'var(--red)'; $('whisperMeter').style.borderTopColor = data.whisper?.status === 'running' ? 'var(--green)' : 'var(--red)';
  if ($('voiceStatus')) $('voiceStatus').textContent = `Status: ${data.whisper?.status || 'UNAVAILABLE'} | Model: ${data.whisper?.model || '?'} | Microphone: ${data.microphone?.selectedDevice?.name || 'default unavailable'} | Source: single desktop recognizer`;
  if ($('microphoneDevices')) $('microphoneDevices').textContent = `Selected: ${data.microphone?.selectedDevice?.name || 'none'} | Available: ${(data.microphone?.availableDevices || []).map(item => `${item.index}: ${item.name}`).join(' | ') || 'none'}${data.microphone?.error ? ` | Error: ${data.microphone.error}` : ''}`;
  if ($('ttsStatus')) {
    const tts = data.tts || {};
    const error = tts.TTS_LAST_ERROR ? ` | Error: ${tts.TTS_LAST_ERROR}` : '';
    $('ttsStatus').textContent = `TTS: ${tts.TTS_STATUS || 'UNAVAILABLE'} | Engine: ${tts.TTS_ENGINE || 'UNAVAILABLE'} | Output: ${tts.TTS_OUTPUT_DEVICE || 'UNAVAILABLE'}${error}`;
  }
  if ($('brainStatus')) $('brainStatus').textContent = `Ollama: ${data.ollama?.status || 'UNAVAILABLE'} | Active model: ${data.ollama?.activeModel || data.ollama?.configuredModel || '?'} | Source: Ollama model inventory`;
}
async function loadOllamaModels() {
  try {
    const result = await api('/api/ollama/models');
    const select = $('brainModel');
    const current = select.value || config?.brain?.model || '';
    select.innerHTML = result.models.map(model => `<option value="${esc(model)}">${esc(model)}</option>`).join('');
    if (result.models.includes(current)) select.value = current;
  } catch (error) {
    if ($('brainStatus')) $('brainStatus').textContent = `Ollama model list unavailable: ${error.message}`;
  }
}
function addEvent(event) { logs.unshift(event); logs = logs.slice(0, 500); $('activity').innerHTML = logs.slice(0, 60).map(e => `<div class="event"><b>${esc(e.kind || 'event')}</b>${esc(e.time || '')}<br>${esc(e.message || '')}</div>`).join(''); const research = logs.filter(item => /research/i.test(`${item.kind || ''} ${item.message || ''}`)).slice(0, 5); if ($('researchActivity')) $('researchActivity').innerHTML = research.length ? research.map(item => `<div class="event"><b>${esc(item.kind || 'RESEARCH')}</b><br>${esc(item.message || '')}</div>`).join('') : '<span class="unavailable">No research activity.</span>'; renderLogs(); }
function renderLogs() { const q = ($('logSearch')?.value || '').toLowerCase(); $('logsList').textContent = logs.filter(e => !q || `${e.kind} ${e.message}`.toLowerCase().includes(q)).map(e => `[${e.time || ''}] ${String(e.kind || 'event').toUpperCase()}: ${e.message || ''}`).join('\n'); }
async function loadMemory() { const params = new URLSearchParams({ search: $('memorySearch').value, category: $('memoryCategory')?.value || '', importance: $('memoryImportance')?.value || '' }); const result = await api(`/api/admin/memory?${params}`); memories = result.items; const stats = result.stats || {}; if ($('memoryStats')) $('memoryStats').innerHTML = [['Total', stats.total], ...Object.entries(stats.byCategory || {})].map(([name, value]) => `<div class="card"><small>${esc(name)}</small><b>${esc(value ?? 0)}</b></div>`).join(''); $('memoryList').innerHTML = memories.map(item => `<div class="memory"><span>${esc(item.content || item.text)}<br><small>${esc(item.category)} · ${esc(item.importance)} · ${esc(item.confidence)} · used ${esc(item.useCount)} · updated ${esc(item.updatedAt)}</small></span><button data-edit-memory="${esc(item.id)}">Edit</button><button data-memory="${esc(item.id)}" class="danger">Delete</button></div>`).join('') || '<p class="muted">No matching memories.</p>'; document.querySelectorAll('[data-memory]').forEach(b => b.onclick = async () => { await api(`/api/admin/memory/${encodeURIComponent(b.dataset.memory)}`, { method: 'DELETE' }); loadMemory(); }); document.querySelectorAll('[data-edit-memory]').forEach(b => b.onclick = async () => { const item = memories.find(candidate => candidate.id === b.dataset.editMemory); const text = prompt('Edit memory', item?.content || item?.text || ''); if (text?.trim()) { await api(`/api/admin/memory/${encodeURIComponent(b.dataset.editMemory)}`, { method: 'PUT', body: JSON.stringify({ text: text.trim() }) }); loadMemory(); } }); }
async function loadLogs() { const result = await api('/api/admin/logs'); logs = result.items; renderLogs(); }
async function loadMinecraft() { const result = await api('/api/admin/minecraft/status'); $('minecraftStatus').innerHTML = Object.entries(result.data).map(([k, v]) => `<div class="card"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join(''); }
async function loadPcControl() {
  try {
    const [status, processes, services, network, audit, prep] = await Promise.all([api('/api/pc/status'), api('/api/pc/processes'), api('/api/pc/services'), api('/api/pc/network'), api('/api/pc/audit'), api('/api/pc/gaming/fortnite')]);
    renderFortnitePrep(prep.data);
    const s = status.data || {}; const m = s.memory || {};
    $('pcMetrics').innerHTML = [['CPU', `${esc(s.cpuCount || 0)} cores`], ['RAM', `${esc(m.usedPercent ?? 'UNAVAILABLE')}% used`], ['Disk', `${esc(s.disk?.freePercent ?? 'UNAVAILABLE')}% free`], ['Uptime', `${Math.round(Number(s.uptimeSeconds || 0) / 3600)}h`], ['GPU', (s.gpu || []).map(item => item.Name).join(', ') || 'UNAVAILABLE'], ['Network', `${(network.items || []).filter(item => item.Status === 'Up').length} online`]].map(([name, value]) => `<div class="card"><small>${name}</small><b>${value}</b></div>`).join('');
    $('pcProcesses').innerHTML = (processes.items || []).slice(0, 40).map(item => `<div class="event"><b>${esc(item.ProcessName)}</b> <small>${esc(item.Id)}</small></div>`).join('') || '<p class="muted">No process data.</p>';
    $('pcServices').innerHTML = (services.items || []).slice(0, 40).map(item => `<div class="event"><b>${esc(item.DisplayName || item.Name)}</b> <small>${esc(item.Status)}</small></div>`).join('') || '<p class="muted">No service data.</p>';
    $('pcNetwork').innerHTML = (network.items || []).map(item => `<div class="event"><b>${esc(item.Name)}</b> ${esc(item.Status)} · ${esc(item.LinkSpeed || '—')}</div>`).join('') || '<p class="muted">No network data.</p>';
    const pending = (audit.pendingConfirmations || []).map(item => `<div class="event"><b>PENDING</b> ${esc(item.action)} · ${esc(item.target)}<br><small>${esc(item.reason)} · ${esc(item.id)}</small></div>`); const entries = (audit.items || []).slice(0, 30).map(item => `<div class="event"><b>${esc(item.status)}</b> ${esc(item.action)} · ${esc(item.target || '')}<br><small>${esc(item.timestamp)}</small></div>`); $('pcAudit').innerHTML = pending.concat(entries).join('') || '<p class="muted">No PC-control actions.</p>';
  } catch (error) { $('pcAudit').textContent = `PC control unavailable: ${error.message}`; }
}
function renderFortnitePrep(data) {
  if (!$('fortnitePrepStatus') || !data) return;
  $('fortnitePrepStatus').innerHTML = `<b>${esc(data.state || 'UNAVAILABLE')}</b> · ${esc(data.summary || '')}<br>${(data.steps || []).map(step => `<small>${esc(step.name)}: ${esc(step.state)} — ${esc(step.message)}</small>`).join('<br>')}`;
}
let registeredDevices = [];
function openDeviceModal(device = null) {
  $('deviceModal').hidden = false;
  $('deviceModalTitle').textContent = device ? 'EDIT SSH DEVICE' : 'ADD SSH DEVICE';
  $('deviceId').value = device?.id || '';
  $('deviceName').value = device?.name || '';
  $('deviceHost').value = device?.host || '';
  $('deviceUsername').value = device?.username || '';
  $('devicePort').value = device?.port || 22;
  $('devicePlatform').value = device?.platform || 'linux';
  $('devicePassword').value = '';
  $('removeDevicePassword').checked = false;
  $('removePasswordRow').hidden = !device;
  $('keepPasswordHint').hidden = !device;
  $('deviceScreenUrl').value = device?.screenViewerUrl || '';
  document.querySelectorAll('[name="deviceCapability"]').forEach(input => { input.checked = device ? (device.capabilities || []).includes(input.value) : input.value === 'system_status'; });
  $('deviceFormError').textContent = '';
}
function closeDeviceModal() { $('deviceModal').hidden = true; $('deviceForm').reset(); $('devicePort').value = 22; }
function devicePayload() {
  const id = $('deviceId').value;
  const name = $('deviceName').value.trim();
  const host = $('deviceHost').value.trim();
  const username = $('deviceUsername').value.trim();
  const port = Number($('devicePort').value);
  if (!name || !host || !username || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid name, hostname, username, and SSH port.');
  if (!/^[A-Za-z0-9 _().-]{1,100}$/.test(name)) throw new Error('Device name contains unsupported characters.');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(host) && !/^\[[0-9A-Fa-f:]+\]$/.test(host)) throw new Error('Hostname/IP is invalid.');
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(username)) throw new Error('SSH username is invalid.');
  const capabilities = [...document.querySelectorAll('[name="deviceCapability"]:checked')].map(input => input.value);
  const screenViewerUrl = $('deviceScreenUrl').value.trim();
  if (screenViewerUrl && !capabilities.includes('mac_screen_view')) throw new Error('Enable Mac screen before adding a viewer URL.');
  const password = $('devicePassword').value;
  return { name, host, username, port, platform: $('devicePlatform').value, capabilities, ...(screenViewerUrl ? { screenViewerUrl } : {}), ...(password ? { password } : {}), ...(id ? { removePassword: $('removeDevicePassword').checked } : {}) };
}
async function loadDevices() {
  try {
    const [devices, audit] = await Promise.all([api('/api/devices'), api('/api/devices/audit')]);
    registeredDevices = devices.devices || [];
    $('deviceList').innerHTML = registeredDevices.map(device => {
      const state = String(device.status || 'unknown').toLowerCase();
      const macButton = device.platform === 'macos' && (device.capabilities || []).includes('mac_screen_view') ? `<button data-device-screen="${esc(device.id)}">Open Mac Screen</button>` : '';
      return `<div class="device-card"><div class="panel-heading"><b>${esc(device.name)}</b><span class="device-status ${esc(state)}">${esc(device.status || 'UNKNOWN')} · ${device.enabled ? 'ENABLED' : 'DISABLED'}</span></div><div class="device-meta"><span><strong>Type:</strong> ${esc(device.platform)}</span><span><strong>Host:</strong> ${esc(device.host)}</span><span><strong>User:</strong> ${esc(device.username)} · <strong>Port:</strong> ${esc(device.port)}</span><span><strong>Last checked:</strong> ${esc(device.lastSeen || 'never')}</span><span><strong>Capabilities:</strong> ${esc((device.capabilities || []).join(', ') || 'none')}</span><span><strong>Password:</strong> ${device.passwordConfigured ? 'Configured' : 'Not configured'}</span></div><div class="device-actions"><button data-device-test="${esc(device.id)}">Test Connection</button><button data-device-edit="${esc(device.id)}">Edit</button><button data-device-toggle="${esc(device.id)}">${device.enabled ? 'Disable' : 'Enable'}</button><button data-device-status="${esc(device.id)}">View Status</button><button data-device-audit="${esc(device.id)}">View Audit</button>${macButton}<button data-device-remove="${esc(device.id)}" class="danger">Remove</button></div></div>`;
    }).join('') || '<p class="muted">No devices are registered. Add your first device using Windows OpenSSH or ssh-agent.</p>';
    $('deviceAudit').innerHTML = (audit.items || []).slice(0, 40).map(item => `<div class="event"><b>${esc(item.status)}</b> ${esc(item.deviceId)} · ${esc(item.action)}<br><small>${esc(item.timestamp)} · request ${esc(item.requestId)}</small></div>`).join('') || '<p class="muted">No remote actions recorded.</p>';
    document.querySelectorAll('[data-device-test]').forEach(button => button.onclick = async () => { try { await api(`/api/devices/${encodeURIComponent(button.dataset.deviceTest)}/test`, { method: 'POST', body: '{}' }); await loadDevices(); } catch (error) { alert(`Connection test failed: ${error.message}`); } });
    document.querySelectorAll('[data-device-toggle]').forEach(button => button.onclick = async () => { const device = registeredDevices.find(item => item.id === button.dataset.deviceToggle); try { await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !device.enabled }) }); await loadDevices(); } catch (error) { alert(error.message); } });
    document.querySelectorAll('[data-device-edit]').forEach(button => button.onclick = () => openDeviceModal(registeredDevices.find(item => item.id === button.dataset.deviceEdit)));
    document.querySelectorAll('[data-device-status]').forEach(button => button.onclick = async () => { try { const result = await api(`/api/devices/${encodeURIComponent(button.dataset.deviceStatus)}/status`); alert(`${result.device.name}: ${result.device.status || 'unknown'}\nLast seen: ${result.device.lastSeen || 'never'}`); } catch (error) { alert(`Status unavailable: ${error.message}`); } });
    document.querySelectorAll('[data-device-audit]').forEach(button => button.onclick = () => { const items = (audit.items || []).filter(item => item.deviceId === button.dataset.deviceAudit).slice(0, 20); alert(items.length ? items.map(item => `${item.timestamp} ${item.action} ${item.status}`).join('\n') : 'No audit entries for this device.'); });
    document.querySelectorAll('[data-device-screen]').forEach(button => button.onclick = async () => { try { const result = await api(`/api/devices/${encodeURIComponent(button.dataset.deviceScreen)}/screen`); if (result.data?.viewerUrl) window.open(result.data.viewerUrl, '_blank', 'noopener,noreferrer'); } catch (error) { alert(`Mac screen unavailable: ${error.message}`); } });
    document.querySelectorAll('[data-device-remove]').forEach(button => button.onclick = async () => { if (confirm('Remove this registered device?')) { try { await api(`/api/devices/${encodeURIComponent(button.dataset.deviceRemove)}`, { method: 'DELETE' }); await loadDevices(); } catch (error) { alert(error.message); } } });
  } catch (error) { $('deviceList').textContent = `Device registry unavailable: ${error.message}`; }
}
async function loadMacScreen() {
  try {
    const registry = await api('/api/devices');
    const device = (registry.devices || []).find(item => item.enabled && item.platform === 'macos' && (item.capabilities || []).includes('mac_screen_view'));
    if (!device) { $('macScreenStatus').textContent = 'UNAVAILABLE — no enabled Mac device with mac_screen_view is registered.'; return; }
    const result = await api(`/api/devices/${encodeURIComponent(device.id)}/screen`);
    const data = result.data || {};
    $('macScreenStatus').textContent = `${device.name} · ${data.status} · ${data.message}`;
    $('openMacScreen').onclick = () => window.open(data.viewerUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    $('macScreenStatus').textContent = `Mac screen unavailable: ${error.message}`;
  }
}
async function loadAlerts() { const result = await api('/api/admin/alerts'); $('alerts').innerHTML = result.alerts.map(a => `<div class="event"><b>${esc(a.rule)}</b> ${a.active ? 'ACTIVE' : 'clear'}<br><small>Source: local telemetry</small></div>`).join('') || '<p class="muted">No alert rules have fired.</p>'; }
async function loadAutomation() { const result = await api('/api/admin/automation'); $('automationStatus').innerHTML = result.rules.map(rule => `<div class="event"><b>${esc(rule.name)}</b> <span>${rule.enabled ? 'enabled' : 'disabled'}</span><br>${esc(rule.trigger?.type)} · next ${esc(rule.nextRunAt || '—')} · last ${esc(rule.lastStatus)} · runs ${esc(rule.runCount)} · failures ${esc(rule.failureCount)}<br><button data-run-rule="${esc(rule.id)}">Run now</button><button data-test-rule="${esc(rule.id)}">Dry run</button><button data-toggle-rule="${esc(rule.id)}">${rule.enabled ? 'Disable' : 'Enable'}</button><button data-delete-rule="${esc(rule.id)}" class="danger">Delete</button></div>`).join('') || '<p class="muted">No automation rules configured.</p>'; const history = await api('/api/admin/automation/history'); $('automationHistory').innerHTML = (history.executions || []).slice().reverse().map(item => `<div class="event"><b>${esc(item.status)}</b> ${esc(item.executionId)}<br><small>${esc(item.startedAt)} · ${esc(item.error || '')}</small></div>`).join('') || '<p class="muted">No executions.</p>'; document.querySelectorAll('[data-run-rule]').forEach(button => button.onclick = async () => { await api(`/api/admin/automation/${button.dataset.runRule}/run`, { method: 'POST', body: '{}' }); loadAutomation(); }); document.querySelectorAll('[data-test-rule]').forEach(button => button.onclick = async () => { await api(`/api/admin/automation/${button.dataset.testRule}/test`, { method: 'POST', body: '{}' }); loadAutomation(); }); document.querySelectorAll('[data-toggle-rule]').forEach(button => button.onclick = async () => { const rule = result.rules.find(item => item.id === button.dataset.toggleRule); await api(`/api/admin/automation/${button.dataset.toggleRule}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) }); loadAutomation(); }); document.querySelectorAll('[data-delete-rule]').forEach(button => button.onclick = async () => { if (confirm('Delete this rule?')) { await api(`/api/admin/automation/${button.dataset.deleteRule}`, { method: 'DELETE' }); loadAutomation(); } }); }
let analyticsPoints = [], chartSource = null;
function drawChart() {
  const canvas = $('telemetryChart'); if (!canvas) return; const ctx = canvas.getContext('2d'), metric = $('chartMetric').value, type = $('chartType').value;
  const metrics = metric === 'cpuRam' ? ['cpuPercent', 'ramPercent'] : [metric], series = metrics.map(key => analyticsPoints.map(point => Number(point[key])).filter(Number.isFinite)), values = series.flat(); ctx.clearRect(0, 0, canvas.width, canvas.height); if (!values.length) { ctx.fillStyle = '#8291a7'; ctx.fillText('No supported telemetry for this metric.', 20, 40); return; }
  const max = Math.max(...values, 1), width = canvas.clientWidth || 700; canvas.width = width; const height = canvas.height, step = width / Math.max(series[0].length, 1);
  series.forEach((line, seriesIndex) => { ctx.strokeStyle = seriesIndex ? '#9d8cff' : '#52d5ff'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2; ctx.beginPath(); line.forEach((value, index) => { const x = index * step + step / 2, y = height - (value / max) * (height - 25); if (type === 'bar' && series.length === 1) ctx.fillRect(x - Math.max(2, step * .3), y, Math.max(3, step * .6), height - y); else index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (type === 'line' || series.length > 1) ctx.stroke(); });
  chartSource = { source: 'server.js telemetryHistory from local OS/process probes', timestamp: new Date().toISOString(), metric, range: $('analyticsRange').value, values: values.slice(-10) };
}
async function loadAnalytics() { const result = await api(`/api/admin/analytics?range=${encodeURIComponent($('analyticsRange').value)}`); analyticsPoints = result.points || []; $('analyticsData').textContent = analyticsPoints.map(p => `${new Date(p.ts).toLocaleTimeString()} CPU ${p.cpuPercent}% | RAM ${p.ramPercent}% | Disk free ${p.diskFreePercent ?? 'UNAVAILABLE'}% | Ollama ${p.ollama} | Whisper ${p.whisper}`).join('\n') || 'No telemetry collected for this range.'; drawChart(); }
function applyChartCommand() { const command = $('chartCommand').value.trim().toLowerCase(); if (!command) return; if (command.includes('30 minute')) $('analyticsRange').value = '30'; if (command.includes('5 minute')) $('analyticsRange').value = '5'; if (command.includes('1 hour')) $('analyticsRange').value = '60'; if (command.includes('6 hour')) $('analyticsRange').value = '360'; if (command.includes('24 hour')) $('analyticsRange').value = '1440'; if (command.includes('compare') && command.includes('cpu') && command.includes('ram')) $('chartMetric').value = 'cpuRam'; else if (command.includes('cpu only')) $('chartMetric').value = 'cpuPercent'; else if (command.includes('ram')) $('chartMetric').value = 'ramPercent'; else if (command.includes('latency')) $('chartMetric').value = 'latency'; if (command.includes('bar')) $('chartType').value = 'bar'; else if (command.includes('line')) $('chartType').value = 'line'; if (!/(minute|hour|cpu|ram|latency|bar|line|compare)/.test(command)) return alert('Supported commands: time range, CPU only, Compare CPU and RAM, latency, line, or bar.'); loadAnalytics(); }
function showEvidence(value) { $('evidenceText').textContent = JSON.stringify(value, null, 2); $('evidencePanel').classList.add('open'); }
async function loadTldr() { const result = await api('/api/admin/tldr'); tldrSourceData = result.data; $('tldrText').textContent = `${result.data.summary} Source: ${result.data.source}.`; }
let emailData = null;
async function loadEmail() { const result = await api('/api/admin/email'); const data = result.data; emailData = data; const c = data.counts || {}; $('emailStatus').textContent = data.connected ? `Connected: ${data.provider} (${data.account || 'account unavailable'}) | Last sync: ${data.lastSync || 'never'} | Source: Email provider` : 'EMAIL INTEGRATION: UNAVAILABLE — no authorized provider token is available.'; $('emailCounts').innerHTML = [['URGENT', c.urgent], ['IMPORTANT', c.important], ['NORMAL', c.normal], ['LOW', c.low], ['UNREAD IMPORTANT', c.unreadImportant], ['UNREAD URGENT', c.unreadUrgent]].map(([name, value]) => `<div class="card"><small>${name}</small><b>${value ?? 0}</b></div>`).join(''); renderEmail(); }
function renderEmail() { if (!emailData) return; const filter = $('emailFilter').value; const notifications = (emailData.notifications || []).filter(item => filter === 'ALL' || item.level === filter); const messages = (emailData.emails || []).filter(item => filter === 'ALL' || item.level === filter); $('emailNotifications').innerHTML = notifications.map(item => `<div class="event"><b>${esc(item.level)} EMAIL</b> from ${esc(item.sender)}<br>${esc(item.subject)}<br><small>${esc(item.reason)} | ${esc(item.received)} | Source: ${esc(item.source)}</small>${item.verification ? '<br><small>Verification email received; code withheld.</small>' : ''}<button data-email-why="${esc(item.id)}">Why?</button></div>`).join('') || '<p class="muted">No matching notifications.</p>'; $('emailMessages').innerHTML = messages.slice(0, 100).map(item => `<div class="event"><b>${esc(item.level)}</b> ${esc(item.sender)} — ${esc(item.subject)} <button data-email-why="${esc(item.id)}">Why?</button><br><small>${esc(item.received)} | ${item.unread ? 'UNREAD' : 'read'} | Source: ${esc(item.source)}</small></div>`).join('') || '<p class="muted">No processed messages.</p>'; document.querySelectorAll('[data-email-why]').forEach(button => button.onclick = () => showEvidence((emailData.emails || []).find(item => item.id === button.dataset.emailWhy) || { status: 'Message evidence unavailable' })); }
async function syncEmail() { try { await api('/api/admin/email/sync', { method: 'POST', body: '{}' }); await loadEmail(); } catch (error) { $('emailStatus').textContent = error.message; } }
async function loadWorker() { const [worker, tasks] = await Promise.all([api('/api/admin/worker'), api('/api/admin/worker/tasks')]); const data = worker.data; const taskItems = tasks.tasks || []; const capabilities = Array.isArray(data.capabilities) ? data.capabilities.join(', ') : 'UNAVAILABLE'; const agent = data.codeAgent || {}; const telemetry = data.telemetry || {}; const researchTool = data.researchTool || {}; if ($('researchToolStatus')) $('researchToolStatus').textContent = `Research tool: ${researchTool.method || 'UNAVAILABLE'} · ${researchTool.state || 'UNKNOWN'} · ${researchTool.detail || 'No live tool status.'}`; $('workerStatus').innerHTML = `<b>${esc(data.status)}</b> — ${esc(data.statusReason || 'No additional status details.')}<br><span>Research: ${esc(data.research)} | Coding: ${esc(data.coding)} | File operations: ${esc(data.fileOperations || 'UNAVAILABLE')}</span><br><small>Worker: ${esc(data.workerId)} | Active workers: ${esc(data.activeWorkers ?? 0)} | Endpoint: ${esc(data.url || 'not configured')} | Latency: ${esc(data.latencyMs ?? '—')} ms | Last heartbeat: ${esc(data.lastHeartbeat || '—')}</small><br><small>Pi telemetry: CPU ${esc(telemetry.cpuPercent ?? 'UNAVAILABLE')}% · RAM ${esc(telemetry.ramUsedPercent ?? 'UNAVAILABLE')}% · Disk free ${esc(telemetry.diskFreePercent ?? 'UNAVAILABLE')}% · sampled ${esc(telemetry.sampledAt || '—')}</small><br><small>Pi CodeAgent: ${agent.available ? 'READY' : 'UNAVAILABLE'} | Version: ${esc(agent.version || '—')} | Model: ${esc(agent.model || '—')} | Shell approval: ${agent.shellAutoApproval === false ? 'DISABLED' : 'UNAVAILABLE'}</small><br><small>Current task: ${esc(data.currentTask || 'NONE')} | Copilot session: ${esc(data.copilotSession || 'UNAVAILABLE')} | Capabilities: ${esc(capabilities)} | Source: ${esc(data.source || 'coordinator configuration')}</small>`; $('workerTasks').innerHTML = taskItems.slice().reverse().map(task => { const result = task.result || {}; const changed = Array.isArray(result.filesChanged) ? result.filesChanged.join(', ') || 'none detected' : 'not reported'; const tests = Array.isArray(result.tests) ? result.tests.map(test => `${test.name || 'test'}: ${test.status || 'unknown'}`).join(', ') || 'none reported' : 'not reported'; return `<div class="event"><b>${esc(task.codingStatus || task.status)}</b> ${esc(task.taskId)}<br>${esc(task.description)}<br><small>Worker: ${esc(task.workerId || '—')} | Project: ${esc(task.workspace)} | Started: ${esc(task.startedAt || '—')} | Completed: ${esc(task.completedAt || '—')}</small><br><small>Result: ${esc(result.summary || result.reason || result.error || result.status || 'not available')}</small><br><small>Files changed: ${esc(changed)} | Tests: ${esc(tests)}</small></div>`; }).join('') || '<p class="muted">No coding tasks submitted.</p>'; if ($('codingActivity')) $('codingActivity').innerHTML = taskItems.length ? taskItems.slice(-5).reverse().map(task => `<div class="event"><b>${esc(task.codingStatus || task.status)}</b><br>${esc(task.workerId || 'UNAVAILABLE')} · ${esc(task.taskId)}</div>`).join('') : '<span class="unavailable">No coding activity.</span>'; }
let systemPollTimer = null;
function systemLoading(id) { $(id).textContent = 'Loading...'; }
function systemError(id, message, kind = 'unavailable') { $(id).innerHTML = `<span class="system-${kind}">${esc(kind === 'not-detected' ? 'Not detected' : kind === 'error' ? `Error: ${message}` : `Unavailable: ${message}`)}</span>`; }
async function loadSystem() {
  ['systemHardware', 'systemOs', 'systemElla', 'systemDevices', 'systemStorage', 'systemNetwork', 'systemProcesses'].forEach(systemLoading);
  const overviewPromise = api('/api/admin/overview').then(result => {
    const data = result.data || {}, system = data.system || {}, memory = system.memory || {}, disk = system.disk || {};
    $('systemHardware').innerHTML = `<strong>CPU:</strong> ${esc(system.cpuPercent ?? 'UNAVAILABLE')}%<br><strong>RAM:</strong> ${esc(memory.usedPercent ?? 'UNAVAILABLE')}% used<br><strong>GPU:</strong> ${esc(system.gpu?.status || 'Not detected')}<br><strong>Temperature:</strong> ${esc(system.temperature?.status || 'Not detected')}`;
    $('systemOs').innerHTML = `<strong>Host:</strong> ${esc(system.hostname || 'UNAVAILABLE')}<br><strong>Node:</strong> ${esc(data.node?.version || 'UNAVAILABLE')}<br><strong>OS uptime:</strong> ${esc(Math.round(Number(system.uptime || 0) / 3600))} hours`;
    $('systemElla').innerHTML = `<strong>Ella:</strong> ${data.ella?.online ? 'ONLINE' : 'OFFLINE'}<br><strong>Ollama:</strong> ${esc(data.ollama?.status || 'UNAVAILABLE')} · ${esc(data.ollama?.activeModel || data.ollama?.configuredModel || 'UNAVAILABLE')}<br><strong>Whisper:</strong> ${esc(data.whisper?.status || 'UNAVAILABLE')}<br><strong>Worker:</strong> ${esc(data.worker?.status || 'UNAVAILABLE')}`;
    $('systemStorage').innerHTML = `<strong>Free:</strong> ${esc(disk.freePercent ?? 'UNAVAILABLE')}%<br><strong>Volume:</strong> ${esc(disk.source || 'UNAVAILABLE')}`;
  }).catch(error => { ['systemHardware', 'systemOs', 'systemElla', 'systemStorage'].forEach(id => systemError(id, error.message, 'error')); });
  const devicePromise = api('/api/devices').then(result => { const devices = result.devices || []; $('systemDevices').innerHTML = devices.length ? devices.map(device => `<div><strong>${esc(device.name)}</strong> · ${esc(device.status || 'UNKNOWN')} · ${esc(device.platform)}</div>`).join('') : '<span class="system-error">Not detected: no registered devices.</span>'; }).catch(error => systemError('systemDevices', error.message, 'error'));
  const networkPromise = api('/api/pc/network').then(result => { const items = result.items || []; $('systemNetwork').innerHTML = items.length ? items.map(item => `<div><strong>${esc(item.Name || 'Adapter')}</strong> · ${esc(item.Status || 'UNKNOWN')} · ${esc(item.LinkSpeed || '—')}</div>`).join('') : '<span class="system-error">Not detected: no network adapters reported.</span>'; }).catch(error => systemError('systemNetwork', error.message, 'error'));
  const processPromise = api('/api/pc/processes').then(result => { const items = result.items || []; $('systemProcesses').innerHTML = items.length ? items.slice(0, 30).map(item => `<span class="event"><strong>${esc(item.ProcessName || 'Process')}</strong> · PID ${esc(item.Id)}</span>`).join('') : '<span class="system-error">Unavailable: no process data.</span>'; }).catch(error => systemError('systemProcesses', error.message, 'error'));
  await Promise.allSettled([overviewPromise, devicePromise, networkPromise, processPromise]);
}
function startSystemPolling() { if (systemPollTimer) return; $('systemPollStatus').textContent = 'POLLING: ON · 15s'; loadSystem(); systemPollTimer = setInterval(() => { if ($('system')?.classList.contains('active')) loadSystem(); }, 15000); }
function stopSystemPolling() { if (systemPollTimer) { clearInterval(systemPollTimer); systemPollTimer = null; } if ($('systemPollStatus')) $('systemPollStatus').textContent = 'POLLING: OFF'; }
async function loadCodingActions() { const result = await api('/api/admin/action-requests'); const items = (result.requests || []).filter(item => item.classification === 'SIMPLE_FILE_OPERATION' || item.classification === 'AUTONOMOUS_CODING').slice().reverse(); if (!items.length) return; $('workerTasks').innerHTML += items.map(item => `<div class="event"><b>${esc(item.status)}</b> ${esc(item.requestId)}<br>${esc(item.text)}<br><small>Classification: ${esc(item.classification)} | Worker: ${esc(item.worker || 'NONE')} | Completed: ${esc(item.completedAt || '—')}</small></div>`).join(''); }
async function loadResearch() {
  const [result, scheduler] = await Promise.all([api('/api/research/tasks'), api('/api/research/status')]); const task = (result.tasks || []).slice(-1)[0];
  if ($('researchScheduler')) { const data = scheduler.data || {}, resources = data.resources || {}; $('researchScheduler').textContent = `Scheduler: ${data.activeWorkers || 0} active workers · ${data.queuedTasks || 0} queued tasks · current ${data.currentConcurrency || data.maxConcurrency || 4}/${data.maxConcurrency || 4} · profile ${data.resourceProfile || 'BALANCED'} · Windows CPU ${resources.windowsCpu ?? 'UNAVAILABLE'} · Windows RAM ${resources.windowsRam ?? 'UNAVAILABLE'} · Pi CPU ${resources.piCpu ?? 'UNAVAILABLE'} · Pi RAM ${resources.piRam ?? 'UNAVAILABLE'} · Pi disk free ${resources.piDiskFree ?? 'UNAVAILABLE'}% · completed ${data.completed || 0} · failed ${data.failed || 0}`; if ($('researchConcurrency')) $('researchConcurrency').value = String(data.maxConcurrency || 4); }
  if (!task) { $('researchStatus').textContent = 'No research task loaded.'; return; }
  const detail = await api(`/api/research/task/${encodeURIComponent(task.taskId)}`); const current = detail.task || task; const elapsed = current.elapsedMs || (current.startedAt ? Date.now() - Date.parse(current.startedAt) : 0);
  $('researchStatus').textContent = `${current.status} · ${current.currentPhase || 'UNAVAILABLE'} · ${current.currentActivity || ''}`;
  $('researchMetrics').innerHTML = [['Topic', current.query], ['Elapsed', `${Math.round(elapsed / 1000)}s`], ['Remaining', current.maxDurationMs ? `${Math.max(0, Math.round((current.maxDurationMs - elapsed) / 60000))}m` : 'UNAVAILABLE'], ['Workers', `${current.activeWorkers || 0}/${current.maxConcurrency || 4}`], ['Profile', current.resourceProfile || 'BALANCED'], ['Discovered', current.sourcesDiscovered ?? 'UNAVAILABLE'], ['Fetched', current.sourcesFetched ?? 'UNAVAILABLE'], ['Extracted', current.sourcesExtracted ?? current.sourcesRead], ['Success rate', current.successfulSourceRate !== undefined ? `${Math.round(current.successfulSourceRate * 100)}%` : 'UNAVAILABLE'], ['Failed rate', current.failedSourceRate !== undefined ? `${Math.round(current.failedSourceRate * 100)}%` : 'UNAVAILABLE'], ['Domains', (current.uniqueDomains || []).length], ['Categories', (current.sourceCategories || []).join(', ') || 'UNAVAILABLE'], ['Claims', current.factsExtracted], ['Rejected', current.rejectedClaims], ['Deduplicated', current.deduplicatedClaims], ['Retries', current.retryCount ?? 'UNAVAILABLE'], ['Follow-ups', current.followUpSearches], ['Conflicts', current.conflictsFound], ['Ollama', current.synthesisStatus || 'PENDING']].map(([name, value]) => `<div class="card"><small>${esc(name)}</small><b>${esc(value ?? 'UNAVAILABLE')}</b></div>`).join('');
  const timeline = detail.timeline || []; $('researchTimeline').innerHTML = timeline.length ? timeline.slice().reverse().map(event => `<div class="event"><b>${esc(event.type)}</b> ${esc(event.message || '')}<br><small>${esc(event.timestamp)}${event.category ? ` · ${esc(event.category)}` : ''}${event.error ? ` · ${esc(event.error)}` : ''}</small></div>`).join('') : `<div class="event"><b>${esc(current.currentPhase || current.status)}</b><br>${esc(current.currentActivity || '')}</div>`;
  $('researchSources').innerHTML = (detail.sources || []).map(source => `<div class="event"><b>${esc(source.title)}</b><br><small>${esc(source.status || 'DISCOVERED')} · ${esc(source.routingCategory || source.sourceType)} · ${esc(source.domain || '—')} · ${esc(source.extractionMethod || '—')} · chars ${esc(source.extractedCharacters ?? 0)} · retries ${esc(source.retryCount ?? 0)} · ${esc(source.failureReason || 'no failure')}</small><br><small>${esc(source.quality || 'UNKNOWN')} · quality ${esc(source.qualityScore ?? '—')} · relevance ${esc(source.relevanceScore ?? '—')} · ${esc(source.confidence || '—')} · ${esc(source.sourceId)}</small><br><small>Visited: ${esc(source.visitedAt || '—')} · Browser: ${source.browser?.opened ? 'OPENED' : esc(source.browser?.reason || 'not opened')}</small><br><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.url)}</a></div>`).join('') || '<span class="unavailable">No source attempts recorded.</span>';
  const conflicts = detail.conflicts || [];
  $('researchKnowledge').innerHTML = (detail.claims || detail.knowledge || []).map(item => `<div class="event"><b>${esc(item.status || 'UNCERTAIN')} · ${esc(item.confidence)}</b><br>${esc(item.claim)}<br><small>Support count: ${esc(item.supportCount ?? '—')} · Contradiction count: ${esc(item.contradictionCount ?? 0)} · Sources: ${esc((item.sourceIds || item.support || []).join(', '))} · Related: ${esc((item.relatedKnowledgeIds || []).length)}</small></div>`).join('') + (conflicts.length ? conflicts.map(item => `<div class="event"><b>CONFLICT ${esc(item.confidence || 'UNKNOWN')}</b><br>${esc(item.claimA || item.claim || '')}<br>vs. ${esc(item.claimB || item.difference || '')}<br><small>${esc(item.resolution || 'UNRESOLVED')} · ${esc(item.sourceA || '')} vs ${esc(item.sourceB || '')}</small></div>`).join('') : '') || '<span class="unavailable">No claims or knowledge items created.</span>';
}
async function loadKnowledge() {
  const [filesResult, imagesResult] = await Promise.all([api('/api/knowledge/files'), api('/api/knowledge/images')]);
  const query = $('knowledgeSearch')?.value?.trim() || '';
  const searchResult = query ? await api('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query }) }) : null;
  const files = filesResult.files || [];
  if ($('knowledgeStorage')) $('knowledgeStorage').textContent = `Storage: ${Math.round((filesResult.usageBytes || 0) / 1024)} KB used of ${Math.round((filesResult.limitBytes || 0) / 1024 / 1024)} MB`;
  if ($('knowledgeStats')) $('knowledgeStats').innerHTML = [['Files', files.length], ['Indexed', files.filter(item => item.status === 'INDEXED').length], ['Processing', files.filter(item => item.status === 'PROCESSING').length], ['Failed', files.filter(item => item.status === 'FAILED').length]].map(([name, value]) => `<div class="card"><small>${esc(name)}</small><b>${esc(value)}</b></div>`).join('');
  if ($('knowledgeImages')) $('knowledgeImages').innerHTML = (imagesResult.images || []).map(item => `<div class="event"><b>${esc(item.filename)}</b> · ${esc(item.status)} · ${esc(item.width || item.dimensions?.width || '—')}×${esc(item.height || item.dimensions?.height || '—')}<br><small>Uploaded ${esc(item.uploadedAt)}${item.analysis ? ` · ${esc(item.analysis.slice(0, 280))}` : ''}</small><br><button data-image-analyze="${esc(item.id)}">Analyze</button> <button data-image-ask="${esc(item.id)}">Ask Ella about this image</button> <button data-knowledge-delete="${esc(item.id)}" class="danger">Archive</button></div>`).join('') || '<span class="unavailable">No uploaded images.</span>';
  if ($('knowledgeList')) $('knowledgeList').innerHTML = (query ? (searchResult.matches || []).map(item => `<div class="event"><b>${esc(item.filename)} · ${esc(item.relevance)}</b><br>${esc(item.snippet)}<br><small>Chunk ${esc(item.chunkId)} · indexed ${esc(item.indexedAt)}</small></div>`) : files.map(item => `<div class="event"><b>${esc(item.filename)}</b> <span>${esc(item.extension.toUpperCase())} · ${esc(item.status)}</span><br><small>${esc(Math.round(item.size / 1024))} KB · uploaded ${esc(item.uploadedAt)} · chunks ${esc(item.chunkCount ?? 0)}</small><br><button data-knowledge-view="${esc(item.id)}">View info</button> <button data-knowledge-reindex="${esc(item.id)}">Re-index</button> <button data-knowledge-delete="${esc(item.id)}" class="danger">Archive</button></div>`)).join('') || '<span class="unavailable">No uploaded files.</span>';
  document.querySelectorAll('[data-knowledge-view]').forEach(button => button.onclick = async () => { const result = await api(`/api/knowledge/files/${encodeURIComponent(button.dataset.knowledgeView)}`); $('knowledgeDetails').textContent = JSON.stringify(result.file, null, 2); });
  document.querySelectorAll('[data-knowledge-reindex]').forEach(button => button.onclick = async () => { await api(`/api/knowledge/files/${encodeURIComponent(button.dataset.knowledgeReindex)}/reindex`, { method: 'POST', body: '{}' }); await loadKnowledge(); });
  document.querySelectorAll('[data-image-analyze]').forEach(button => button.onclick = async () => { await api(`/api/knowledge/images/${encodeURIComponent(button.dataset.imageAnalyze)}/analyze`, { method: 'POST', body: '{}' }); await loadKnowledge(); });
  document.querySelectorAll('[data-image-ask]').forEach(button => button.onclick = async () => { const question = prompt('What should Ella answer about this image?', 'What is shown in this image?'); if (question?.trim()) { const result = await api(`/api/knowledge/images/${encodeURIComponent(button.dataset.imageAsk)}/ask`, { method: 'POST', body: JSON.stringify({ question }) }); $('knowledgeDetails').textContent = result.data?.result?.answer || result.data?.result?.error || 'No answer returned.'; } });
  document.querySelectorAll('[data-knowledge-delete]').forEach(button => button.onclick = async () => { if (confirm('Archive this knowledge file?')) { await api(`/api/knowledge/files/${encodeURIComponent(button.dataset.knowledgeDelete)}`, { method: 'DELETE' }); await loadKnowledge(); } });
}
async function loadWatch() { const status = await api('/api/watch/status'); const history = await api('/api/admin/watch/commands'); const data = status.data || {}; const items = history.items || []; const latest = items[items.length - 1]; $('watchStatus').innerHTML = `<b>Watch API: ${esc(data.status)}</b> | Authentication: ${esc(data.authentication)}<br><small>Supported: ${esc((data.supportedCommands || []).join(', '))}</small><br><small>Last command: ${esc(latest?.command || 'NONE')} | Last request: ${esc(latest?.requestId || 'NONE')} | Last result: ${esc(latest?.status || 'NONE')} | Last request time: ${esc(latest?.receivedAt || 'NONE')}</small>`; $('watchHistory').innerHTML = items.slice().reverse().map(item => `<div class="event"><b>${esc(item.status)}</b> ${esc(item.command)}<br><small>${esc(item.receivedAt)} · ${esc(item.source)} · ${esc(item.requestId)}</small></div>`).join('') || '<span class="unavailable">No watch commands received.</span>'; }
async function loadHealth() { const result = await api('/api/health'); const data = result.data || {}; $('healthSummary').textContent = data.checkedAt ? `${data.overall} · ${data.checkedAt}` : 'Health check has not run.'; $('healthChecks').innerHTML = Object.entries(data.checks || {}).map(([name, item]) => `<div class="card"><small>${esc(name)}</small><b>${esc(item.status)}</b><span>${esc(item.message)}</span></div>`).join('') || '<span class="unavailable">No health results.</span>'; }
async function runQuery() { const result = await api('/api/admin/query', { method: 'POST', body: JSON.stringify({ query: $('queryBar').value }) }); querySourceData = result; $('queryResult').innerHTML = `${esc(result.answer)} Source: ${esc(result.source)}.<br><button id="querySource" class="source-button">Source</button>`; $('querySource').onclick = () => showEvidence(querySourceData); }
async function loadBob() {
  try {
    const [status, activity] = await Promise.all([api('/api/bob/status'), api('/api/bob/activity')]);
    const data = status.data || {};
    $('bobStatus').textContent = `BOB ${data.status} · ${data.currentTask ? `TASK ${data.currentTask.id}` : 'IDLE'} · conversational child`;
    $('bobPermissions').innerHTML = Object.entries(data.permissions || {}).map(([key, enabled]) => `<label class="check"><input type="checkbox" data-bob-permission="${esc(key)}" ${enabled ? 'checked' : ''}> ${esc(key.replaceAll('_', ' '))}</label>`).join('');
    $('bobActivity').innerHTML = (activity.items || []).slice(0, 20).map(item => `<div class="event"><b>${esc(item.kind)}</b> ${esc(item.message)}<br><small>${esc(item.timestamp)}</small></div>`).join('') || '<span class="unavailable">No Bob activity.</span>';
    $('bobConfig').innerHTML = `<strong>Model:</strong> ${esc(data.model || 'configured in Bob process')}<br><strong>Website:</strong> http://127.0.0.1:3010/<br><strong>State:</strong> ${esc(data.status)}`;
    document.querySelectorAll('[data-bob-permission]').forEach(input => input.onchange = async () => { await api('/api/bob/permissions', { method: 'PATCH', body: JSON.stringify({ [input.dataset.bobPermission]: input.checked }) }); });
  } catch (error) { $('bobStatus').textContent = `BOB UNAVAILABLE · ${error.message}`; }
}
async function loadVault() { try { const result = await api('/api/vault'); $('vaultList').innerHTML = (result.credentials || []).map(item => `<div class="event"><b>${esc(item.label)}</b> · ${esc(item.id)}<br><small>Updated ${esc(item.updatedAt)}</small><button data-vault-remove="${esc(item.id)}">Remove</button></div>`).join('') || '<p class="muted">No protected credentials configured.</p>'; document.querySelectorAll('[data-vault-remove]').forEach(button => button.onclick = async () => { await api(`/api/vault/${encodeURIComponent(button.dataset.vaultRemove)}`, { method: 'DELETE' }); loadVault(); }); } catch (error) { $('vaultList').textContent = error.message; } }

document.querySelectorAll('.nav').forEach(button => button.onclick = () => { document.querySelectorAll('.nav').forEach(item => item.classList.remove('active')); document.querySelectorAll('.page').forEach(page => page.classList.remove('active')); button.classList.add('active'); $(`${button.dataset.page}`).classList.add('active'); $('pageTitle').textContent = button.textContent; if (window.innerWidth <= 760) document.querySelector('aside').classList.add('collapsed'); if (button.dataset.page !== 'system') stopSystemPolling(); if (button.dataset.page === 'memory') loadMemory(); if (button.dataset.page === 'knowledge') loadKnowledge(); if (button.dataset.page === 'logs') loadLogs(); if (button.dataset.page === 'minecraft') loadMinecraft(); if (button.dataset.page === 'email') loadEmail(); if (button.dataset.page === 'research') loadResearch(); if (button.dataset.page === 'watch') loadWatch(); if (button.dataset.page === 'pc-control') loadPcControl(); if (button.dataset.page === 'bob') loadBob(); if (button.dataset.page === 'devices') loadDevices(); if (button.dataset.page === 'mac-screen') loadMacScreen(); if (button.dataset.page === 'system') { startSystemPolling(); loadWorker().then(loadCodingActions).catch(() => {}); } if (button.dataset.page === 'settings') loadVault(); if (button.dataset.page === 'safety') loadAlerts(); if (button.dataset.page === 'analytics') loadAnalytics(); if (button.dataset.page === 'automation') loadAutomation(); });
$('sidebarToggle')?.addEventListener('click', () => document.querySelector('aside').classList.toggle('collapsed'));
document.getElementById('runKnowledgeSearch')?.addEventListener('click', () => loadKnowledge().catch(error => { $('knowledgeList').textContent = error.message; }));
$('knowledgeFile')?.addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; const body = new FormData(); body.append('file', file); try { await fetch('/api/knowledge/upload', { method: 'POST', body }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`); return result; }); await loadKnowledge(); } catch (error) { $('knowledgeList').textContent = `Upload failed: ${error.message}`; } finally { event.target.value = ''; } });
$('knowledgeDrop')?.addEventListener('dragover', event => { event.preventDefault(); $('knowledgeDrop').classList.add('active'); });
$('knowledgeDrop')?.addEventListener('dragleave', () => $('knowledgeDrop').classList.remove('active'));
$('knowledgeDrop')?.addEventListener('drop', async event => { event.preventDefault(); $('knowledgeDrop').classList.remove('active'); const file = event.dataTransfer.files?.[0]; if (!file) return; const body = new FormData(); body.append('file', file); try { await fetch('/api/knowledge/upload', { method: 'POST', body }); await loadKnowledge(); } catch (error) { $('knowledgeList').textContent = `Upload failed: ${error.message}`; } });
function activateWorkspace(workspace) { localStorage.setItem('ella-workspace', workspace); document.querySelectorAll('.workspace-button').forEach(item => item.classList.toggle('active', item.dataset.workspace === workspace)); document.body.dataset.workspace = workspace.toLowerCase(); if ($('workspaceMode')) $('workspaceMode').value = workspace; const target = workspace === 'Operator' ? 'system' : workspace === 'Developer' ? 'analytics' : 'overview'; const nav = document.querySelector(`.nav[data-page="${target}"]`); if (nav) nav.click(); }
document.querySelectorAll('.workspace-button').forEach(button => button.onclick = () => activateWorkspace(button.dataset.workspace));
document.getElementById('codingTaskForm')?.addEventListener('submit', async event => { event.preventDefault(); const message = $('codingTaskMessage'); message.textContent = 'Submitting…'; try { const result = await api('/api/assistant/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `dashboard-${Date.now()}`, text: $('codingTaskDescription').value, workspace: $('codingTaskWorkspace').value, files: $('codingTaskFiles').value.split(',').map(value => value.trim()).filter(Boolean), requestedChanges: $('codingTaskChanges').value }) }); const data = result.data || result; message.textContent = data.result?.result?.reason || data.result?.result?.error || `Task ${data.result?.taskId || data.requestId || 'submitted'}: ${data.status || 'QUEUED'}`; await loadWorker(); await loadCodingActions(); } catch (error) { message.textContent = `Task submission failed: ${error.message}`; } });
document.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => { const action = button.dataset.action; if (['stop', 'restart', 'clear'].includes(action) && !confirm(`Confirm ${action} Ella?`)) return; try { await api(`/api/admin/actions/${action}`, { method: 'POST', body: '{}' }); } catch (e) { alert(e.message); } });
document.querySelectorAll('.save').forEach(button => button.onclick = async () => {
  const section = button.dataset.section; const payload = section === 'voice' ? { voice: { model: $('voiceModel').value, language: $('voiceLanguage').value, beamSize: Number($('beamSize').value), wakeWord: $('wakeWord').value, vad: $('vad').checked, wakeWordEnabled: $('wakeEnabled').checked, microphone: { device: $('microphoneDevice').value.trim() }, doubleClap: { enabled: $('doubleClapEnabled').checked, spikeRatio: Number($('clapSpikeRatio').value), minLevel: Number($('clapMinLevel').value), cooldownSeconds: Number($('clapCooldown').value), minGapSeconds: 0.05, maxGapSeconds: 0.35 } } } : section === 'brain' ? { brain: { model: $('brainModel').value, temperature: Number($('temperature').value), contextLength: Number($('contextLength').value), maxTokens: Number($('maxTokens').value), enabled: $('aiEnabled').checked } } : section === 'personality' ? { personality: { name: $('personalityName').value, tone: $('tone').value, speakingStyle: $('speakingStyle').value, personality: $('personalityText').value, systemInstructions: $('systemInstructions').value, rules: $('rules').value, customBehavior: $('customBehavior').value } } : { automaticMemory: $('automaticMemory').checked };
  try { const result = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) }); applyConfig(result.data); alert(result.restartRequired ? 'Saved. Restart required.' : 'Saved'); } catch (e) { alert(e.message); }
});
$('refreshPcControl')?.addEventListener('click', () => loadPcControl());
$('prepareFortnite')?.addEventListener('click', async () => {
  try { renderFortnitePrep({ state: 'STARTING', summary: 'Starting safe readiness checks...', steps: [] }); const result = await api('/api/pc/gaming/fortnite', { method: 'POST' }); renderFortnitePrep(result.data); }
  catch (error) { renderFortnitePrep({ state: 'FAILED', summary: error.message, steps: [] }); }
});
$('brainModel')?.addEventListener('change', async event => {
  const previous = config?.brain?.model || '';
  try {
    const result = await api('/api/admin/model', { method: 'POST', body: JSON.stringify({ model: event.target.value }) });
    if (config?.brain) config.brain.model = result.model;
    $('brainStatus').textContent = `Ollama: ONLINE | Active model: ${result.model} | Applied without restart`;
  } catch (error) {
    event.target.value = previous;
    $('brainStatus').textContent = `Model switch failed: ${error.message}. Keeping ${previous}.`;
  }
});
$('[data-bob-action="start"]')?.addEventListener('click', async () => { await api('/api/bob/start', { method: 'POST', body: '{}' }); loadBob(); });
$('[data-bob-action="stop"]')?.addEventListener('click', async () => { await api('/api/bob/stop', { method: 'POST', body: '{}' }); loadBob(); });
$('[data-bob-action="restart"]')?.addEventListener('click', async () => { await api('/api/bob/restart', { method: 'POST', body: '{}' }); loadBob(); });
$('bobCancel')?.addEventListener('click', async () => { await api('/api/bob/tasks/cancel', { method: 'POST', body: '{}' }); loadBob(); });
$('bobChatForm')?.addEventListener('submit', async event => { event.preventDefault(); const input = $('bobMessage'); const message = input.value.trim(); if (!message) return; input.value = ''; $('bobStatus').textContent = 'BOB THINKING'; try { await api('/api/bob/chat', { method: 'POST', body: JSON.stringify({ message, conversationId: 'default' }) }); await loadBob(); } catch (error) { $('bobStatus').textContent = `Bob chat unavailable: ${error.message}`; } });
$('bobTaskForm')?.addEventListener('submit', async event => { event.preventDefault(); $('bobStatus').textContent = 'BOB BUSY'; try { await api('/api/bob/tasks', { method: 'POST', body: JSON.stringify({ instruction: $('bobTask').value }) }); $('bobTask').value = ''; loadBob(); } catch (error) { $('bobStatus').textContent = error.message; } });
$('vaultForm')?.addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/vault', { method: 'POST', body: JSON.stringify({ id: $('vaultId').value, label: $('vaultLabel').value, value: $('vaultValue').value }) }); $('vaultValue').value = ''; $('vaultForm').reset(); loadVault(); } catch (error) { alert(error.message); } });
$('addDevice')?.addEventListener('click', () => openDeviceModal());
$('refreshDevices')?.addEventListener('click', () => loadDevices());
$('closeDeviceModal')?.addEventListener('click', closeDeviceModal);
$('cancelDeviceModal')?.addEventListener('click', closeDeviceModal);
$('deviceModal')?.addEventListener('click', event => { if (event.target === $('deviceModal')) closeDeviceModal(); });
$('deviceForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = devicePayload();
    const id = $('deviceId').value;
    await api(id ? `/api/devices/${encodeURIComponent(id)}` : '/api/devices', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    $('devicePassword').value = '';
    payload.password = undefined;
    closeDeviceModal();
    await loadDevices();
  } catch (error) { $('deviceFormError').textContent = error.message; }
});
$('refreshMacScreen')?.addEventListener('click', () => loadMacScreen());
$('closeMacScreen')?.addEventListener('click', () => { $('macScreenStatus').textContent = 'Mac screen panel closed.'; $('macScreenViewer').textContent = 'Open the existing authenticated viewer when needed.'; });
$('memorySearch').oninput = loadMemory; $('memoryCategory').onchange = loadMemory; $('memoryImportance').onchange = loadMemory; $('addMemory').onclick = async () => { const text = $('newMemory').value.trim(); if (!text) return; await api('/api/admin/memory', { method: 'POST', body: JSON.stringify({ text }) }); $('newMemory').value = ''; loadMemory(); }; $('clearMemory').onclick = async () => { if (confirm('Clear all memory?')) { await api('/api/admin/memory/clear', { method: 'POST', body: '{}' }); loadMemory(); } }; $('clearLogs').onclick = async () => { if (confirm('Clear logs?')) { await api('/api/admin/logs', { method: 'DELETE' }); logs = []; renderLogs(); } }; $('logSearch').oninput = renderLogs; $('runQuery').onclick = runQuery; $('queryBar').onkeydown = event => { if (event.key === 'Enter') runQuery(); }; $('loadAnalytics').onclick = loadAnalytics;
$('runHealthCheck')?.addEventListener('click', async () => { $('healthSummary').textContent = 'Running…'; try { await api('/api/health/check', { method: 'POST', body: '{}' }); await loadHealth(); } catch (error) { $('healthSummary').textContent = `Health check failed: ${error.message}`; } });
$('runEllaDiagnostic')?.addEventListener('click', async () => { $('diagnosticReport').textContent = 'Running full diagnostic…'; try { const result = await api('/api/diagnostics/why'); $('diagnosticReport').textContent = JSON.stringify(result.data, null, 2); } catch (error) { $('diagnosticReport').textContent = `Diagnostic failed: ${error.message}`; } });
$('researchForm')?.addEventListener('submit', async event => { event.preventDefault(); const query = $('researchQuery').value.trim(); if (!query) return; $('researchStatus').textContent = 'QUEUED'; try { const maxConcurrency = Number($('researchConcurrency')?.value || 4); await api('/api/research/config', { method: 'PUT', body: JSON.stringify({ maxConcurrency }) }); await api('/api/research/start', { method: 'POST', body: JSON.stringify({ query, maxConcurrency }) }); await loadResearch(); } catch (error) { $('researchStatus').textContent = `Research failed: ${error.message}`; } });
$('themeMode').onchange = event => { localStorage.setItem('ella-theme', event.target.value); applyPreferences(); }; $('workspaceMode').onchange = event => activateWorkspace(event.target.value); applyPreferences(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
$('addRule').onclick = async () => { const name = $('ruleName').value.trim(), condition = $('ruleCondition').value.trim(), triggerType = $('ruleTrigger').value; if (!name) return alert('Rule name is required.'); const trigger = triggerType === 'interval' ? { type: triggerType, intervalSeconds: Number($('ruleInterval').value) || 3600 } : { type: triggerType }; await api('/api/admin/automation', { method: 'POST', body: JSON.stringify({ name, condition, trigger, actions: [{ type: 'notify_ella', message: condition || name }] }) }); $('ruleName').value = ''; $('ruleCondition').value = ''; $('ruleInterval').value = ''; loadAutomation(); };
$('syncEmail').onclick = syncEmail; $('emailFilter').onchange = renderEmail; $('testEmailNotification').onclick = async () => { try { await api('/api/admin/email/test-notification', { method: 'POST', body: '{}' }); } catch (error) { alert(error.message); } }; $('clearEmailNotifications').onclick = async () => { if (confirm('Clear email notification history?')) { await api('/api/admin/email/notifications', { method: 'DELETE' }); loadEmail(); } }; $('connectGmail').onclick = () => { location.href = '/api/email/connect?provider=gmail'; }; $('connectOutlook').onclick = () => { location.href = '/api/email/connect?provider=outlook'; }; $('runChartCommand').onclick = applyChartCommand; $('chartCommand').onkeydown = event => { if (event.key === 'Enter') applyChartCommand(); }; $('telemetryChart').onclick = () => $('chartCommand').focus(); $('analyticsSource').onclick = () => showEvidence(chartSource || { source: 'server.js telemetryHistory', status: 'No chart loaded' }); $('querySource').onclick = () => showEvidence(querySourceData || { source: 'local telemetry history', status: 'Query not run' }); $('tldrSource').onclick = () => showEvidence(tldrSourceData || { source: 'currentOverview() and telemetryHistory', status: 'Summary not loaded' }); $('closeEvidence').onclick = () => $('evidencePanel').classList.remove('open');

let socket;
function connect() {
  if (location.protocol === 'https:') return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onopen = () => { $('connection').textContent = '● LIVE'; $('connection').classList.add('live'); socket.send(JSON.stringify({ type: 'CLIENT_HELLO', data: { clientType: 'admin-dashboard', ua: navigator.userAgent } })); };
  socket.onclose = () => { $('connection').textContent = '● OFFLINE'; $('connection').classList.remove('live'); setTimeout(connect, 1500); };
  socket.onmessage = event => { const msg = JSON.parse(event.data); if (msg.type === 'HELLO') logs = msg.data.activityLog || []; if (msg.type === 'ADMIN_OVERVIEW') renderOverview(msg.data); if (msg.type === 'MODEL_UPDATED') { loadOllamaModels(); api('/api/admin/overview').then(result => renderOverview(result.data)).catch(() => {}); } if (msg.type === 'SYSTEM_UPDATE') api('/api/admin/overview').then(result => renderOverview(result.data)).catch(() => {}); if (msg.type === 'ACTIVITY_EVENT') addEvent(msg.data); if (msg.type === 'FORTNITE_PREP_STATUS') renderFortnitePrep(msg.data); if (msg.type === 'EMAIL_NOTIFICATION') loadEmail(); if (msg.type === 'WORKER_TASK_UPDATE' || msg.type === 'WORKER_STATUS') loadWorker().catch(() => {}); if (msg.type === 'RESEARCH_PROGRESS' || msg.type === 'RESEARCH_EVENT' || msg.type === 'RESEARCH_STARTED') { addEvent({ kind: 'research', message: msg.data?.message || msg.data?.currentActivity || msg.type, time: msg.data?.timestamp || '' }); if ($('research')?.classList.contains('active')) loadResearch().catch(() => {}); } if (msg.type === 'WATCH_COMMAND_RECEIVED' || msg.type === 'WATCH_COMMAND_STARTED' || msg.type === 'WATCH_COMMAND_COMPLETED' || msg.type === 'WATCH_COMMAND_FAILED') loadWatch().catch(() => {}); if (msg.type === 'VOICE_TRANSCRIPT') { if (msg.data.from === 'user') $('transcript').textContent = msg.data.text; else $('response').textContent = msg.data.text; } if (msg.type === 'AI_STATE') { $('state').textContent = String(msg.data.state).toUpperCase(); $('ellaOrb').className = `orb ${String(msg.data.state).toLowerCase()}`; } };
}
async function load() {
  const [overviewResult, configResult, activityResult] = await Promise.allSettled([
    api('/api/admin/overview'),
    api('/api/admin/config'),
    api('/api/activity')
  ]);
  if (overviewResult.status === 'rejected') {
    markOffline(overviewResult.reason?.message || 'Ella bridge is unavailable.');
    throw overviewResult.reason;
  }
  renderOverview(overviewResult.value.data);
  if (configResult.status === 'fulfilled') applyConfig(configResult.value.data);
  if (activityResult.status === 'fulfilled') {
    logs = activityResult.value;
    $('activity').innerHTML = logs.slice(0, 60).map(e => `<div class="event"><b>${esc(e.kind || 'event')}</b>${esc(e.time || '')}<br>${esc(e.message || '')}</div>`).join('');
    const research = logs.filter(item => /research/i.test(`${item.kind || ''} ${item.message || ''}`)).slice(0, 5);
    if ($('researchActivity')) $('researchActivity').innerHTML = research.length ? research.map(item => `<div class="event"><b>${esc(item.kind || 'RESEARCH')}</b><br>${esc(item.message || '')}</div>`).join('') : '<span class="unavailable">No research activity.</span>';
    renderLogs();
  }
  if (location.protocol === 'https:' && $('connection')) {
    $('connection').textContent = '● LIVE · POLLING';
    $('connection').classList.add('live');
  }
  loadOllamaModels().catch(() => {});
  loadTldr().catch(() => {});
  loadWorker().catch(() => {});
  loadHealth().catch(() => {});
}
load().catch(error => { $('connection').textContent = `● ERROR: ${error.message}`; }); connect();
setInterval(() => load().catch(error => { $('connection').textContent = `● OFFLINE: ${error.message}`; }), 15000);
