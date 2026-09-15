require("dotenv").config();

const express = require("express");
const cors = require("cors");
const os = require('os');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

async function mondayRequest(query, variables = {}) {
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: process.env.MONDAY_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  return response.json();
}

app.post("/api/monday", async (req, res) => {
  try {
    res.json(await mondayRequest(req.body.query, req.body.variables));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/monday/tasks", async (req, res) => {
  try {
    const result = await mondayRequest(`
      query {
        boards(ids: ${process.env.MONDAY_BOARD_ID}) {
          items_page(limit: 50) {
            items {
              id
              name
              column_values(ids: ["task_status", "task_priority"]) {
                id
                text
              }
            }
          }
        }
      }
    `);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to compute CPU usage over a short sample
function cpuPercentSync(sampleMs = 200) {
  const start = os.cpus();
  const startTime = Date.now();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return wait(sampleMs).then(() => {
    const end = os.cpus();
    const totalDiffs = end.map((cpu, idx) => {
      const s = start[idx].times;
      const e = cpu.times;
      const idle = e.idle - s.idle;
      const total = Object.keys(e).reduce((acc, k) => acc + (e[k] - s[k]), 0);
      const busy = total - idle;
      return { idle, total, busy };
    });
    const totalIdle = totalDiffs.reduce((acc, cur) => acc + cur.idle, 0);
    const totalTotal = totalDiffs.reduce((acc, cur) => acc + cur.total, 0);
    const busy = totalTotal - totalIdle;
    const pct = totalTotal > 0 ? Math.round((busy / totalTotal) * 100) : 0;
    return pct;
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getDiskInfo() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('wmic logicaldisk get Caption,FreeSpace,Size /format:csv', (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const disks = [];
        for (const line of lines.slice(1)) {
          // CSV: Node,Caption,FreeSpace,Size
          const parts = line.split(',');
          if (parts.length < 4) continue;
          const caption = parts[1];
          const free = parseInt(parts[2] || '0', 10);
          const size = parseInt(parts[3] || '0', 10);
          if (!size) continue;
          disks.push({ mount: caption, total: size, free, used: size - free, usedPercent: Math.round(((size - free) / size) * 100) });
        }
        resolve(disks);
      });
    } else {
      exec('df -kP', (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split(/\r?\n/).slice(1);
        const disks = lines.map((l) => {
          const parts = l.replace(/\s+/g, ' ').split(' ');
          const total = parseInt(parts[1], 10) * 1024;
          const used = parseInt(parts[2], 10) * 1024;
          const free = parseInt(parts[3], 10) * 1024;
          const mount = parts[5];
          return { mount, total, free, used, usedPercent: Math.round((used / total) * 100) };
        });
        resolve(disks);
      });
    }
  });
}

app.get('/api/metrics', async (req, res) => {
  try {
    const cpu = await cpuPercentSync(200);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPct = Math.round((usedMem / totalMem) * 100);
    const uptime = os.uptime();
    const disks = await getDiskInfo();

    res.json({
      cpuPercent: cpu,
      memory: { total: totalMem, free: freeMem, used: usedMem, usedPercent: memPct },
      uptime,
      disks,
      hostname: os.hostname(),
      platform: process.platform,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Extended metrics: processes, network interfaces, GPU info
function getNetworkInfo() {
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach((name) => {
    nets[name].forEach((iface) => {
      out.push({ name, address: iface.address, family: iface.family, mac: iface.mac, internal: iface.internal });
    });
  });
  return out;
}

function getProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('wmic process get ProcessId,Name,WorkingSetSize,CommandLine /format:csv', (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const procs = [];
        for (const line of lines.slice(1)) {
          const parts = line.split(',');
          if (parts.length < 4) continue;
          const name = parts[1];
          const cmd = parts[2];
          const pid = parseInt(parts[3], 10) || 0;
          procs.push({ pid, name, cmd });
        }
        resolve(procs.slice(0, 400));
      });
    } else {
      exec('ps -eo pid,comm,pcpu,pmem --no-headers', (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split(/\n/).filter(Boolean);
        const procs = lines.map((l) => {
          const parts = l.trim().split(/\s+/, 4);
          return { pid: parseInt(parts[0], 10), name: parts[1], cpu: parts[2], mem: parts[3] };
        });
        resolve(procs.slice(0, 400));
      });
    }    

function getGpuInfo() {
  return new Promise((resolve) => {
    // Try nvidia-smi first
    exec('nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits', (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const lines = stdout.trim().split(/\r?\n/);
        const gpus = lines.map((l) => {
          const parts = l.split(',').map(p => p.trim());
          return { name: parts[0], util: parts[1] + '%', memTotal: parts[2] + ' MiB', memUsed: parts[3] + ' MiB' };
        });
        return resolve(gpus);
      }
      // Fallback to wmic on Windows
      if (process.platform === 'win32') {
        exec('wmic path win32_VideoController get name /format:csv', (err2, out2) => {
          if (err2 || !out2) return resolve([]);
          const lines = out2.trim().split(/\r?\n/).filter(Boolean).slice(1);
          return resolve(lines.map(l => ({ name: l.split(',')[1] })));
        });
      } else {
        resolve([]);
      }
    });
  });
}

app.get('/api/extended-metrics', async (req, res) => {
  try {
    const [procs, nets, gpus] = await Promise.all([getProcesses(), Promise.resolve(getNetworkInfo()), getGpuInfo()]);
    res.json({ processes: procs, network: nets, gpus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Kill a process by PID (requires server to have permission)
app.post('/api/kill', (req, res) => {
  const pid = parseInt(req.body && req.body.pid, 10);
  if (!pid) return res.status(400).json({ error: 'missing pid' });
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /F`, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      });
    } else {
      process.kill(pid, 'SIGKILL');
      res.json({ ok: true });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }  
});

// Safe exec endpoint — only allow whitelisted actions (start-ella for now)
const COMMAND_WHITELIST = {
  'start-ella': { cmd: 'cmd.exe', args: ['/c', 'start', '""', 'start-ella.cmd'] },
};

const fsPromises = require('fs').promises;

app.post('/api/exec', (req, res) => {
  const action = String(req.body && req.body.action || '');
  if (!COMMAND_WHITELIST[action]) return res.status(400).json({ error: 'unknown action' });
  const entry = COMMAND_WHITELIST[action];
  try {
    const child = exec(`${entry.cmd} ${entry.args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' ')}`, { cwd: process.cwd() }, (err) => {
      if (err) console.error('exec error', err && err.message);
    });
    // detached style isn't necessary for cmd start — it will start detached
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Speak text on the PC using Windows SAPI via PowerShell (safe, local only)
app.post('/api/speak', async (req, res) => {
  try {
    const text = String(req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'missing text' });
    // create a small temporary PowerShell script that decodes base64 text and speaks it
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const scriptName = `ella-speak-${Date.now()}.ps1`;
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      `$bytes = [System.Convert]::FromBase64String("${b64}")`,
      '$text = [System.Text.Encoding]::UTF8.GetString($bytes)',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$synth.Rate = -2`,
      '$synth.Volume = 95',
      '$synth.Speak($text)',
      '$synth.Dispose()'
    ].join('\r\n');

    await fsPromises.writeFile(scriptName, ps, 'utf8');
    exec(`powershell.exe -NoProfile -NonInteractive -File ${scriptName}`, (err) => {
      fsPromises.unlink(scriptName).catch(()=>{});
      if (err) {
        console.error('speak error', err);
        return res.status(500).json({ error: err.message });
      }
      return res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => {
  console.log('Ella monday server: http://localhost:3001');
});