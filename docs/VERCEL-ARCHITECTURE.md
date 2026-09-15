# Ella and Bob Vercel architecture

## Responsibilities

- **Vercel:** permanent HTTPS web shell, dashboard assets, and a short-lived
  authenticated API proxy.
- **Windows PC:** authoritative Ella backend, Ollama, faster-whisper, TTS,
  memory, knowledge, lifecycle controls, Bob, and local files.
- **Raspberry Pi:** authenticated Ella research worker and visible Chromium
  research session.

Vercel must never run Ollama or attempt to own the Windows/Pi processes.
The Windows backend remains the source of truth for every status value.

## Bridge requirement

Vercel cannot reach `127.0.0.1` on the Windows PC. Configure
`ELLA_BRIDGE_URL` in Vercel to a stable HTTPS connector that forwards to the
Windows backend on port 3001. Do not expose port 3001 directly.

Recommended connector options:

1. A permanent Tailscale Funnel hostname for the Windows machine, restricted
   to the required HTTPS path and authenticated at the Ella backend.
2. A named Cloudflare Tunnel with a stable hostname. Do not use a Quick Tunnel
   URL or commit tunnel credentials.

The connector should forward to `http://127.0.0.1:3001` on Windows. Keep the
Windows firewall closed to unsolicited public TCP 3001 traffic.

## Vercel environment variables

- `ELLA_BRIDGE_URL`: stable HTTPS bridge URL, without a trailing slash.
- `ELLA_BRIDGE_TOKEN`: optional header forwarded to a connector/backend that is
  explicitly configured to enforce it. Store it only as a Vercel secret and in
  protected server configuration; never put it in browser JavaScript. The
  current Ella backend continues to rely on its existing admin session
  authentication unless a separate bridge-token check is added.

The proxy forwards the Ella admin session cookie, so the existing login flow
continues to protect administrative endpoints. `ELLA_BRIDGE_URL` is never
returned to the browser.

## Live updates

Vercel Functions are not a durable WebSocket host. The dashboard's existing
WebSocket remains useful on the local Windows dashboard. The public Vercel
dashboard uses the existing authenticated REST endpoints and its 15-second
polling loop for live overview, worker, research timeline, sources, and
telemetry data. This is live data from Windows/Pi, not cached placeholder
state.

## Local verification

Run the Windows backend normally, set `ELLA_BRIDGE_URL` to a reachable stable
HTTPS connector, then run:

```powershell
$env:ELLA_BRIDGE_URL = 'https://your-stable-bridge.example'
npx vercel dev
```

Verify login, `/api/ella/status`, `/api/admin/overview`, `/api/bob/status`,
`/api/admin/worker`, and a research task from the Vercel URL. Confirm the
returned research source records contain real URLs, visited timestamps,
extracted character counts, and Pi telemetry.

## Custom domain

Add the custom domain to the Vercel project later. No application code change
is required; the proxy and same-origin dashboard paths remain unchanged.
