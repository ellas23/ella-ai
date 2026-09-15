const canvas = document.getElementById('orbCanvas');
const ctx = canvas.getContext('2d');
const stateLabel = document.getElementById('stateLabel');
const transcriptEl = document.getElementById('transcript');
const camPreview = document.getElementById('camPreview');
const configBadge = document.getElementById('configBadge');
const stageEl = document.getElementById('stage');

function resizeCanvas() {
  const rect = stageEl.getBoundingClientRect();
  // set canvas pixel size to element size
  canvas.width = Math.max(64, Math.floor(rect.width));
  canvas.height = Math.max(64, Math.floor(rect.height));
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);


// ================= WebSocket to backend =================
let ws;
let wsReady = false;
function connectWS() {
  ws = new WebSocket(ELLA_BACKEND_WS);
  ws.onopen = () => {
    wsReady = true; configBadge.textContent = 'linked · ' + ELLA_BACKEND_WS;
    // announce ourselves to the server so it can show client metadata
    try { ws.send(JSON.stringify({ type: 'CLIENT_HELLO', data: { clientType: 'orb', ua: navigator.userAgent || '', info: { width: canvas.width, height: canvas.height } } })); } catch (e) {}
  };
  ws.onclose = () => { wsReady = false; configBadge.textContent = 'reconnecting...'; setTimeout(connectWS, 1500); };
  ws.onerror = () => {};
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'HELLO') setState(msg.data.aiState);
  };
}
connectWS();
function send(type, data) { if (wsReady) ws.send(JSON.stringify({ type, data })); }

// ================= state machine =================
let state = 'idle'; // idle | listening | processing | speaking | executing
const LABELS = { idle: 'STANDBY', listening: 'LISTENING', processing: 'PROCESSING', speaking: 'SPEAKING', executing: 'EXECUTING' };
function setState(s) {
  state = s;
  stateLabel.textContent = LABELS[s] || s.toUpperCase();
  send('AI_STATE', { state: s });
  // visual behavior: when not idle, expand the orb to the center (awake)
  try { stageEl.classList.toggle('awake', s !== 'idle'); resizeCanvas(); } catch (e) {}
}

// ================= audio reactivity (real mic amplitude, not a fake loop) =================
let audioLevel = 0; // 0..1, smoothed
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255; // 0..1
      audioLevel += (avg - audioLevel) * 0.25; // smoothing
      requestAnimationFrame(tick);
    }
    tick();
  } catch (err) {
    console.warn('Mic unavailable, orb will idle-pulse only:', err);
  }
}
initAudio();

// ================= orb rendering =================
let t = 0;
let particles = Array.from({ length: 40 }, () => ({ a: Math.random() * Math.PI * 2, r: 80 + Math.random() * 120, speed: 0.002 + Math.random() * 0.004 }));

