# Ella Master Feature Plan

This is a planning document only. No application feature is being implemented as part of the JARVIS audit. Ella remains the main project, architecture, name, personality, Ollama setup, and command surface.

## Prioritized additions

| Priority | Proposed feature | What it adds | Code areas | Dependencies | Risks | Testing | Local/cloud | Optional |
|---|---|---|---|---|---|---|---|---|
| P0 | Production installer/prerequisite checker | Repeatable Windows setup, validation, repair, and uninstall | New installer project; existing `start-*.ps1`, `requirements.txt`, `package.json` | WiX/Inno Setup or MSIX decision; no runtime cloud dependency | Installer could expose secrets or start duplicates | Clean VM, upgrade, repair, uninstall, rollback | Local | Yes for startup-at-login |
| P0 | Single-instance service supervisor | Guarantees one backend, one voice process, one Bob process, and one approved bridge | Existing lifecycle scripts and status APIs | Windows process/service primitives | Killing an unrelated process is unsafe | PID ownership, stale PID, crash/restart, reboot | Local | No |
| P0 | Configuration and secrets wizard | Validates Ollama, voice devices, model paths, and secret storage without exposing secrets | Existing runtime config/vault plus new setup UI | DPAPI; Ollama local API | Plaintext leakage or accidental overwrite | Permissions, redaction, invalid config, recovery | Local | Yes |
| P1 | Optional double-clap trigger | Adds JARVIS's acoustic gesture as a second trigger | New adapter around Ella audio ownership; dashboard setting | Existing `sounddevice`/recognizer or a coordinated capture path | Mic contention and accidental actions | Quiet/noisy room, false positives, cooldown, disabled mode | Local | Yes |
| P1 | Monday read-only connector | Shows board tasks in Ella research/dashboard context | Server connector, vault, dashboard status, audit log | Monday GraphQL and token | Token scope, stale data, provider outage | Mock API, no-token, revoked-token, rate/error handling | Cloud provider with local proxy | Yes |
| P1 | Permissioned desktop action plans | Presents a preview and confirmation before opening apps/URLs or moving windows | Existing PC-control allowlist and confirmation IDs | Windows APIs only | Global focus/keyboard side effects | Deny, cancel, timeout, audit, multi-monitor | Local | Yes |
| P1 | Unified capability health model | One status schema for Ollama, Whisper, TTS, research, Bob, bridge, and worker | `server.js`, dashboard, startup scripts | Existing probes | Stale/false-ready state | Failure injection and freshness tests | Local | No |
| P2 | Local TTS cache | Avoids repeated synthesis and improves startup/offline behavior | Existing TTS path and data directory | WAV/audio libraries already available | Stale/private audio retention | Cache key, corruption, cleanup, permissions | Local | Yes |
| P2 | Evidence-backed action/research summaries | Better distinction between observed facts, model inference, and unavailable data | Research worker, timeline, dashboard | Existing BeautifulSoup/Selenium pipeline | Overconfidence if evidence metadata is lost | Source provenance and unavailable-service cases | Local-first | Yes |
| P2 | Multi-monitor dashboard/orb layout | Lets user choose monitor and window behavior without global F11 side effects | Orb/dashboard launcher and PC control | Win32 only | Resolution/scaling issues | 1–4 monitors, DPI, disconnected monitor | Local | Yes |
| P3 | Optional cloud voice providers | Adds ElevenLabs-like quality for users who explicitly opt in | TTS provider interface | Provider SDK/API key | Privacy, cost, outage, secret handling | No-key local fallback and redaction | Cloud optional | Yes |
| P3 | Automatic update channel | Signed versioned updates with rollback | Installer/update service | Signing/distribution strategy | Supply-chain risk | Signature failure, interrupted update, rollback | Cloud distribution, local verification | Yes |

## Architecture rules

- Keep Ollama and current Ella model configuration as the default local brain.
- Keep Faster-Whisper `medium.en`, local TTS, memory, research, and lifecycle behavior intact.
- Add adapters behind interfaces rather than replacing existing modules.
- Route all external credentials through the server-side vault or Windows DPAPI; never browser JavaScript.
- Require explicit permission for desktop, browser, financial, communication, and destructive actions.
- Expose feature flags in runtime configuration and show enabled/disabled state in the dashboard.
- Every background capability must have a health probe, timeout, cancellation path, cleanup path, and audit event.
- Do not use JARVIS source code unless a valid license or author permission is obtained.

## Suggested implementation order after approval

1. Capture baseline tests and a clean Ella service inventory.
2. Build installer/prerequisite design and single-instance supervisor.
3. Build the configuration/secrets wizard.
4. Normalize capability health and dashboard status.
5. Add the optional double-clap adapter without changing the current recognizer.
6. Add the read-only Monday connector.
7. Add permissioned desktop action plans and multi-monitor behavior.
8. Add local TTS caching and evidence metadata.
9. Consider optional cloud voice providers and signed updates only after local paths are stable.
