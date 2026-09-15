# Optional OpenVoiceOS integration

Ella keeps its existing Windows voice pipeline as the authoritative voice path:

`wake word -> faster-whisper/Vosk -> Ella command router -> Ollama/actions -> SAPI TTS`

OpenVoiceOS (OVOS) was evaluated as an optional Linux/Pi voice satellite. OVOS is
Apache-2.0 licensed and modular, while `ovos-installer` is intended for Linux
machines and Raspberry Pi deployments. Rhasspy was not selected as a core because
its original repository is archived. Home Assistant Assist is a useful reference
for local voice routing, but it would duplicate Ella's command and device layers.

## Current decision

OVOS is **not installed yet**. The Pi is currently unavailable/not flashed, and
installing Linux services on Windows would not be a valid integration. Ella's
existing faster-whisper, wake-word, Ollama, and Windows SAPI components remain
unchanged.

## Safe installation plan

After the Pi is restored and reachable, install OVOS in its own Linux virtual
environment or dedicated OVOS image. Do not replace `ella-worker` or Ella's
authenticated worker protocol. Configure OVOS as a voice satellite that forwards
recognized utterances to Ella's authenticated command endpoint. Keep:

- OVOS audio and wake-word services on the Pi;
- Ella command interpretation and allowlists on the Windows backend;
- Ollama private on the Windows machine;
- Watch, Mac, PC, and Pi credentials outside project files;
- a feature flag so the OVOS adapter can be disabled without affecting Ella.

The integration is deliberately deferred until the target Pi OS, network address,
audio devices, and authenticated endpoint are available for a real installation
and end-to-end microphone/speaker test.
