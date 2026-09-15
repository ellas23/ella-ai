# JARVIS Feature Audit

## Scope and project identity

Audited project:

`C:\Users\Darbe\OneDrive\Desktop\ella-ai-main\jarvis-main\jarvis-main`

The project contains six tracked/runtime-relevant files:

- `jarvis.py` - the complete runtime
- `README.md` - setup, environment variables, tuning, and troubleshooting
- `requirements.txt` - Python dependencies
- `.gitignore`
- `__pycache__/` - generated Python cache

There is no installer, service definition, frontend, backend API, database, plugin manifest, mobile client, or license file in this project. The repository is therefore audited as a focused Windows desktop audio-trigger utility, not as a complete general-purpose assistant.

## License and reuse conclusion

No `LICENSE`, `COPYING`, SPDX header, or third-party attribution file was found in the JARVIS project. `README.md` identifies the project as a local script but does not grant a reuse license. Ella should not copy JARVIS source code into the product until the original author/license is confirmed. The safe approach is to implement equivalent behavior independently from the documented behavior, while separately complying with the licenses of dependencies.

## Concrete JARVIS features

| # | Feature name | What it does | Relevant JARVIS files | Dependencies | APIs/services | Local/offline | Account/key | Windows | Ella equivalent | Difficulty | Conflicts | Recommended approach |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Double-clap detection | Reads mono microphone blocks, tracks an adaptive noise floor, detects two transients within `0.05–0.35s`, debounces retriggers, and runs the welcome sequence once per process. | `jarvis.py`: constants, `rms_mono`, `main` | `numpy`, `sounddevice`, PortAudio | Windows/default microphone | Yes | No | Yes | Ella has wake-word/VAD and a voice loop, but not this exact acoustic gesture | Easy to add | Could trigger Ella unexpectedly or compete with its microphone | Add as an opt-in trigger adapter with cooldown, ownership of the mic, and a dashboard toggle; do not replace wake-word recognition |
| 2 | Microphone discovery and fallback | Probes the configured/default input, auto-selects the loudest working input when the default is silent, supports index/name selection, and logs failures. | `jarvis.py`: `_input_devices`, `_resolve_input_device_index`, `_probe_input_max_rms`, `_choose_input_device` | `sounddevice` | PortAudio device enumeration | Yes | No | Yes | Ella selects its configured speech input through its recognizer process | Easy to add | Two processes probing/owning the same mic can cause conflicts | Reuse the policy concept in Ella's existing recognizer startup, not the code |
| 3 | Spotify/YouTube launch | Opens a configured URI after the trigger using `os.startfile` on Windows or `webbrowser` elsewhere. | `jarvis.py`: `SONG_URI`, `play_song` | Python standard library | Spotify or YouTube URL | Partly; opening is local, playback is external | Usually account for private content | Yes | Ella has no equivalent trigger action | Easy to add | Could open external content without explicit user intent | Make it an explicit, allowlisted, confirmation-gated action |
| 4 | Claude browser launch | Opens a configurable Claude URL in Chrome, with a new window, monitor selection, sizing, and optional fullscreen. | `jarvis.py`: `open_claude_in_chrome`, Chrome helpers | Python standard library; Windows APIs via `ctypes` | Chrome; `claude.ai` | Browser launch local; service is cloud | Claude account may be required | Yes | Ella has browser research/Selenium/PyAutoGUI, but no fixed Claude launcher | Easy to add | External cloud dependency and credential/profile exposure | Keep as an optional user action; never embed credentials or automate login |
| 5 | Binance BTC page launch | Opens an allowlisted/configurable BTC trading URL in Chrome on a chosen monitor. | `jarvis.py`: `open_binance_btc_in_chrome` | Python standard library; Windows APIs via `ctypes` | Chrome; Binance | Browser launch local; service is external | Account may be required | Yes | Ella has no equivalent trading-page launcher | Easy to add technically | High safety/financial risk; accidental launch could be interpreted as trading | Do not add by default; if retained, open-only, no trading actions, explicit confirmation and visible audit |
| 6 | Monday.com task fetch | Queries a board with GraphQL, reads item names/status/priority, appends up to five task names to the welcome phrase, and can open the board URL. | `jarvis.py`: `monday_env_config`, `_monday_graphql`, `fetch_monday_tasks`, `_open_monday_board_in_browser`, `run_double_clap_actions` | Python standard library; `python-dotenv` | `https://api.monday.com/v2` | No | `MONDAY_API_TOKEN`; board ID; optional board URL | Yes | Ella has task/automation surfaces but no Monday provider implementation | Needs adaptation | Credential handling, provider permissions, and unrelated trigger semantics | Integrate through Ella's server-side connector/vault and read-only task adapter; never put token in browser code |
| 7 | ElevenLabs welcome TTS | Generates a configured welcome phrase through ElevenLabs, receives PCM audio, converts to NumPy samples, and plays it. | `jarvis.py`: `elevenlabs_env_config`, `say_jarvis_welcome` | `elevenlabs`, `numpy`, `sounddevice` | ElevenLabs API | No | `ELEVENLABS_API_KEY`, voice ID | Yes | Ella already has local TTS/SAPI and voice configuration | Not recommended as default; adaptation possible | Replaces/duplicates local TTS and sends text to a cloud provider | Preserve Ella's local TTS. Add ElevenLabs only as an optional provider behind explicit privacy and configuration controls |
| 8 | TTS audio cache | Hashes phrase/voice/model/format, stores a WAV under `.cache/jarvis_welcome`, replays it without another API call, and writes atomically through a temporary file. | `jarvis.py`: `_jarvis_welcome_cache_dir`, `_jarvis_welcome_cache_path`, `_save_pcm_wav_file`, `_play_pcm_wav_file` | Python standard library, `numpy`, `sounddevice` | Local filesystem/audio device | Yes after first generation | Initial cloud key required if cache is empty | Yes | Ella has runtime state and local files, but no equivalent provider cache | Easy to adapt | Cached audio may contain private text and can become stale | Use an opt-in, content-addressed local cache only for explicitly enabled providers; enforce permissions and retention |
| 9 | Cursor focus/launch | Finds Cursor, focuses the largest existing window, or launches it; optionally opens a new window. | `jarvis.py`: `_cursor_executable`, window helpers, `open_cursor_window` | Python standard library; Windows `ctypes` | Cursor executable/window manager | Yes | No | Windows-specific | Ella has local coding-task controls but does not use this trigger flow | Easy to add | Focus/keyboard actions are intrusive and can steal user input | Expose as a manual/allowlisted desktop action, not an automatic microphone side effect |
| 10 | Multi-monitor window placement | Enumerates monitors, selects a monitor, sizes Chrome, snaps a new Chrome window, and sends F11 for fullscreen. | `jarvis.py`: `_win32_sorted_monitor_rects`, `_chrome_monitor_bounds`, `_chrome_snap_window_to_monitor_win32` | Python standard library; Windows `ctypes` | Win32 user32/kernel32 | Yes | No | Windows-specific | Ella has browser and desktop viewer controls but not this exact placement helper | Needs adaptation | Window focus and F11 are global desktop actions | Implement only behind explicit desktop-control permission and test with multiple monitor layouts |
| 11 | Ordered welcome sequence | Runs song, browser pages, Monday read, delayed TTS, and Cursor in a background thread so mic capture is not blocked; sequence runs once per process. | `jarvis.py`: `run_double_clap_actions`, `main` | All above | Multiple local/external services | Mixed | Depends on enabled integrations | Yes | Ella has lifecycle/action coordination and activity logs | Needs adaptation | Sequencing can create many side effects from one accidental trigger | Convert into a planned, previewable action list with per-action permissions and cancellation |
| 12 | Environment-driven configuration | Loads `.env`, supports service URLs, model/voice/monitor/window settings, input device, cache directory, and feature flags without editing code. | `README.md`, `jarvis.py`: `load_dotenv`, environment helpers | `python-dotenv` | None beyond configured services | Yes | Secrets are environment-held but still need secure storage | Yes | Ella has runtime JSON, env files, vault, and dashboard settings | Already exists in stronger form | Duplicate sources of truth could cause drift | Map approved settings into Ella runtime config/vault; do not add a second configuration system |
| 13 | Structured logging and graceful failures | Uses Python logging, warns on missing optional providers, handles PortAudio/OSError/API failures, and exits with a nonzero status for fatal audio setup failures. | `jarvis.py`: logging setup, exception handling | Python standard library | None | Yes | No | Yes | Ella has logs, health checks, and error/status APIs | Already exists in stronger form | A separate process can hide errors from Ella | If integrated, report events through Ella's existing lifecycle/logging APIs |
| 14 | Cached playback format validation | Validates cached WAV channel count/sample width, converts signed 16-bit PCM to float samples, and rejects empty/invalid audio. | `jarvis.py`: `_play_pcm_wav_file` | `wave`, `numpy`, `sounddevice` | Local audio output | Yes | No | Yes | Ella's TTS pipeline already owns audio output | Easy to reuse conceptually | Competing audio playback and device ownership | Keep validation pattern but use Ella's existing TTS output path |

