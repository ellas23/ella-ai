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
  phone: 'ella-phone-number',
  shortcutName: 'ella-shortcut-name',
  selectedVoice: 'ella-selected-voice',
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

  if (lower.includes('weather')) {
    return 'I can help you check the weather, but for live conditions I would need a weather service connected to the app.';
  }

  if (lower.includes('who are you') || lower.includes('what are you')) {
    return 'I am Ella, your local assistant. I can chat, keep context, open texts, and help you plan your day.';
  }

  return 'I understand. I can keep it simple, clear, and useful while remembering what we discussed earlier.';
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

  const sendMessage = (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;

    setIsThinking(true);
    const userMessage = { id: Date.now(), role: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    addLog(`User message received: ${text}`, 'info');

    const nextMemory = [...memory.slice(-6), { id: Date.now() + 1, text }];
    setMemory(nextMemory);

    const reply = buildReply(text, nextMemory);

    setTimeout(() => {
      const assistantMessage = { id: Date.now() + 2, role: 'assistant', text: reply };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsThinking(false);
      addLog('Assistant responded with a contextual summary.', 'success');
      speakText(reply, selectedVoice);
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
      const finalText = transcript.trim();
      if (!finalText) return;
      setInput(finalText);
      setTimeout(() => sendMessage(finalText), 120);
      addLog(`Voice transcript captured: ${finalText}`, 'info');
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
    sendTextViaShortcut(message);
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
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
          <div className="live-pill"><Bot size={14} /> online</div>
        </header>

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
          <section className="chat-card admin-full">
            <div className="admin-grid">
              <div className="admin-settings">
                <div className="panel-header"><ShieldCheck size={16} /> <span>Settings</span></div>
                <label>Default phone number</label>
                <input value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="+1 555 123 4567" />

                <label style={{marginTop:10}}>Phone Shortcut name</label>
                <input value={readStorage(storageKeys.shortcutName,'Ella Send SMS')} onChange={(e)=>{ localStorage.setItem(storageKeys.shortcutName, e.target.value); addLog('Shortcut name set: '+e.target.value,'info'); }} placeholder="Ella Send SMS" />

                <label style={{marginTop:10}}>TTS Voice</label>
                <select value={selectedVoice || ''} onChange={(e)=>setSelectedVoice(e.target.value)}>
                  {voices.map((v)=> <option key={v.name} value={v.name}>{v.name} {v.lang ? `(${v.lang})` : ''}</option>)}
                </select>

                <div style={{marginTop:12}}>
                            <button className="primary-button" onClick={()=>{ speakText('Hello, this is a voice test.', selectedVoice); addLog('Voice test triggered','info'); }}>Test voice</button>
                          </div>
                        </div>

                        <div className="admin-terminal">
                          <div className="panel-header"><TerminalSquare size={16} /> <span>Debug terminal</span></div>
                          <div ref={terminalRef} className="terminal" />
                        </div>

                        <div className="admin-logs">
                          <div className="panel-header"><ShieldCheck size={16} /> <span>Debug log</span></div>
                          <ul className="log-list">
                            {logs.slice(-40).reverse().map((entry) => (
                              <li key={entry.id} className={entry.level}>
                                <span>{entry.timestamp}</span>
                                <strong>{entry.level}</strong>
                                <p>{entry.message}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
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
  );
}

export default App;
