import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  BrainCircuit,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Waves,
} from 'lucide-react';
import MondayTasks from './MondayTasks';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

const storageKeys = {
  messages: 'ella-chat-messages',
  memory: 'ella-memory',
  logs: 'ella-debug-logs',
  shortcuts: 'ella-shortcuts',
  phone: 'ella-phone-number',
  shortcutName: 'ella-shortcut-name',
  selectedVoice: 'ella-selected-voice',
  commandCatalog: 'ella-command-catalog',
};

const defaultMessages = [
  { id: 1, role: 'assistant', text: 'Welcome back. I remember what you said, and I can help with notes, texts, and next steps.' },
  { id: 2, role: 'user', text: 'Can you help me plan my day?' },
  { id: 3, role: 'assistant', text: 'Absolutely. Start with your most important task, then keep the rest simple and calm.' },
];

const defaultShortcuts = [
  { id: 1, label: 'Check in', action: 'Can you send a quick check-in text?' },
  { id: 2, label: 'Plan day', action: 'What should I do first today?' },
  { id: 3, label: 'Note memory', action: 'Remember that my priority is my family time.' },
];

const defaultCommandCatalog = [
  {
    id: 'skyhack',
    name: 'SkyHack',
    connected: true,
    commands: ['launch', 'status', 'scan'],
    prompts: ['Ella use SkyHack', 'Ella open SkyHack', 'Ella launch SkyHack'],
  },
  {
    id: 'monday',
    name: 'Monday',
    connected: false,
    commands: ['open board', 'list tasks', 'create update'],
    prompts: ['Ella connect Monday', 'Ella open Monday', 'Ella show my Monday tasks'],
  },
  {
    id: 'google',
    name: 'Google',
    connected: false,
    commands: ['open Gmail', 'search', 'calendar'],
    prompts: ['Ella open Google', 'Ella check Google Mail', 'Ella search Google for meeting notes'],
  },
  {
    id: 'airtouch',
    name: 'AirTouch',
    connected: false,
    commands: ['connect device', 'status check', 'power control'],
    prompts: ['Ella connect AirTouch', 'Ella check AirTouch', 'Ella open AirTouch'],
  },
  {
    id: 'passgan',
    name: 'PassGAN',
    connected: true,
    commands: ['start model', 'prepare dataset', 'run generation'],
    prompts: ['Ella launch PassGAN', 'Ella use PassGAN', 'Ella start PassGAN model'],
  },
  {
    id: 'bruteforceai',
    name: 'BruteForceAI',
    connected: true,
    commands: ['run tester', 'analyze hash', 'check login'],
    prompts: ['Ella use BruteForceAI', 'Ella connect BruteForceAI', 'Ella open BruteForceAI'],
  },
  {
    id: 'hacktho',
    name: 'Hacktho / Hashtopolis',
    connected: true,
    commands: ['sync worker', 'run task', 'check queue'],
    prompts: ['Ella use Hacktho', 'Ella launch Hacktho', 'Ella open Hashtopolis'],
  },
];

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const OLLAMA_API_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OLLAMA_MODEL) || 'qwen2.5:14b';

const buildReply = (text, memory) => {
  const lower = text.toLowerCase();
  const recent = memory.slice(-3).map((item) => item.text).join(' ');

  if (lower.includes('text') || lower.includes('sms') || lower.includes('message')) {
    return 'I can draft a text for you and open your phone messaging app with the message ready.';
  }

  if (lower.includes('plan') || lower.includes('today') || lower.includes('schedule')) {
    return 'Start with your most important task, then pick one follow-up item. Keep the rest light and flexible.';
  }

  if (lower.includes('remember')) {
    return 'I will remember that and keep it in our memory for future replies.';
  }

  if (recent && (lower.includes('family') || lower.includes('work') || lower.includes('health') || lower.includes('trip'))) {
    return `I remember we were talking about ${recent}. I can help keep that in focus and guide the next step.`;
  }

  if (lower.includes('hello') || lower.includes('hi')) {
    return 'Hello. I am ready to help with short answers, texts, planning, and daily tasks.';
  }

  if (lower.includes('weather')) {
    return 'I can help you check the weather, but for live conditions I would need a weather service connected to the app.';
  }

  if (lower.includes('who are you') || lower.includes('what are you')) {
    return 'I am Ella, your local assistant. I can chat, keep context, open texts, and help you plan your day.';
  }

  return 'I understand. I can keep it simple, clear, and useful while remembering what we discussed earlier.';
};

const getOllamaReply = async (text, memory) => {
  const recentMemory = memory.slice(-6).map((item) => item.text).filter(Boolean);

  try {
    const response = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'You are Ella, a helpful personal assistant. Keep answers short, warm, and practical. If asked for tasks or planning, be concise and prioritized. Use the recent conversation memory when relevant.',
          },
          ...(recentMemory.length ? [{ role: 'user', content: `Recent memory: ${recentMemory.join(' | ')}` }] : []),
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.message?.content || data?.content || '';
    return content.trim() || null;
  } catch (error) {
    return null;
  }
};

const speakText = (text, voiceName = null) => {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.15;
  utterance.volume = 1;
  utterance.lang = 'en-US';

  if (voiceName) {
    const v = (window.speechSynthesis.getVoices() || []).find((x) => x.name === voiceName);
    if (v) utterance.voice = v;
  }

  window.speechSynthesis.speak(utterance);
};

