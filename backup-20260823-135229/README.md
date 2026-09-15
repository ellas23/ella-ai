Ella — Local voice assistant
=============================

Overview
--------
Ella is a local-first voice assistant that runs on Windows. It uses Vosk for speech recognition, local LLM glue (Ollama or other local LLMs), and Windows SAPI for speech output. This repository contains the local assistant scripts, sample Vosk model files, helper scripts, and launchers.

What’s in this repo
-------------------
- ella-ollama-female.mjs — main assistant logic (listener, prompt sanitizer, TTS gating)
- start-ella.cmd — Windows launcher that activates the Python venv and starts the assistant
- scripts/ — helper scripts (Python and PowerShell) for diagnostics and setup
- models/ — Vosk model files (large; may be stored elsewhere)
- ella_profile.json — assistant profile and settings

Prerequisites
-------------
- Windows 10/11 (recommended) with working microphone and speakers
- Python 3.11 (recommended) for Vosk/STT helpers
- Node.js (only if you use any local web UI built from other projects)

Recommended setup (Python venv)
-------------------------------
1. Open an elevated PowerShell or Command Prompt.
2. Create and activate a venv:
   python -m venv venv_coqui
   .\venv_coqui\Scripts\Activate
3. Upgrade pip and install core packages:
   python -m pip install --upgrade pip
   pip install vosk sounddevice

Notes about the Vosk model:
- The models/ directory can be large. It's recommended to store models in a release or use Git LFS rather than committing them to the repository if you plan to keep this repo small.
- If models are already committed and you want to move them out, create a release and delete the models/ folder from the repo (careful: removing files from history requires rewriting history).

Running Ella
-----------
- Start using the launcher: double-click start-ella.cmd or run it from PowerShell. The script sets up environment variables and starts the assistant using the repo's Python environment.
- The assistant listens for the wake word ("Ella", "hey Ella") and will sleep after ~5 minutes of inactivity. After 1 hour of inactivity it can say a short "Welcome back" message.
- To force a specific SAPI voice, set the environment variable FORCE_SAPI_VOICE before launching (example: FORCE_SAPI_VOICE="Microsoft Zira Desktop")

Common troubleshooting
----------------------
- If Ella responds to her own voice, ensure the TTS cooldown is in place and Vosk is not listening while TTS is active (the launcher and main script implement this by default).
- If Vosk cannot start, confirm you activated the correct Python venv and installed the `vosk` and `sounddevice` packages.
- Check start-ella.cmd and the PowerShell scripts in the repo for exact python paths used by the launcher.

Deployment and Vercel notes
---------------------------
- This repo is the local voice assistant (Windows-focused). The web/mobile Ella chat UI lives in the main Joyful Morning Blooms repo (or in the separate web UI repo if you exported it).
- Vercel is suitable for the web UI; the local voice assistant should remain a separate repo (this one) and is not a Vercel target.

Contributing
------------
- Please open issues or PRs against this repo for improvements. For large model files, consider attaching them as GitHub Releases or using Git LFS.

License
-------
MIT — customize as needed.

Contact
-------
If you need help running or deploying Ella, add details and open an issue on the repository or contact the maintainer.
