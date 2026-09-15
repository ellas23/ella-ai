# JARVIS Feature Checklist

Legend:

- **FOUND** - materially implemented in the audited JARVIS project
- **ABSENT** - requested category was inspected but not present
- **ELLA** - Ella already provides the capability or a stronger equivalent
- **OPTIONAL** - only consider as a permissioned integration

## VOICE

- [x] FOUND - Double-clap acoustic trigger (`jarvis.py`)
- [x] FOUND - Adaptive noise floor, threshold, cooldown, and retrigger gate
- [x] FOUND - Microphone enumeration, probe, default fallback, and name/index override
- [ ] ABSENT - Wake-word recognition
- [ ] ABSENT - Speech recognition/transcription
- [ ] ABSENT - Voice activity detection as speech VAD
- [ ] ABSENT - Interruption/barge-in
- [x] FOUND - Optional ElevenLabs text-to-speech welcome
- [x] FOUND - PCM playback and local WAV cache
- [ ] ABSENT - Streaming speech
- [ ] ABSENT - Voice command parsing
- [ ] ABSENT - Dictation
- [ ] ABSENT - Local/offline TTS
- [x] ELLA - Ella already has Faster-Whisper, VAD/wake configuration, and local TTS

## AI/BRAIN

- [ ] ABSENT - Conversational context
- [ ] ABSENT - Model routing
- [ ] ABSENT - Fast/deep model selection
- [ ] ABSENT - Tool calling
- [ ] ABSENT - Task planning
- [ ] ABSENT - Reasoning/research
- [ ] ABSENT - Hallucination filtering
- [ ] ABSENT - Follow-up conversations
- [x] ELLA - Ella's Ollama/qwen2.5:14b setup and conversation/task surfaces remain primary

## MEMORY

- [ ] ABSENT - Short-term memory
- [ ] ABSENT - Long-term memory
- [ ] ABSENT - Searchable memory
- [ ] ABSENT - Memory viewer
- [ ] ABSENT - Knowledge graph
- [ ] ABSENT - Automatic memory extraction
- [ ] ABSENT - Memory editing/deleting
- [x] ELLA - Ella has local memory, knowledge, graph, and dashboard surfaces

## COMPUTER CONTROL

- [x] FOUND - Open Spotify/YouTube URL
- [x] FOUND - Open Claude URL in Chrome
- [x] FOUND - Open Binance BTC URL in Chrome
- [x] FOUND - Focus/launch Cursor
- [x] FOUND - Chrome monitor selection, sizing, snapping, and fullscreen
- [x] FOUND - Cursor F11 fullscreen
- [ ] ABSENT - General keyboard/mouse actions
- [ ] ABSENT - Browser DOM automation
- [ ] ABSENT - Screenshots
- [ ] ABSENT - OCR
- [ ] ABSENT - Reading the screen
- [ ] ABSENT - File operations
- [ ] ABSENT - Shell/terminal commands
- [x] ELLA - Ella has allowlisted PC actions and Bob/browser controls; preserve their safety model

## WEB

- [x] FOUND - Open configured URLs
- [x] FOUND - Read-only Monday.com GraphQL task query
- [ ] ABSENT - Web search
- [ ] ABSENT - Page reading/parsing
- [ ] ABSENT - Research pipeline
- [ ] ABSENT - Summarization
- [ ] ABSENT - Weather
- [ ] ABSENT - Location/time
- [x] ELLA - Ella's HTTP -> BeautifulSoup -> Selenium -> PyAutoGUI research pipeline is broader

## COMMUNICATION

- [ ] ABSENT - Email
- [ ] ABSENT - Calendar
- [ ] ABSENT - Contacts
- [ ] ABSENT - Notifications
- [x] OPTIONAL - Monday task reading is a work-management connector, not a communication feature

## TOOLS/INTEGRATIONS

- [x] FOUND - Monday GraphQL integration
- [x] FOUND - ElevenLabs integration
- [x] FOUND - Spotify/YouTube URL integration
- [x] FOUND - Claude URL integration
- [x] FOUND - Binance URL integration
- [x] FOUND - Cursor integration
- [ ] ABSENT - MCP
- [ ] ABSENT - Plugins
- [ ] ABSENT - General external-tool registry
- [ ] ABSENT - Smart-home integrations
- [x] ELLA - Ella has existing research, worker, SSH, Apple Watch, Bob, and local control integrations

## UI

- [ ] ABSENT - Dashboard
- [ ] ABSENT - Orb/visualizer
- [ ] ABSENT - Status indicators
- [ ] ABSENT - Conversation history
- [ ] ABSENT - Settings
- [ ] ABSENT - Notifications
- [ ] ABSENT - Mobile interface
- [ ] ABSENT - PWA/installable interface
- [x] ELLA - Ella already has these UI/service surfaces

## SYSTEM

- [x] FOUND - Manual startup with `python jarvis.py`
- [x] FOUND - Ctrl+C shutdown
- [x] FOUND - Console logging
- [x] FOUND - Exception handling and fatal audio exit status
- [x] FOUND - `.env` configuration
- [ ] ABSENT - Health monitoring
- [ ] ABSENT - HTTP status endpoint
- [ ] ABSENT - Restart API
- [ ] ABSENT - Automatic updates
- [ ] ABSENT - Windows background service
- [x] ELLA - Ella has lifecycle, health, logs, and single-stack startup controls

## INSTALLATION

- [x] FOUND - `requirements.txt`
- [x] FOUND - Manual setup instructions
- [x] FOUND - Manual `.env` configuration
- [ ] ABSENT - Prerequisite checker
- [ ] ABSENT - Installer
- [ ] ABSENT - First-run setup
- [ ] ABSENT - Configuration wizard
- [ ] ABSENT - Model setup
- [ ] ABSENT - Uninstall/update process
- [x] ELLA - Ella has substantially more startup/dependency/configuration infrastructure

## Prioritization summary

1. **P0:** No JARVIS feature is required to keep Ella functional. Preserve Ella's current local voice, Ollama, memory, research, auth, and lifecycle behavior.
2. **P1:** An opt-in double-clap trigger could be useful if it shares Ella's existing audio ownership and permission model.
3. **P1:** A read-only Monday adapter could be useful if implemented through Ella's existing server-side connector/vault model.
4. **P2:** Multi-monitor placement and Cursor focus could improve a manually invoked desktop workflow.
5. **P3:** ElevenLabs cloud TTS, Binance page opening, and automatic multi-application sequences are experimental or not recommended by default.