## Checklist by requested area

### VOICE

| Requested capability | JARVIS finding | Ella status | Recommendation |
|---|---|---|---|
| Wake word | No wake-word model; double clap is the trigger | Exists | Keep Ella wake word |
| Speech recognition | No speech recognition; only RMS microphone analysis | Exists via Faster-Whisper | No JARVIS code needed |
| Voice activity detection | No VAD; adaptive noise gate for clap detection only | Exists/configured | Keep Ella VAD |
| Interruption/barge-in | Not present | Partial/voice-loop dependent | Not sourced from JARVIS |
| Text-to-speech | Optional ElevenLabs cloud welcome speech | Local TTS already exists | Keep local Ella TTS; optional provider only |
| Streaming speech | Not present; waits for complete TTS bytes | Ella has response/voice pipeline | No JARVIS feature |
| Voice commands | No spoken command parser; one acoustic trigger | Ella has command routing | Preserve Ella |
| Dictation | Not present | Existing transcript path | Preserve Ella |

### AI/BRAIN

All requested AI/brain features (context, routing, fast/deep selection, tool calling, planning, reasoning/research, hallucination filtering, follow-up conversations) are **not implemented in JARVIS**. Ella's Ollama setup, commands, research, and conversation state remain authoritative.

### MEMORY

