const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.ELLA_PORT || 3001;
const app = express();
app.use(express.json());

app.all('/chat', async (req, res) => {
  try {
    console.log('[chat] incoming', req.method, req.path);
    try { console.log('[chat] body:', JSON.stringify(req.body)); } catch (e) { }
    try { fs.appendFileSync(path.join(__dirname, 'chat_requests.log'), JSON.stringify({ ts: Date.now(), method: req.method, path: req.path, body: req.body }) + '\n'); } catch (e) { }

    const body = req.body || {};
    const player = body.player_name || 'someone';
    const message = (body.message || '').toString();
    if (!message) return res.json({ reply: `Hey ${player}, hi!` });

    // Try Ollama CLI first (preferred because local CLI is more reliable in Windows environments)
    try {
      const modelCli = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
      const systemInstruction = 'You are Ella. Speak in a calm, measured, and professional tone. Answer the user directly and concisely.';
      const fullPrompt = `${systemInstruction}\n\nPlayer ${player} asked: ${message}`;
      const args = ['run', modelCli, fullPrompt, '--hidethinking', '--nowordwrap'];
      const child = spawn('ollama', args, { windowsHide: true });
      let out = '';
      let errOut = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', (c) => out += c);
      child.stderr.setEncoding('utf8'); child.stderr.on('data', (c) => errOut += c);

      const exitCode = await new Promise((resolve) => { child.on('close', resolve); setTimeout(() => { try { child.kill(); } catch(e){} }, 20000); });
      if (exitCode === 0 && out) {
        const cleaned = String(out || '').trim();
        return res.json({ reply: cleaned });
      } else {
        console.error('[chat] Ollama CLI failed', exitCode, errOut.slice(0,1000));
        // fallback to echo
        return res.json({ reply: `Hey ${player}, you asked: ${message}` });
      }
    } catch (cliErr) {
      console.error('[chat] Ollama CLI attempt failed', cliErr);
      return res.json({ reply: `Hey ${player}, you asked: ${message}` });
    }
  } catch (e) {
    console.error('chat endpoint error', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Minimal Ella chat adapter listening on port ${PORT}`);
});
