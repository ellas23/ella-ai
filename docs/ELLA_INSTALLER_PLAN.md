# Ella Windows Installer Plan

This document designs a future installer only. It does not build an installer or change Ella's application files.

## Goals

The installer should produce a repeatable local-first Windows installation while preserving Ella's current project layout, Ollama usage, Faster-Whisper model, TTS, dashboard, authentication, Bob isolation, and lifecycle scripts.

## Proposed flow

### 1. Bootstrap and prerequisites

1. Detect Windows architecture, supported Windows version, free disk space, microphone/output devices, and an existing Ella installation.
2. Detect Node.js and a supported Python runtime; offer installation only with explicit user consent.
3. Detect Ollama and verify that the local API responds.
4. Detect required Visual C++/audio runtime prerequisites if the selected Python audio stack needs them.
5. Never display or log secret values.

### 2. Python/Node/dependency check

- Run `npm ci` from the locked Ella package manifest.
- Create or reuse the project Python environment.
- Install the pinned/compatible entries from `requirements.txt`.
- Verify imports for Faster-Whisper, NumPy, sounddevice, BeautifulSoup4, Selenium, and PyAutoGUI.
- Record versions in a redacted installation report.
- Fail clearly on missing packages rather than silently degrading.

### 3. Ollama and model setup

- Query the local Ollama API.
- Verify the configured Ella model, currently `qwen2.5:14b`, is installed.
- Offer an explicit local model download if it is missing.
- Never send the Ollama endpoint, model data, admin password, or tokens to a cloud installer service.
- Keep the model choice in Ella runtime configuration and preserve existing conversations.

### 4. Voice setup

- Enumerate microphone and speaker devices.
- Offer a short local microphone test and TTS test.
- Verify the local Faster-Whisper `medium.en` model directory.
- Allow a user-selected audio device and save only non-secret device metadata.
- Do not require ElevenLabs; local TTS remains the default.

### 5. Configuration wizard

Wizard pages:

1. Installation directory and existing-data migration
2. Ollama/model check
3. Microphone/speaker check
4. Ella voice and personality settings
5. Optional research/browser capability enablement
6. Optional Bob enablement
7. Optional remote access/bridge setup
8. Admin password creation or secure import
9. Review and apply

Passwords, tokens, bridge secrets, and OAuth credentials must be entered into a secure native prompt and written only to Windows-protected storage/DPAPI-backed files with restrictive ACLs. They must not be written into installer logs, browser JavaScript, command-line arguments, telemetry, or the installer package.

### 6. Ella service setup

Prefer a single controlled supervisor/service entry point that starts the existing canonical scripts and records owned process IDs. It must:

- prevent duplicate listeners on ports 3001, 3010, and other configured ports
- start the backend before dependent voice/worker processes
- wait for authenticated health/readiness checks
- stop only processes owned by Ella
- expose clear status and logs
- recover from crashes without spawning copies

Windows startup should be opt-in and clearly visible in the wizard.

### 7. Dashboard and shortcut

- Create a Start Menu shortcut and optional desktop shortcut to the local authenticated dashboard.
- Set the working directory explicitly to the installed Ella root.
- Do not place the admin password in shortcut arguments.
- If remote access is enabled, show the user the public URL without revealing bridge tokens.
- Keep dashboard authentication mandatory.

### 8. Updates

- Publish signed versioned installer packages.
- Verify signatures before applying updates.
- Preserve `data/`, model directories, vault files, and user configuration.
- Stop owned services, apply an atomic update, run readiness checks, and roll back on failure.
- Never overwrite user data without a migration/version step.

### 9. Uninstall

Offer separate choices:

- remove application binaries and dependencies
- preserve user data, conversations, models, and vault
- remove all Ella data and secrets after explicit confirmation
- remove startup entries, services, shortcuts, and bridge configuration

The uninstaller must not delete arbitrary user files or external project folders.

## Installer security requirements

- No API key, password, cookie, token, or private configuration in browser-visible files.
- No secrets in process command lines.
- Redact secrets from logs and crash reports.
- Use restrictive ACLs and DPAPI for local credentials.
- Validate paths before migration/deletion.
- Use code signing and signed update manifests.
- Require explicit confirmation for destructive actions.
- Keep external integrations disabled unless the user enables them.

## Verification matrix

Before release, test:

1. Clean Windows install with no Node/Python/Ollama
2. Existing Ella upgrade with conversations and models
3. Missing Ollama/model
4. Missing microphone/speaker
5. Offline installation and offline operation
6. Wrong admin password and session persistence
7. Crash/restart and duplicate-process prevention
8. Medium.en recognizer load
9. Dashboard local and authenticated remote access
10. Bob enabled/disabled isolation
11. Update interruption and rollback
12. Uninstall with preserve-data and remove-data paths

## Recommended technology decision

Choose a signed native Windows installer technology after a small prototype validates service installation, per-user data paths, elevation boundaries, and rollback. Keep the installer thin: it should provision prerequisites and launch the existing Ella architecture, not duplicate assistant logic or become a second backend.