function draw() {
  const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  t += 0.01 + audioLevel * 0.05; // rotation speed scales with voice volume

  const pulse = 90 + audioLevel * 60 + Math.sin(t * 2) * 6; // orb size reacts to volume
  const glow = 0.25 + audioLevel * 0.6;

  // outer rings
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(65,201,240,${0.12 + audioLevel * 0.2})`;
    ctx.lineWidth = 1;
    ctx.arc(cx, cy, pulse + 40 + i * 26, t * (0.3 + i * 0.15), t * (0.3 + i * 0.15) + Math.PI * 1.4);
    ctx.stroke();
  }

  // particles
  for (const p of particles) {
    p.a += p.speed + audioLevel * 0.01;
    const px = cx + Math.cos(p.a) * (p.r + audioLevel * 30);
    const py = cy + Math.sin(p.a) * (p.r + audioLevel * 30);
    ctx.beginPath();
    ctx.fillStyle = `rgba(139,123,247,${0.3 + audioLevel * 0.4})`;
    ctx.arc(px, py, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // core glow
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse);
  coreGrad.addColorStop(0, `rgba(139,123,247,${glow})`);
  coreGrad.addColorStop(0.5, `rgba(65,201,240,${glow * 0.5})`);
  coreGrad.addColorStop(1, 'rgba(65,201,240,0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath(); ctx.arc(cx, cy, pulse, 0, Math.PI * 2); ctx.fill();

  // solid center
  ctx.beginPath();
  ctx.fillStyle = '#0b0e18';
  ctx.arc(cx, cy, pulse * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(207,233,255,${0.4 + audioLevel * 0.4})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  requestAnimationFrame(draw);
}
draw();

// ================= voice: wake word + command capture + response =================
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let awake = false;
function startVoiceLoop() {
  if (!SpeechRec) {
    stateLabel.textContent = 'MIC UNAVAILABLE';
    // Provide a manual text input fallback so you can type commands when the browser lacks SpeechRecognition
    const existing = document.getElementById('manualStt');
    if (!existing) {
      const box = document.createElement('div');
      box.id = 'manualStt';
      box.style.position = 'absolute';
      box.style.bottom = '6%';
      box.style.left = '50%';
      box.style.transform = 'translateX(-50%)';
      box.style.zIndex = 50;
      box.innerHTML = `
        <input id="manualInput" placeholder="Type voice command and press Send" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);width:420px;background:rgba(0,0,0,0.3);color:#cfe9ff;font-family:monospace;" />
        <button id="manualSend" style="margin-left:8px;padding:8px 10px;border-radius:8px;border:none;background:#59e6a0;color:#041018;">Send</button>
      `;
      document.getElementById('stage').appendChild(box);
      document.getElementById('manualSend').addEventListener('click', () => {
        const t = document.getElementById('manualInput').value.trim();
        if (!t) return;
        // mimic the same flow as the speech recognition final result
        send('VOICE_TRANSCRIPT', { from: 'user', text: t });
        setState('processing');
        // emulate a small assistant reply for local testing
        setTimeout(() => { const reply = `Got it: ${t}`; setState('speaking'); showTranscript(reply); send('VOICE_TRANSCRIPT', { from: 'ella', text: reply }); speak(reply, () => { setState('idle'); setTimeout(() => showTranscript(''), 1500); }); }, 600);
      });
    }
    return;
  }
  const rec = new SpeechRec();
  rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    const text = res[0].transcript.trim().toLowerCase();
    if (!awake) {
      if (text.includes('hey ella')) { awake = true; setState('listening'); showTranscript(''); }
      return;
    }
    showTranscript(text);
    if (res.isFinal) {
      send('VOICE_TRANSCRIPT', { from: 'user', text });
      setState('processing');
      // ---- Hook your actual AI/intent pipeline here ----
      // Replace this stub with a real call to your backend's command handler.
      setTimeout(() => {
        const reply = `Got it: ${text}`;
        setState('speaking');
        showTranscript(reply);
        send('VOICE_TRANSCRIPT', { from: 'ella', text: reply });
        speak(reply, () => { setState('idle'); awake = false; setTimeout(() => showTranscript(''), 1500); });
      }, 700);
    }
  };
  rec.onerror = () => setTimeout(startVoiceLoop, 1200);
  rec.onend = () => setTimeout(startVoiceLoop, 250);
  rec.start();
}
function showTranscript(text) {
  transcriptEl.textContent = text ? `"${text}"` : '';
  transcriptEl.classList.toggle('show', !!text);
}
function speak(text, onDone) {
  const u = new SpeechSynthesisUtterance(text);
  u.onend = onDone;
  speechSynthesis.speak(u);
}
startVoiceLoop();

// ================= gesture: pinch-and-pull sends GESTURE_ZOOM to backend =================
let pinchActive = false, lastHandSize = null, pinchCount = 0, pinchTimer = null;
let lastAngle = null; // for rotation detection
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
async function initGestures() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    camPreview.srcObject = stream;
  } catch (err) { console.warn('Camera unavailable, gesture control disabled:', err); return; }

  const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
  hands.onResults((results) => {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) { pinchActive = false; lastHandSize = null; lastAngle = null; return; }
    const lm = results.multiHandLandmarks[0];
    const pinchDist = dist(lm[4], lm[8]);
    const handSize = dist(lm[0], lm[9]);
    const isPinching = pinchDist < 0.045;

    // rotation detection: angle between wrist->index and wrist->middle
    const v1 = { x: lm[5].x - lm[0].x, y: lm[5].y - lm[0].y };
    const v2 = { x: lm[9].x - lm[0].x, y: lm[9].y - lm[0].y };
    const angle = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
    if (lastAngle != null) {
      let delta = angle - lastAngle;
      // normalize to [-PI,PI]
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > 0.12) {
        // emit rotate gesture with sign and magnitude
        send('GESTURE_ROTATE', { delta });
      }
    }
    lastAngle = angle;

    if (isPinching && !pinchActive) { pinchActive = true; lastHandSize = handSize; }
    else if (isPinching && pinchActive && lastHandSize != null) {
      if (handSize - lastHandSize > 0.05) {
        // detected a pinch-pull motion — treat as a zoom gesture
        pinchCount += 1;
        // send stage info: first pinch -> stage 1, second within short window -> stage 2
        const stage = pinchCount >= 2 ? 2 : 1;
        send('GESTURE_ZOOM', { stage });
        // reset timer; if no second pinch within 1.2s, reset count
        if (pinchTimer) clearTimeout(pinchTimer);
        pinchTimer = setTimeout(() => { pinchCount = 0; pinchTimer = null; }, 1200);
        pinchActive = false;
      }
    } else if (!isPinching) { pinchActive = false; lastHandSize = null; }
  });
  const camera = new Camera(camPreview, { onFrame: async () => { await hands.send({ image: camPreview }); }, width: 320, height: 240 });
  camera.start();
}
initGestures();
