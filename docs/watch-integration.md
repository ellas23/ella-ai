Overview
========
This document explains how to connect an Apple Watch (watchOS) to Ella running on your Main PC. The recommended architecture is a watchOS app + iOS companion: the watch records or streams audio and sends control commands to the iPhone; the iPhone forwards them to your PC's Ella backend via REST calls.

Requirements
------------
- iPhone paired with the Apple Watch
- Ella backend reachable from the iPhone through the current HTTPS URL in `%USERPROFILE%\.ella\ella-public-url.txt`
- A dedicated Watch bearer token configured in `%USERPROFILE%\.ella\watch.env`

Server endpoints (added to server.js)
------------------------------------
- POST /api/watch/command
  - JSON body: { command: 'start'|'stop'|'lock'|'open', args?: { url?: string } }
  - Auth: `Authorization: Bearer <watch-token>`; this is separate from the Ella admin password
  - Effect: starts/stops/locks the host or opens a URL and broadcasts an event to connected clients

- POST /api/watch/audio
  - JSON body: { filename?: string, data: '<base64 WAV/PCM>' }
  - Auth: same token rules
  - Effect: saves audio to a temporary file and broadcasts a WATCH_AUDIO event (connected clients may process it)

Security
--------
- Watch routes are not protected by the Ella dashboard session because the Shortcut cannot use the dashboard login flow. They remain protected by the separate Watch bearer token and never accept the admin password. Without the Watch token they reject requests with `401`/`503`.
- Cloudflare Quick Tunnel hostnames are temporary. Update the Shortcut URL to the current URL file value after a tunnel restart. A stable hostname requires a named Cloudflare Tunnel and a domain.

iOS/watchOS companion flow (high level)
---------------------------------------
1. The watch app records short audio (or uses the microphone) and sends it to the paired iPhone via WatchConnectivity (transferUserInfo / transferFile / sendMessage).
2. The iPhone companion receives the audio and forwards it to the Ella backend (POST /api/watch/audio) and/or sends command POST /api/watch/command with the token.
3. The Ella backend saves the audio, broadcasts WATCH_AUDIO to connected dashboards/orb; the orb can then run recognition on that audio (or the hub will accept it for processing).

Notes
-----
- watchOS apps have limitations on background execution and network: delegating network work to the iPhone companion yields more reliable uploads.
- For live streaming (low-latency), the watch->iPhone->server pipeline should use small chunks, but the initial implementation described here uses single-file uploads for simplicity.

Next steps (I can implement for you)
------------------------------------
- Provide a sample Xcode project skeleton (watchOS + iOS) with code to record audio on the watch, send it to the iPhone, and forward to the Ella backend.
- Add an iOS app that can also package a signed token and store the host URL so the watch user can tap to Start/Stop.

Which of the above would you like next?