JARVIS has no short-term memory, long-term memory, searchable memory, viewer, graph, automatic extraction, or editing/deleting system. Ella already has these surfaces in its local data/dashboard implementation.

### COMPUTER CONTROL

JARVIS provides application launch/opening for URLs, Cursor focus/launch, Chrome window movement/sizing/fullscreen, and keyboard F11 through Win32. It has no general keyboard/mouse automation, OCR, screenshot reading, file operations, or shell/terminal command system. Ella already has broader allowlisted PC control and Bob browser controls; JARVIS should not be copied as an unrestricted control layer.

### WEB

JARVIS opens URLs and performs one read-only Monday GraphQL query. It does not perform web search, page parsing, research, summarization, weather, or location/time lookup. Ella's HTTP/BeautifulSoup/Selenium/PyAutoGUI research pipeline is broader.

### COMMUNICATION

No email, calendar, contacts, or notifications are implemented. Monday task reading is a work-management integration, not a communication system.

### TOOLS/INTEGRATIONS

Concrete integrations are Spotify/YouTube URL opening, Chrome, Claude URL opening, Binance URL opening, Cursor, Monday GraphQL, and ElevenLabs TTS. No MCP, plugin framework, general external-tool registry, or smart-home integration is present.

### UI

No dashboard, orb, visualizer, status UI, history UI, settings UI, notifications UI, mobile interface, or PWA is present. JARVIS uses console logs only.

### SYSTEM

There is process-local startup (`python jarvis.py`), Ctrl+C shutdown, logging, exception handling, and environment configuration. There is no service manager, health endpoint, restart/shutdown API, automatic update system, or background service registration.

### INSTALLATION

Installation is `pip install -r requirements.txt`; configuration is a manually created `.env`; there is no installer, first-run wizard, prerequisite/model setup, update, or uninstall process.

## Dependency and license notes

Direct dependencies:

- `numpy` - numerical RMS/PCM processing
- `sounddevice` - microphone capture and playback; depends on PortAudio
- `elevenlabs` - optional cloud TTS
- `websockets` - declared but no material use was found in the audited runtime
- `python-dotenv` - `.env` loading

Ella already has local equivalents for microphone/audio, Faster-Whisper, TTS, configuration, logging, dashboard, and lifecycle. No JARVIS dependency should be added without a demonstrated gap. The missing JARVIS license is the principal code-reuse blocker.
