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
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

const storageKeys = {
  messages: 'ella-chat-messages',
  memory: 'ella-memory',
  logs: 'ella-debug-logs',
  shortcuts: 'ella-shortcuts',
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

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

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

  return 'I understand. I can keep it simple, clear, and useful while remembering what we discussed earlier.';
};

function App() {
  const [messages, setMessages] = useState(() => readStorage(storageKeys.messages, defaultMessages));
  const [memory, setMemory] = useState(() => readStorage(storageKeys.memory, []));
  const [shortcuts, setShortcuts] = useState(() => readStorage(storageKeys.shortcuts, defaultShortcuts));
  const [logs, setLogs] = useState(() => readStorage(storageKeys.logs, [{ id: 1, level: 'info', message: 'Ella control hub ready', timestamp: new Date().toLocaleTimeString() }]));
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState('+15551234567');
  const [shortcutDraft, setShortcutDraft] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('Ready');
  const [isVoiceOn, setIsVoiceOn] = useState(false);
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
    addLog('System booted and chat memory loaded.', 'info');
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

  const sendMessage = (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;

    const userMessage = { id: Date.now(), role: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    addLog(`User message received: ${text}`, 'info');

    const nextMemory = [...memory.slice(-6), { id: Date.now() + 1, text }];
    setMemory(nextMemory);

    const reply = buildReply(text, nextMemory);

    setTimeout(() => {
      setMessages((prev) => [...prev, { id: Date.now() + 2, role: 'assistant', text: reply }]);
      addLog('Assistant responded with a contextual summary.', 'success');
    }, 250);
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
      addLog('Voice capture started.', 'info');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      addLog(`Voice transcript captured: ${transcript}`, 'info');
    };

    recognition.onerror = (event) => {
      setVoiceStatus('Ready');
      setIsVoiceOn(false);
      addLog(`Voice error: ${event.error}`, 'warn');
    };

    recognition.onend = () => {
      setVoiceStatus('Ready');
      setIsVoiceOn(false);
      addLog('Voice capture ended.', 'info');
    };

    recognition.start();
  };

  const sendText = () => {
    const target = phone.trim() || '+15551234567';
    const body = encodeURIComponent(input.trim() || 'Hi Ella, can you help me?');
    window.location.href = `sms:${target}?body=${body}`;
    addLog(`Opening SMS flow for ${target}.`, 'info');
  };

  return (
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
          <button className="nav-item active"><LayoutDashboard size={16} /> Dashboard</button>
          <button className="nav-item"><MessageSquareText size={16} /> Chat</button>
          <button className="nav-item"><BrainCircuit size={16} /> Memory</button>
          <button className="nav-item"><ShieldCheck size={16} /> Admin</button>
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
          <div className="live-pill"><Bot size={14} /> online</div>
        </header>

        <section className="chat-card">
          <div className="message-list">
            {messages.map((message) => (
              <div key={message.id} className={`bubble ${message.role === 'assistant' ? 'assistant' : 'user'}`}>
                {message.text}
              </div>
            ))}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Ask Ella anything..."
            />
            <div className="composer-actions">
              <button className="secondary-button" onClick={() => sendMessage()}><Send size={16} /> Send</button>
              <button className="ghost-button" onClick={launchVoice}><Mic size={16} /> Speech</button>
            </div>
          </div>
        </section>
      </main>

      <aside className="right-rail">
        <div className="panel card">
          <div className="panel-header">
            <Phone size={16} />
            <span>Texting</span>
          </div>
          <label>Phone number</label>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 555 123 4567" />
          <button className="primary-button wide" onClick={sendText}>Open SMS</button>
        </div>

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
              <button key={shortcut.id} className="shortcut-pill" onClick={() => setInput(shortcut.action)}>
                {shortcut.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel card terminal-card">
          <div className="panel-header">
            <TerminalSquare size={16} />
            <span>Debug terminal</span>
          </div>
          <div ref={terminalRef} className="terminal" />
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
      </aside>
    </div>
  );
}

export default App;
