# JARVIS vs Ella

JARVIS is the audited focused desktop trigger utility at `Desktop\ella-ai-main\jarvis-main\jarvis-main`. Ella remains the primary assistant and source of truth. This comparison describes integration decisions only; it does not implement them.

| Feature | JARVIS | Ella | Keep Ella Version | Integration Needed | Priority |
|---|---|---|---|---|---|
| Double-clap trigger | Implemented adaptive RMS detector | Wake-word/voice loop exists | Keep wake word and add clap only as opt-in | NEEDS ADAPTATION | P1 |
| Microphone selection/probing | Device enumeration and loudest-input fallback | Recognizer startup/config exists | Use Ella recognizer ownership | EASY TO ADD | P2 |
| Wake word | Not present | Present/configured | Ella | ALREADY EXISTS | P0 |
| Speech recognition | Not present | Faster-Whisper `medium.en` | Ella | ALREADY EXISTS | P0 |
| Voice activity detection | Only clap noise gate | Ella VAD setting/pipeline | Ella speech VAD | ALREADY EXISTS | P0 |
| Interruption/barge-in | Not present | Existing voice architecture may support related behavior | Ella | NOT RECOMMENDED from JARVIS | P2 |
| Local TTS | Not present | Existing local TTS/SAPI path | Ella | ALREADY EXISTS | P0 |
| ElevenLabs TTS | Optional cloud welcome | Local TTS already works | Ella local provider | NOT RECOMMENDED by default | P3 |
| TTS caching | Local WAV cache for ElevenLabs | No equivalent provider-specific cache identified | Ella local cache if needed | EASY TO ADD | P2 |
| Streaming speech | Not present | Existing assistant voice path | Ella | NOT RECOMMENDED from JARVIS | P2 |
| Conversational context | Not present | Conversations and Ollama | Ella | ALREADY EXISTS | P0 |
| Model routing | Not present | Ollama runtime configuration | Ella | ALREADY EXISTS | P0 |
| Fast/deep model selection | Not present | Configurable Ollama model, currently qwen2.5:14b | Ella | ALREADY EXISTS | P1 |
| Tool calling | Not present | Backend actions/research/control exist | Ella allowlists | ALREADY EXISTS | P0 |
| Task planning | Not present | Automation/research/task surfaces exist | Ella | ALREADY EXISTS | P1 |
| Reasoning/research | Not present | Local research pipeline and worker | Ella | ALREADY EXISTS | P0 |
| Hallucination filtering | Not present | Evidence/status-oriented research surfaces | Ella | ALREADY EXISTS | P1 |
| Follow-up conversations | Not present | Ella chat/task state | Ella | ALREADY EXISTS | P0 |
| Memory | None | Local memory, knowledge, graph, editing | Ella | ALREADY EXISTS | P0 |
| Opening applications | URLs and Cursor only | Allowlisted PC controls | Ella allowlist | ALREADY EXISTS | P0 |
| Window control | Chrome/Cursor placement and F11 | PC/browser controls and viewer | Ella safety layer | NEEDS ADAPTATION | P2 |
| Keyboard/mouse | Only F11 through Win32 | Bob browser automation/PyAutoGUI path | Ella allowlisted controls | ALREADY EXISTS | P1 |
| Browser control | Chrome process/window launch | Selenium/PyAutoGUI research and Bob | Ella | ALREADY EXISTS | P0 |
| Screenshots/OCR/screen reading | Not present | Bob screenshot/browser path and Mac/PC viewers | Ella | ALREADY EXISTS | P1 |
| File operations | Not present | Knowledge upload/indexing and approved PC file operations | Ella | ALREADY EXISTS | P0 |
| Shell/terminal commands | Not present | Restricted approved controls, no arbitrary shell | Ella safety model | NOT RECOMMENDED | P0 |
| Web search/page reading | Not present | HTTP/BeautifulSoup/Selenium/PyAutoGUI pipeline | Ella | ALREADY EXISTS | P0 |
| Monday.com | Read-only GraphQL tasks and board opening | No confirmed Monday provider | Ella connector/vault | NEEDS ADAPTATION | P1 |
| Email/calendar/contacts | Not present | Email intelligence and related dashboard surfaces | Ella | ALREADY EXISTS or NEEDS PROVIDER-SPECIFIC WORK | P1 |
| MCP/plugins | Not present | No JARVIS contribution | Ella architecture | NOT RECOMMENDED from JARVIS | P2 |
| Dashboard/orb/PWA | Not present | Dashboard, orb, remote Vercel/Tailscale path | Ella | ALREADY EXISTS | P0 |
| Status/logging/errors | Console logging only | Health, lifecycle, logs, authenticated status APIs | Ella | ALREADY EXISTS | P0 |
| Startup/shutdown/restart | Manual script/Ctrl+C | PowerShell lifecycle and duplicate prevention | Ella | ALREADY EXISTS | P0 |
| Health monitoring | Not present | Ella health/status endpoints | Ella | ALREADY EXISTS | P0 |
| Installer/setup wizard | Requirements plus README | Existing scripts but no final installer | Ella installer design | MAJOR PROJECT | P1 |
| Automatic updates | Not present | Not currently implemented | Ella future installer | MAJOR PROJECT | P2 |

## Decision

The only direct JARVIS capabilities worth considering for Ella are:

1. An optional double-clap trigger, implemented as a separate adapter that cannot steal the recognizer microphone or bypass permissions.
2. Read-only Monday task ingestion through Ella's server-side credential vault and connector permission checks.
3. Optional multi-monitor placement for user-confirmed desktop actions.
4. A local audio cache pattern, only where it supports an already-approved Ella TTS provider.

Do not copy JARVIS's cloud ElevenLabs default, Binance workflow, automatic external-app fan-out, or unlicensed source code into Ella.
