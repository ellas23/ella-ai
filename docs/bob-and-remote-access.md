# Bob isolation and secure remote access

## Bob boundary

Bob runs as a separate Node process through `bob-supervisor.js` or
`start-bob.cmd`. His friend-facing website is served directly from port 3010;
Ella starts, stops, restarts, monitors, and communicates with Bob through
separate administrative routes protected by a random process-local bearer
token.

Bob receives a minimal environment, a separate data directory, a separate
browser profile, and a conversational chat route plus optional web/browser
tool routes. Normal chat does not require web access. Bob does not receive Ella's
memory directory, device registry, SSH credentials, Watch token, worker
configuration, Minecraft integration, Mac viewer token, or vault path.

Bob's persistent files are under `%USERPROFILE%\.ella\bob` by default:

- `conversation.json`
- `activity.json`
- `browser\`

The normal conversation API is `POST /api/bob/chat` with `message` and
`conversationId`. Bob uses his configured local Ollama model and stores only
his own conversation history. Web research remains a separate optional task
route.

The Ella dashboard is the management surface only; it does not embed Bob's
conversation UI. Bob's standalone chat is available at `http://<host>:3010/`.
Only the public chat/status routes are unauthenticated; supervisor, browser,
task, history, and configuration routes remain protected.

## Free temporary public access

Cloudflared is supported through the included scripts:

1. Run `start-bob-public.cmd`.
2. Read the temporary `https://*.trycloudflare.com` URL from
   `%TEMP%\ella-bob\tunnel.log`.
3. Share that URL with the friend.
4. Run `stop-bob-public.cmd` when finished.

The tunnel forwards only `127.0.0.1:3010`. Ollama (`11434`), Ella (`3001`),
the CDP port, and supervisor routes are not forwarded. Quick Tunnel URLs are
temporary and change when restarted; a persistent named tunnel requires a
Cloudflare account and should keep its credentials outside this repository.

## Ella remote admin dashboard

Ella has a separate Quick Tunnel and never binds its backend publicly:

1. Run `start-ella-public.cmd`.
2. Open the printed `https://*.trycloudflare.com` URL on the phone.
3. Enter the admin password stored in `%USERPROFILE%\.ella\ella-admin.env`.
4. Run `stop-ella-public.cmd` when finished. This stops only Ella's tunnel;
   Ella itself continues running locally.

The admin password is used only to create an HTTP-only dashboard session. It is
not embedded in dashboard HTML or JavaScript. Ella forwards only
`127.0.0.1:3001`; Ollama, Bob's supervisor API, and Bob's tunnel are separate.
The Quick Tunnel URL is temporary and changes when restarted. The supervisor
automatically restarts `cloudflared` after an exit and writes the current URL
to `%USERPROFILE%\.ella\ella-public-url.txt`.

## Credential vault

The private vault is separate from Bob and stores values protected with
Windows DPAPI in `%USERPROFILE%\.ella\vault.dpapi.json`. API responses contain
only credential identifiers, labels, and timestamps. Bob has no vault endpoint,
path, key, or permission.

## Remote dashboard access

Do not port-forward Ella or Bob directly to the public internet. Use a private
network such as Tailscale:

1. Install Tailscale on the Ella PC and the remote device.
2. Restrict the Tailscale ACL to the intended users/devices.
3. Keep Bob on `127.0.0.1`; never advertise port `3010` or CDP port `9223`.
4. Access Ella through the PC's Tailscale address and authenticate API actions
   with the existing Ella bearer authentication.
5. For browser HTTPS, place an authenticated HTTPS reverse proxy in front of
   Ella or use Tailscale HTTPS. Do not disable authentication because the
   network is private.

Ella's raw backend and Bob child API must remain inaccessible from the public
internet.