function App() {
  const [messages, setMessages] = useState(() => readStorage(storageKeys.messages, defaultMessages));
  const [memory, setMemory] = useState(() => readStorage(storageKeys.memory, []));
  const [shortcuts, setShortcuts] = useState(() => readStorage(storageKeys.shortcuts, defaultShortcuts));
  const [logs, setLogs] = useState(() => readStorage(storageKeys.logs, [{ id: 1, level: 'info', message: 'Ella control hub ready', timestamp: new Date().toLocaleTimeString() }]));
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState(() => readStorage(storageKeys.phone, '+15551234567'));
  const [shortcutDraft, setShortcutDraft] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('Ready');
  const [isVoiceOn, setIsVoiceOn] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(() => readStorage(storageKeys.selectedVoice, null));
  const [selectedTab, setSelectedTab] = useState('dashboard');
  const [commandCatalog, setCommandCatalog] = useState(() => readStorage(storageKeys.commandCatalog, defaultCommandCatalog));
  const [hudOpen, setHudOpen] = useState(true);
  const [smallMenuOpen, setSmallMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState({ cpuPercent: 0, memory: { total: 0, free: 0, used: 0, usedPercent: 0 }, uptime: 0, disks: [] });
  const [extended, setExtended] = useState({ processes: [], network: [], gpus: [] });
  const [hudListening, setHudListening] = useState(false);
  const [hudStatus, setHudStatus] = useState('IDLE');
  // Track Ollama connection status so the chat knows whether to attempt LLM calls
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const pendingPromptQueueRef = useRef([]);
  const processingPromptRef = useRef(false);
  const memoryRef = useRef(memory);

  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);
   
  // Expose connection status via logs
  const updateOllamaStatus = (connected) => {
    setOllamaConnected(connected);
    addLog(`Ollama ${connected ? 'reachable' : 'unreachable'}`, connected ? 'success' : 'warn');
  };
  const terminalRef = useRef(null);
  const recognitionRef = useRef(null);

  const addLog = (message, level = 'info') => {
    const entry = {
      id: Date.now() + Math.random(),
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
    };
    setLogs((prev) => [...prev.slice(-24), entry]);
  };

  useEffect(() => {
    localStorage.setItem(storageKeys.messages, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(storageKeys.memory, JSON.stringify(memory));
  }, [memory]);

  useEffect(() => {
    localStorage.setItem(storageKeys.shortcuts, JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    localStorage.setItem(storageKeys.logs, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(storageKeys.phone, phone);
  }, [phone]);

  useEffect(() => {
    localStorage.setItem(storageKeys.selectedVoice, selectedVoice);
  }, [selectedVoice]);

  // Poll system metrics when admin tab is visible and fetch extended metrics
  useEffect(() => {
    let id = null;
    let extId = null;
    let stopped = false;
    async function fetchMetrics() {
      try {
        const res = await fetch('http://192.168.1.207:3001/api/metrics');
        if (res.ok) {
          const data = await res.json();
          if (!stopped) setMetrics(data);
        }
      } catch (e) {
        // ignore
      }
    }
    async function fetchExtended() {
      try {
        const res = await fetch('http://192.168.1.207:3001/api/extended-metrics');
        if (res.ok) {
          const data = await res.json();
          if (!stopped) setExtended(data);
        }
      } catch (e) {
        // ignore
      }
    }
    if (selectedTab === 'admin') {
      fetchMetrics(); fetchExtended();
      id = setInterval(fetchMetrics, 2500);
      extId = setInterval(fetchExtended, 5000);
    }
    return () => { stopped = true; if (id) clearInterval(id); if (extId) clearInterval(extId); };
  }, [selectedTab]);

  // Periodically check if Ollama is reachable so chat shows a connected state and uses it when available
  useEffect(() => {
    let id = null;
    let stopped = false;
    async function pingOllama() {
      try {
        const res = await fetch(OLLAMA_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: [{ role: 'system', content: 'ping' }] }),
        });
        if (!stopped) updateOllamaStatus(res.ok);
      } catch (e) {
        if (!stopped) updateOllamaStatus(false);
      }
    }
    // start immediately and poll every 5s
    pingOllama();
    id = setInterval(pingOllama, 5000);
    return () => { stopped = true; if (id) clearInterval(id); };
  }, []);


  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis?.getVoices?.() || [];
      setVoices(v);
      if (!selectedVoice) {
        const female = v.find((x) => /female|zira|samantha|alloy|aria/i.test(x.name));
        if (female) setSelectedVoice(female.name);
        else if (v[0]) setSelectedVoice(v[0].name);
      }
    };

    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    addLog('System booted and chat memory loaded.', 'info');

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      rows: 16,
      cols: 80,
      theme: {
        background: '#0b1220',
        foreground: '#dfeafc',
        cursor: '#7dd3fc',
      },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    term.write('Ella terminal ready\r\n');
    term.write('$ system status\r\n');
    term.write('Voice: ready\r\n');
    term.write('Memory: ' + memory.length + ' items\r\n');
    term.write('Shortcuts: ' + shortcuts.length + ' ready\r\n');
    term.write('$ ');

    let buffer = '';
    const handleCommand = () => {
      const command = buffer.trim();
      if (!command) {
        term.write('\r\n$ ');
        buffer = '';
        return;
      }

      if (command === 'help') {
        term.write('help\r\nstatus\r\nclear\r\nshortcuts\r\n$ ');
      } else if (command === 'status') {
        term.write('Voice ready\r\nMemory loaded\r\nSMS ready\r\n$ ');
      } else if (command === 'shortcuts') {
        term.write(shortcuts.map((s) => s.label).join(', ') + '\r\n$ ');
      } else if (command === 'clear') {
        term.clear();
        term.write('$ ');
      } else {
        term.write('Command not found. Try help\r\n$ ');
      }

      buffer = '';
    };

    term.onData((data) => {
      if (data === '\r' || data === '\n') {
        handleCommand();
      } else if (data === '\u007f') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          term.write('\b \b');
        }
      } else {
        buffer += data;
        term.write(data);
      }
    });

    return () => {
      term.dispose();
    };
  }, [memory.length, shortcuts.length]);

  const sendMessage = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;

    pendingPromptQueueRef.current.push(text);
    if (processingPromptRef.current) return;

    processingPromptRef.current = true;
    setIsThinking(true);
    setHudStatus('THINKING');

    try {
      while (pendingPromptQueueRef.current.length > 0) {
        const nextText = pendingPromptQueueRef.current.shift();
        if (!nextText) continue;

        const userMessage = { id: Date.now() + Math.random(), role: 'user', text: nextText };
        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        addLog(`User message received: ${nextText}`, 'info');

        const workingMemory = [...memoryRef.current.slice(-6), { id: Date.now() + 1, text: nextText }];
        memoryRef.current = workingMemory;
        setMemory(workingMemory);

        // Quick action: open Google / open tab requests are handled locally by calling the backend open endpoint
                const lowerNext = (nextText || '').toLowerCase();
                const openGoogleMatch = nextText.match(/search (?:google )?for (.+)/i) || nextText.match(/search google for (.+)/i) || nextText.match(/google search for (.+)/i);
                // host cleanup / game prep phrases
                if (/(close (everything|all)|close (my )?(tabs|apps)|clean ?up (for )?fortnite|prepare for fortnite|game ?mode|close .* for fortnite)/i.test(nextText) || lowerNext.includes('cleanup') || lowerNext.includes('prepare for fortnite')) {
                  try {
                    await fetch('/api/host/stop-all', { method: 'POST' });
                    const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: `Closing unneeded apps and pausing Ella for gaming.` };
                    setMessages((prev) => [...prev, assistantMessage]);
                    addLog('Requested host stop-all (game cleanup)', 'info');
                    speakText('Closing unneeded apps and pausing until you say resume', selectedVoice);
                    continue;
                  } catch (e) {
                    addLog('Failed to request host stop-all: ' + e, 'warn');
                  }
                }

                // lock workstation phrases
                if (/\bella\b.*\block\b|\block\b.*\bella\b|^lock (my )?pc$/i.test(nextText) || lowerNext.includes('ella lock') || lowerNext.trim() === 'lock') {
                  try {
                    await fetch('/api/host/lock', { method: 'POST' });
                    const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: `Locking your PC now.` };
                    setMessages((prev) => [...prev, assistantMessage]);
                    addLog('Requested host lock', 'info');
                    speakText('Locking your PC', selectedVoice);
                    continue;
                  } catch (e) {
                    addLog('Failed to request host lock: ' + e, 'warn');
                  }
                }

                // resume / start phrases (undo the cleanup)
                if (/\b(resume|start (ella|all)|open (ela|ella)|bring back|restart ella)\b/i.test(nextText) || lowerNext.includes('resume') || lowerNext.includes('start ella')) {
                  try {
                    await fetch('/api/host/start-all', { method: 'POST' });
                    const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: `Starting Ella and restoring apps.` };
                    setMessages((prev) => [...prev, assistantMessage]);
                    addLog('Requested host start-all', 'info');
                    speakText('Starting Ella and restoring your apps', selectedVoice);
                    continue;
                  } catch (e) {
                    addLog('Failed to request host start-all: ' + e, 'warn');
                  }
                }

                if (lowerNext.includes('open google') || lowerNext.includes('open tab') || lowerNext.includes('open new tab') || openGoogleMatch) {
                  let url = 'https://www.google.com';
                  if (openGoogleMatch && openGoogleMatch[1]) {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(openGoogleMatch[1]);
                  }
                  try {
                    await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
                    const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: `Opening ${url}` };
                    setMessages((prev) => [...prev, assistantMessage]);
                    addLog('Requested open URL: ' + url, 'info');
                    speakText(`Opening ${openGoogleMatch ? openGoogleMatch[1] : 'Google'}`, selectedVoice);
                    // continue to next queued prompt without calling LLM for this action
                    continue;
                  } catch (e) {
                    addLog('Failed to open URL: ' + e, 'warn');
                  }
                }

                let ollamaReply = null;
                if (ollamaConnected) {
                  try {
                    ollamaReply = await getOllamaReply(nextText, workingMemory);
                    if (!ollamaReply) addLog('Ollama returned no response; falling back to local reply.', 'warn');
                  } catch (e) {
                    addLog('Error contacting Ollama, using local response.', 'warn');
                    ollamaReply = null;
                  }
                } else {
                  addLog('Ollama offline — using local reply builder.', 'warn');
                }

                const reply = ollamaReply || buildReply(nextText, workingMemory);

                await new Promise((resolve) => setTimeout(resolve, 250));

                const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: reply };
                setMessages((prev) => [...prev, assistantMessage]);
                addLog(ollamaReply ? 'Assistant replied via Ollama.' : 'Assistant responded with a contextual summary.', 'success');
                speakText(reply, selectedVoice);
      }
    } finally {
      processingPromptRef.current = false;
      setIsThinking(false);
      setHudStatus('IDLE');
    }
  };

  const addShortcut = () => {
    const label = shortcutDraft.trim();
    if (!label) return;

    const newShortcut = {
      id: Date.now(),
      label: label.split(' ').slice(0, 2).join(' ') || 'New shortcut',
      action: label,
    };

    setShortcuts((prev) => [newShortcut, ...prev].slice(0, 6));
    setShortcutDraft('');
    addLog(`Shortcut added: ${newShortcut.label}`, 'info');
  };

  const toggleConnection = (id) => {
    setCommandCatalog((prev) => prev.map((item) => item.id === id ? { ...item, connected: !item.connected } : item));
  };

  // persist command catalog to local storage so the dashboard remembers connections
  useEffect(() => {
    try { localStorage.setItem(storageKeys.commandCatalog, JSON.stringify(commandCatalog)); } catch (e) { /* ignore */ }
  }, [commandCatalog]);

  const handleHudToggle = () => {
    setHudOpen((prev) => !prev);
  };

  // run a prompt directly by sending it as a user message
  const runPrompt = async (prompt) => {
    addLog(`Running prompt: ${prompt}`, 'info');
    await sendMessage(prompt);
  };

  // construct a command-style prompt and send it to Ella
  const runCommand = async (serviceId, command) => {
    const service = commandCatalog.find((s) => s.id === serviceId);
    const serviceName = service ? service.name : serviceId;
    const text = `Ella, ${command} on ${serviceName}`;
    addLog(`Executing command: ${text}`, 'info');
    await sendMessage(text);
  };

  // Kill a process (by PID) via the backend
  const killProcess = async (pid) => {
    try {
      const res = await fetch('http://192.168.1.207:3001/api/kill', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ pid }) });
      if (res.ok) {
        addLog(`Killed process ${pid}`, 'success');
        // refresh extended metrics
        const em = await fetch('http://192.168.1.207:3001/api/extended-metrics'); if (em.ok) setExtended(await em.json());
      } else {
        const err = await res.json(); addLog(`Failed to kill ${pid}: ${err && err.error}`, 'error');
      }
    } catch (e) { addLog(`Kill request failed: ${e.message}`, 'error'); }
  };

  const runAction = async (action) => {
    try {
      const res = await fetch('http://192.168.1.207:3001/api/exec', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ action }) });
      if (res.ok) { addLog(`Action ${action} started`, 'success'); }
      else { const err = await res.json(); addLog(`Action failed: ${err && err.error}`, 'error'); }
    } catch (e) { addLog(`Action error: ${e.message}`, 'error'); }
  };

  // open or focus the dashboard in a separate window and attempt to position it on a second monitor
  const openDashboardOnSecondMonitor = () => {
    try {
      // Best-effort coordinates for a second monitor arranged to the right of primary.
      // Many browsers restrict moving windows; this is a best-effort approach.
      const url = `${window.location.origin}${window.location.pathname}?panel=dashboard`;
      const w = Math.min(1200, Math.max(600, Math.floor(window.screen.width * 0.8)));
      const h = Math.min(900, Math.max(400, Math.floor(window.screen.height * 0.8)));
      // Attempt to place at start of secondary monitor (to the right of primary)
      const left = (window.screen.width || 1366) + 20;
      const top = 40;
      const features = `left=${left},top=${top},width=${w},height=${h},resizable=yes,scrollbars=yes`;

      const existing = window.open('', 'ella-dashboard-window');
      if (existing && !existing.closed) {
        try { existing.focus(); existing.location.href = url; } catch (e) { /* ignore cross-origin set */ }
        return;
      }

      const child = window.open(url, 'ella-dashboard-window', features);
      if (!child) {
        addLog('Popup blocked — opening dashboard in current window instead.', 'warn');
        // fallback: navigate the current window to the dashboard view
        setSelectedTab('dashboard');
        setHudOpen(false);
      } else {
        addLog('Opening dashboard on second monitor (best-effort).', 'info');
        // close the mini menu after opening
        setSmallMenuOpen(false);
      }
    } catch (e) {
      addLog('Failed to open dashboard on second monitor: ' + (e.message || e), 'error');
      setSelectedTab('dashboard');
      setHudOpen(false);
    }
  };

  const launchVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addLog('Speech recognition is not supported in this browser.', 'warn');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognitionRef.current = recognition;
    recognition.onstart = () => {
      setIsVoiceOn(true);
      setVoiceStatus('Listening');
      setHudListening(true);
      setHudStatus('LISTENING');
      addLog('Voice capture started.', 'info');
    };

    recognition.onresult = async (event) => {
      // Some browsers provide multiple results; gather the latest final transcript reliably
      let finalTranscript = '';
      try {
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          // take the most confident alternative from each result
          if (res && res[0] && res[0].transcript) {
            finalTranscript += (res[0].transcript + ' ');
          }
        }
        finalTranscript = finalTranscript.trim();
      } catch (err) {
        // fallback to the simple path
        finalTranscript = (event.results[0] && event.results[0][0] && event.results[0][0].transcript) || '';
      }

      const finalText = (finalTranscript || '').trim();
      addLog(`Raw transcript: ${JSON.stringify(finalTranscript)}`, 'info');

      if (!finalText) {
        addLog('Transcript empty, ignoring.', 'warn');
        return;
      }

      // Try to parse voice commands like: "Ella text John Smith hi" or "text +1555123 hello"
      const cmd = parseVoiceCommand(finalText);
      if (cmd && cmd.type === 'sms') {
        addLog(`Voice shortcut detected. Recipient: ${cmd.recipient} Message: ${cmd.message}`, 'info');
        // trigger the phone shortcut flow using the parsed recipient and message
        await triggerShortcutWithRecipient(cmd.recipient, cmd.message);
        // update UI with clear entries
        setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: finalText }]);
        setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'assistant', text: `Sending message to ${cmd.recipient}` }]);
        setInput('');
        return;
      }

      // default behavior: insert transcribed text into composer and send as chat
      setInput(finalText);
      addLog(`Voice transcript captured (chat): ${finalText}`, 'info');
      // small delay to allow UI update then send
      setTimeout(() => sendMessage(finalText), 200);
    };

    recognition.onerror = (event) => {
      setVoiceStatus('Ready');
      setIsVoiceOn(false);
      setHudListening(false);
      setHudStatus('IDLE');
      addLog(`Voice error: ${event.error}`, 'warn');
    };

    recognition.onend = () => {
      setVoiceStatus('Ready');
      setIsVoiceOn(false);
      setHudListening(false);
      setHudStatus(isThinking ? 'THINKING' : 'IDLE');
      addLog('Voice capture ended.', 'info');
    };

    recognition.start();
  };

  const sendText = () => {
    const target = phone.trim() || '+15551234567';
    const body = encodeURIComponent(input.trim() || 'Hi Ella, can you help me?');
    // fallback: open native SMS app with prefilled message
    window.location.href = `sms:${target}?body=${body}`;
    addLog(`Opening SMS flow for ${target}.`, 'info');
  };

  // Send via Apple Shortcuts using the clipboard as the reliable input channel
  // Many iOS versions pass the current page URL into the shortcut when opened via the run-shortcut URL.
  // To avoid the web URL being used as the message, write the intended "PHONE|MESSAGE" to the clipboard
  // then open the shortcut (which should read clipboard contents via Get Clipboard as its first action).
  const sendTextViaShortcut = async (message) => {
    const shortcutName = readStorage(storageKeys.shortcutName, 'Ella Send SMS');
    const phoneNumber = (phone || '').trim();
    if (!phoneNumber) {
      addLog('No phone number configured for shortcuts.', 'warn');
      return;
    }

    const raw = `${phoneNumber}|${message}`;
    addLog(`Preparing shortcut payload: ${raw}`, 'info');

    // Try to write to the clipboard first (requires HTTPS and user gesture)
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(raw);
        addLog('Payload written to clipboard.', 'info');
      } else {
        addLog('Clipboard API not available; shortcut may receive the page URL instead.', 'warn');
      }
    } catch (err) {
      addLog('Failed to write to clipboard: ' + (err.message || err), 'warn');
    }

    // Open the shortcut by name. The shortcut should start with Get Clipboard to read the payload.
    const url = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`;
    addLog(`Opening Shortcuts app to run: ${shortcutName}`, 'info');

    // Attempt to open the shortcuts URL
    window.location.href = url;
  };

  const handleShortcutAction = (shortcut) => {
    // Shortcut actions send directly via phone shortcut rather than putting text into chat
    const message = shortcut.action || shortcut.label || '';
    if (!message) return;
    addLog(`Sending via phone shortcut: ${message}`, 'info');
    triggerShortcutWithRecipient(readStorage(storageKeys.phone, ''), message);
  };

  // Parse simple voice commands to extract recipient and message.
  // Supports:
  //  - "text John Smith hi"
  //  - "Ella text John Smith hi"
  //  - "text +15551234567 hi"
  const parseVoiceCommand = (text) => {
    const t = text.trim();
    // Normalize leading wakeword
    const normalized = t.replace(/^ella[,\s]*/i, '').trim();

    // Regex: text <recipient> <message>
    const m = normalized.match(/^(?:text|send (?:a )?text(?: message)?(?: to)?)[\s,]+(.+?)\s+(?:saying|that|says|:|-|,)??\s*(.+)$/i);
    if (m && m[1] && m[2]) {
      const recipient = m[1].trim();
      const message = m[2].trim();
      return { type: 'sms', recipient, message };
    }

    // Fallback: if starts with a plus and digits
    const m2 = normalized.match(/^(?:text|send text)\s+([+\d][\d\s-]+)\s+(.+)$/i);
    if (m2 && m2[1] && m2[2]) {
      return { type: 'sms', recipient: m2[1].replace(/\s+/g, ''), message: m2[2].trim() };
    }

    return null;
  };

  // Trigger the Apple Shortcut by writing RECIPIENT|MESSAGE to clipboard then opening Shortcuts.
  const triggerShortcutWithRecipient = async (recipient, message) => {
    const shortcutName = readStorage(storageKeys.shortcutName, 'Ella Send SMS');
    if (!recipient || !message) {
      addLog('Missing recipient or message for shortcut trigger.', 'warn');
      return;
    }
    const raw = `${recipient}|${message}`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(raw);
        addLog('Shortcut payload written to clipboard.', 'info');
      } else {
        addLog('Clipboard API not available; shortcut may get the page URL instead.', 'warn');
      }
    } catch (err) {
      addLog('Failed to write to clipboard: ' + (err.message || err), 'warn');
    }

    const url = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`;
    addLog(`Opening Shortcuts app to run: ${shortcutName}`, 'info');
    window.location.href = url;
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <div className="ella-hud">
        <div className={`ella-notch ${hudOpen ? 'open' : ''} ${hudListening ? 'listening' : ''}`} onClick={handleHudToggle}>
          <span className="ella-dot" />
          <span className="ella-dot" />
          <span className="ella-dot" />
        </div>

        <div className={`ella-drawer ${hudOpen ? 'open' : ''}`}>
          <div className="ella-drawer-inner">
            <div className={`ella-status-label ${hudListening || isThinking ? 'active' : ''}`}>{hudStatus}</div>
            <div className={`ella-orb-stage ${hudListening ? 'listening' : ''}`} onClick={() => { setHudOpen(true); launchVoice(); }} onDoubleClick={() => { setSmallMenuOpen((s) => !s); setHudOpen(false); }}>
              <div className="ella-ring r1" />
              <div className="ella-ring r2" />
              <div className="ella-orb" />
            </div>
            <div className="ella-transcript">{hudListening ? 'listening…' : 'say "hey ella"'}</div>
            <div className="ella-tip">hold space to talk • double click orb • open connectors</div>

            {/* Small popdown menu that appears under the notch when the orb is double-clicked */}
            <div className={`ella-mini-menu ${smallMenuOpen ? 'open' : ''}`} role="menu" aria-hidden={!smallMenuOpen}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                <div style={{fontWeight:700}}>Connectors</div>
                <div>
                  <button className="secondary-button small-button" onClick={() => openDashboardOnSecondMonitor()}>Open dashboard on 2nd monitor</button>
                </div>
              </div>
              <div className="mini-menu-scroll">
                {commandCatalog.map((service) => (
                  <div key={service.id} className={`mini-item ${service.connected ? 'connected' : ''}`} onClick={() => { toggleConnection(service.id); }}>
                    <div className="mini-item-left">
                      <div className="mini-service-name">{service.name}</div>
                      <div className="mini-service-sub">{service.connected ? 'Connected' : 'Tap to connect'}</div>
                    </div>
                    <div className="mini-item-right">
                      <button className={`ghost-button small-button`}>{service.connected ? 'Connected' : 'Connect'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-icon"><Sparkles size={18} /></div>
          <div>
            <div className="eyebrow">Ella OS</div>
            <h1>Control hub</h1>
          </div>
        </div>

        <nav className="nav-stack">
          <button className={`nav-item ${selectedTab==='dashboard' ? 'active' : ''}`} onClick={()=>setSelectedTab('dashboard')}><LayoutDashboard size={16} /> Dashboard</button>
          <button className={`nav-item ${selectedTab==='chat' ? 'active' : ''}`} onClick={()=>setSelectedTab('chat')}><MessageSquareText size={16} /> Chat</button>
          <button className={`nav-item ${selectedTab==='memory' ? 'active' : ''}`} onClick={()=>setSelectedTab('memory')}><BrainCircuit size={16} /> Memory</button>
          <button className={`nav-item ${selectedTab==='admin' ? 'active' : ''}`} onClick={()=>setSelectedTab('admin')}><ShieldCheck size={16} /> Admin</button>
        </nav>

        <div className="mini-card">
          <div className="mini-label">Voice</div>
          <div className="status-line">
            <span className={`dot ${isVoiceOn ? 'on' : ''}`} />
            {voiceStatus}
          </div>
          <button className="primary-button" onClick={launchVoice}><Mic size={16} /> Start voice</button>
        </div>

        <div className="mini-card">
          <div className="mini-label">Quick actions</div>
          <div className="chip-list">
            {shortcuts.slice(0, 3).map((item) => (
              <button key={item.id} className="chip" onClick={() => setInput(item.action)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="eyebrow">Assistant</div>
            <h2>Ella chat</h2>
          </div>
         <div style={{display:'flex',alignItems:'center',gap:10}}>
           <div className={`live-pill ${ollamaConnected ? 'connected' : 'offline'}`}><Bot size={14} /> {ollamaConnected ? 'online' : 'offline'}</div>
           <button className="ghost-button" onClick={async()=>{
             const lastAssistant = [...messages].reverse().find(m=>m.role==='assistant');
             const text = lastAssistant ? lastAssistant.text : 'Hello from Ella';
             try { const r = await fetch('http://192.168.1.207:3001/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); if (r.ok) addLog('Spoken on PC','success'); else addLog('Speak failed','error'); } catch(e){ addLog('Speak request failed: '+e.message,'error'); }
           }} title="Speak last assistant message on PC">Speak on PC</button>
         </div>
        </header>

        {/* Floating three-dot button to trigger Ella on the PC */}
        <div className="dashboard-dot" onClick={()=>{ runAction('start-ella'); setSmallMenuOpen(s=>!s); }} title="Open Ella on PC">
          <div className="dot-row"><div className="dot"/><div className="dot"/><div className="dot"/></div>
        </div>

        {selectedTab === 'dashboard' && (
          <section className="chat-card dashboard-card">
            <div className="dashboard-grid">
              <div className="dashboard-panel">
                <div className="panel-header"><LayoutDashboard size={16} /> <span>Connected services</span></div>
                <div className="service-list">
                  {commandCatalog.map((service) => (
                    <div key={service.id} className={`service-row ${service.connected ? 'enabled' : ''}`}>
                      <div>
                        <div className="service-name">{service.name}</div>
                        <div className="service-status">{service.connected ? 'Connected' : 'Disconnected'}</div>
                      </div>
                      <button className="secondary-button small-button" onClick={() => toggleConnection(service.id)}>
                        {service.connected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-panel">
                <div className="panel-header"><BrainCircuit size={16} /> <span>Prompt map</span></div>
                <div className="prompt-grid">
                  {commandCatalog.map((service) => (
                    <div key={service.id} className="prompt-card">
                      <div className="prompt-title">{service.name}</div>
                      <div className="chip-list compact-list">
                        {service.commands.map((command) => (
                          <button key={command} className="chip" onClick={() => runCommand(service.id, command)}>{command}</button>
                        ))}
                      </div>
                      <div className="prompt-examples">
                        {service.prompts.map((prompt) => (
                          <div key={prompt} className="prompt-line">“{prompt}” <button className="ghost-button small-button" onClick={() => runPrompt(prompt)}>Run</button></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="command-table-wrap">
              <div className="panel-header"><TerminalSquare size={16} /> <span>Ella command matrix</span></div>
              <table className="command-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Ella can run</th>
                    <th>Example prompt</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {commandCatalog.map((service) => (
                    <tr key={service.id}>
                      <td>{service.name}</td>
                      <td>{service.commands.join(', ')}</td>
                      <td>{service.prompts[0]}</td>
                      <td>{service.connected ? 'Active' : 'Offline'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedTab === 'chat' && (
          <section className="chat-card">
            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={`bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
                  {message.text}
                </div>
              ))}
              {isThinking && <div className="bubble assistant typing">Ella is thinking...</div>}
            </div>

            <div className="composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={3}
                placeholder="Ask Ella anything..."
                onKeyDown={handleComposerKeyDown}
              />
              <div className="composer-actions">
                <button className="secondary-button" onClick={() => sendMessage()}><Send size={16} /> Send</button>
                <button className="ghost-button" onClick={launchVoice}><Mic size={16} /> Speech</button>
              </div>
            </div>
          </section>
        )}

        {selectedTab === 'admin' && (
          <section className="chat-card admin-full admin-dashboard">
            <div className="admin-left">
              <div className="panel-header"><ShieldCheck size={16} /> <span>System</span></div>
              <div className="stat-row">
                <div className="stat"><div className="stat-value">{metrics.cpuPercent}%</div><div className="stat-sub">CPU Usage</div></div>
                <div className="stat"><div className="stat-value">{(metrics.memory.used/1024/1024/1024).toFixed(2)} GB</div><div className="stat-sub">RAM used ({metrics.memory.usedPercent}%)</div></div>
                <div className="stat"><div className="stat-value">{metrics.disks && metrics.disks[0] ? (metrics.disks[0].used/1024/1024/1024).toFixed(2) + ' GB' : '—'}</div><div className="stat-sub">Storage used</div></div>
              </div>

              <div className="panel-header" style={{marginTop:12}}><Waves size={16} /> <span>Network</span></div>
              <div className="stat-row">
                <div className="stat"><div className="stat-value">{window.location.hostname}</div><div className="stat-sub">Host</div></div>
                <div className="stat"><div className="stat-value">{metrics.uptime ? Math.floor(metrics.uptime/60) + 'm' : '—'}</div><div className="stat-sub">Uptime</div></div>
                <div className="stat"><div className="stat-value">{metrics.disks ? metrics.disks.length : 0}</div><div className="stat-sub">Drives</div></div>
              </div>

              <div className="panel-header" style={{marginTop:12}}><Phone size={16} /> <span>Quick actions</span></div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <button className="primary-button" onClick={()=>{ openDashboardOnSecondMonitor(); }}>Open on laptop</button>
                <button className="secondary-button" onClick={()=>{ setSelectedTab('dashboard'); }}>Open Dashboard</button>
                <button className="ghost-button" onClick={()=>{ addLog('Sync requested','info'); }}>Sync connectors</button>
              </div>

            </div>

            <div className="admin-center">
              <div className="hud-top">
                <div className="radial large">
                  <div className="radial-center">LIVE</div>
                </div>

                <div className="radial large right">
                  <div className="radial-center">ANALYTICS</div>
                </div>
              </div>

              <div className="metrics-row">
                <div className="metric-small">CPU: {metrics.cpuPercent}%</div>
                <div className="metric-small">RAM: {(metrics.memory.used/1024/1024/1024).toFixed(2)}GB ({metrics.memory.usedPercent}%)</div>
                <div className="metric-small">Disks: {metrics.disks ? metrics.disks.map(d=> `${d.mount} ${d.usedPercent}%`).join(' | ') : '—'}</div>
              </div>

              <div style={{display:'flex',gap:10,marginTop:10}}>
                <div className="panel card" style={{flex:1}}>
                  <div className="panel-header"><Sparkles size={16} /> <span>Network interfaces</span></div>
                  <div style={{fontSize:12}}>
                    {extended.network.map(n=> (<div key={`${n.name}-${n.address}`} style={{padding:'6px 0'}}><strong>{n.name}</strong> {n.address} {n.family} {n.internal ? '(internal)' : ''}</div>))}
                  </div>
                </div>

                <div className="panel card" style={{width:320}}>
                  <div className="panel-header"><Sparkles size={16} /> <span>GPU</span></div>
                  <div style={{fontSize:12}}>
                    {extended.gpus.length ? extended.gpus.map((g,idx)=>(<div key={idx} style={{padding:'6px 0'}}><strong>{g.name}</strong> {g.util || ''} {g.memUsed ? `${g.memUsed} / ${g.memTotal}` : ''}</div>)) : <div style={{color:'#9fb4d9'}}>No GPU info</div>}
                  </div>
                </div>
              </div>

              <div className="charts-row">
                <div className="bar-chart">
                  <div className="bars">
                    {Array.from({length:12}).map((_,i)=>(<div key={i} className="bar" style={{height: `${20 + Math.floor(Math.random()*70)}%`}}/>))}
                  </div>
                </div>

                <div className="line-chart">
                  <div className="chart-placeholder">Activity over time</div>
                </div>
              </div>

              <div className="commands-panel">
                <div className="panel-header"><TerminalSquare size={16} /> <span>Recent commands</span></div>
                <ul className="command-list">
                  {logs.slice(-10).reverse().map(l=> (<li key={l.id}><strong>{l.level}</strong> {l.message}</li>))}
                </ul>
              </div>

              <div className="processes-panel" style={{marginTop:12}}>
                <div className="panel-header"><TerminalSquare size={16} /> <span>Top processes</span></div>
                <div style={{maxHeight:200,overflow:'auto'}}>
                  {extended.processes.slice(0,40).map(p=> (
                    <div key={p.pid} style={{display:'flex',justifyContent:'space-between',padding:'6px 8px',borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
                      <div style={{width:'65%'}}><strong>{p.name}</strong> <small style={{color:'#9fb4d9'}}>{p.cmd || ''}</small></div>
                      <div style={{display:'flex',gap:8}}>
                        <div style={{minWidth:60,textAlign:'right'}}>{p.pid}</div>
                        <button className="ghost-button small-button" onClick={()=>killProcess(p.pid)}>Kill</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="admin-right">
              <div className="panel-header"><Sparkles size={16} /> <span>Connectors & Tasks</span></div>
              <div className="connector-list">
                {commandCatalog.map(s=> (
                  <div key={s.id} className={`connector-row ${s.connected ? 'active' : ''}`} onClick={()=>toggleConnection(s.id)}>
                    <div className="connector-name">{s.name}</div>
                    <div className="connector-status">{s.connected ? 'Connected' : 'Offline'}</div>
                  </div>
                ))}
              </div>

              <div className="panel-header" style={{marginTop:12}}><ShieldCheck size={16} /> <span>Actions</span></div>
              <div style={{display:'flex',gap:8,flexDirection:'column'}}>
                <button className="primary-button" onClick={()=>runAction('start-ella')}>Start Ella</button>
                <button className="secondary-button" onClick={()=>{ addLog('Restart requested','info'); runAction('start-ella'); }}>Restart Ella</button>
              </div>

              <div className="panel-header" style={{marginTop:12}}><ShieldCheck size={16} /> <span>Logs</span></div>
              <ul className="log-list compact">
                {logs.slice(-20).reverse().map((entry) => (
                  <li key={entry.id} className={entry.level}><span>{entry.timestamp}</span><strong>{entry.level}</strong><p>{entry.message}</p></li>
                ))}
              </ul>
            </div>
          </section>
        )}
                </main>

                <aside className="right-rail">
                  {selectedTab !== 'admin' && (
                    <>
                      <div className="panel card">
                        <div className="panel-header">
                          <Phone size={16} />
                          <span>Texting</span>
                        </div>
                        <label>Phone number</label>
                        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 555 123 4567" />
                        <div style={{display:'flex',gap:8,marginTop:8}}>
                          <button className="primary-button wide" onClick={sendText}>Open SMS</button>
                          <button className="secondary-button wide" onClick={() => sendTextViaShortcut(input || 'Hello Ella')} style={{padding:'10px 12px'}}>Send via Phone Shortcut</button>
                        </div>
                      </div>

                      <MondayTasks />

                      <div className="panel card">
                        <div className="panel-header">
                          <BrainCircuit size={16} />
                          <span>Memory</span>
                        </div>
                        <ul className="memory-list">
                          {memory.slice(-4).reverse().map((item) => (
                            <li key={item.id}>{item.text}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="panel card">
                        <div className="panel-header">
                          <Waves size={16} />
                          <span>Shortcuts</span>
                        </div>
                        <div className="shortcut-row">
                          <input value={shortcutDraft} onChange={(event) => setShortcutDraft(event.target.value)} placeholder="Add shortcut" />
                          <button className="icon-button" onClick={addShortcut}><Plus size={16} /></button>
                        </div>
                        <div className="shortcut-list">
                          {shortcuts.map((shortcut) => (
                            <button key={shortcut.id} className="shortcut-pill" onClick={() => handleShortcutAction(shortcut)}>
                              {shortcut.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="panel card logs-card">
                        <div className="panel-header">
                          <ShieldCheck size={16} />
                          <span>Debug log</span>
                        </div>
                        <ul className="log-list">
                          {logs.slice(-8).reverse().map((entry) => (
                            <li key={entry.id} className={entry.level}>
                              <span>{entry.timestamp}</span>
                              <strong>{entry.level}</strong>
                              <p>{entry.message}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </>
          );
        }
 
        export default App;
