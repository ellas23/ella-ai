# Ella — Two-Machine Setup

## Architecture (matches what you asked for)

```
                    MAIN PC
                 backend/server.js  <-- single source of truth
                       |
              WebSocket (LAN, port 3001)
                  /              \
            orb/ (Main PC     dashboard/ (Thinkpad
             same machine)     over the network)
```

The backend is the only thing that owns state (system stats, the connector
graph, the activity log, AI state). The orb and the dashboard are both just
*views* — neither one holds truth, they just render whatever the backend
broadcasts. That's what makes "gesture on the orb opens the network on the
Thinkpad" work: the orb doesn't touch the dashboard directly, it tells the
backend, and the backend tells every connected screen.

## Running it

### 1. On the Main PC — start the backend
```
cd backend
npm install
npm start
```
Leave this running. Note the LAN IP it prints (or run `ipconfig` yourself
and look for "IPv4 Address").

### Bob isolated browser session

Bob is a separate, localhost-only Node process with its own Chromium profile,
headless 1280x800 virtual screen, screenshot stream, navigation, mouse, and
keyboard input. It does not reuse Ella's desktop capture, browser profile,
process, or port.

Run `start-bob.cmd`, then open `http://127.0.0.1:3010/`. Set `BOB_CHROME_PATH`
if Chrome is installed in a non-standard location. `BOB_PROFILE_DIR` and
`BOB_CDP_PORT` can be changed when running another Bob instance. Bob is
intentionally browser-only; controlling arbitrary Windows applications needs a
separate Windows desktop/RDP/virtual-display session and is not provided by
this process.

### 2. On the Main PC — open the orb
Open `orb/index.html` directly in a browser, fullscreened (F11), or wrap it
in Electron like your existing `ella-app` project if you want it borderless/
always-on-top instead of a browser tab. `orb/orb-config.js` already points
at `localhost:3001` — no edit needed since it's the same machine.

### 3. On the Thinkpad — open the Command Center
Edit `dashboard/dashboard-config.js` and put the Main PC's real LAN IP in
place of `192.168.1.207`. Then open `dashboard/index.html` in a browser on
the Thinkpad. It'll show "DISCONNECTED — retrying..." until it reaches the
backend — if it never connects, check Windows Firewall isn't blocking port
3001 on the Main PC, and that both machines are on the same network.

## What's real right now (stages 1–4 from your spec)

- **Real system stats** — CPU/RAM read from the actual OS via Node's `os`
  module, streamed every 2s, live-graphed on the dashboard.
- **Real WebSocket two-way link** — not polling, not mocked. Orb state,
  voice transcripts, and gestures all flow through the backend to whatever's
  connected.
- **Real audio-reactive orb** — uses your actual microphone's amplitude via
  Web Audio's AnalyserNode. Rotation speed, glow, and particle spread all
  scale with `audioLevel`, not a canned animation.
- **Real hand-pinch detection** — MediaPipe Hands tracks actual finger
  landmarks (thumb tip to index tip distance), not a hand blob. A pinch +
  pull toward the camera sends `GESTURE_ZOOM` to the backend, which flashes
  the network panel on the Thinkpad.
- **Data-driven connector graph** — nodes/edges are a real JSON structure
  (`backend/connectors.seed.json`), not hardcoded HTML. Add/remove a
  connector and the graph updates on every connected screen live.
- **Voice loop** — wake word detection, transcript capture, and spoken
  response via the browser's built-in speech recognition + `SpeechSynthesis`.

## What's still a stub — be honest with yourself about these

- **Intent detection / actual AI** — `orb.js`'s `handleCommand`-equivalent
  currently just echoes back `"Got it: <what you said>"`. Nothing routes to
  a real language model or actually reads your Gmail yet. That's stage 6+
  in your own plan — wire one connector (Gmail) at a time once this
  skeleton is stable, don't add 6 connectors at once.
- **Credential storage** — the "Add Connector" modal only registers a node
  name; it does not collect or store passwords/API keys anywhere, on
  purpose. When you're ready to add real secrets, do it server-side only
  (e.g. the encrypted-vault pattern from your Electron app), never in
  `dashboard.js` or `orb.js` — both run in a browser context anyone at your
  keyboard can open dev tools on.
- **Browser tab control, email send/read, Discord, Spotify** — not
  implemented. These need actual OAuth + provider SDKs on the backend, one
  at a time, per your own stage 6 note.
- **Permissions enforcement** — the graph has a `status` field but nothing
  currently checks "does this connector have SEND_EMAIL permission" before
  acting, because nothing acts yet. Add that check inside
  `RUN_ALLOWED_ACTION` in `server.js` once a real connector exists to guard.

## Next reasonable step

Pick ONE thing from the stub list — I'd suggest wiring `RUN_ALLOWED_ACTION`
in `server.js` to actually call something real (even something simple, like
toggling a value) so you can see the full loop — voice → backend → action →
dashboard event — work end to end before adding Gmail/Discord/etc on top.
