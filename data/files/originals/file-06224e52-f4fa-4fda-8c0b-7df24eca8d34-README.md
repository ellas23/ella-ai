# Pressroom remote control

This app can control the Windows PC that runs the server. The control API is protected by an access token generated at:

`%LOCALAPPDATA%\Pressroom\access-token`

## Use it from your phone

1. Connect the Mac and phone to the same Wi-Fi network.
2. Start the app on the Mac with `npm run build && npm run server`.
3. Open the `Local phone URL` printed by the server.
4. Paste the `Remote access token` printed by the server into the Remote PC panel.
5. Tap **Connect**, then tap the screen image to click, use the arrow/Enter buttons, or send text.

You can also open the single combined website directly at `http://<MAC-LOCAL-IP>:8787` after running `npm run build` and `npm run server`. It shows the entire desktop, not a single browser tab.

Do not expose port 8787 with router port forwarding. Tailscale keeps the control service on a private network. For a fixed token, set `REMOTE_CONTROL_TOKEN` before starting the server; otherwise the generated token persists between restarts.

Browser visit details do not require ActivityWatch. On macOS, the server checks the active Safari or Google Chrome tab every five seconds and records its URL, title, and time seen. Allow Terminal/Node under **System Settings → Privacy & Security → Automation** so it can read browser tabs.

On macOS, allow Screen Recording and Accessibility for Terminal (or the app running Node) under System Settings > Privacy & Security. For audio on macOS, use the default output or set `REMOTE_AUDIO_DEVICE` to the name of a virtual audio device.

For one-key Mac setup, open Terminal in this folder and run:

```bash
chmod +x setup-mac.command
./setup-mac.command
```

The script installs BetterDisplay if needed, builds the app, opens BetterDisplay, and starts Ella. macOS privacy prompts and the initial headless-display choice still require confirmation because macOS does not allow scripts to grant those permissions silently.

To route Ella to the virtual monitor, stop the existing server first with `Ctrl+C`, then start it with the virtual display number and desktop offset:

```bash
REMOTE_DISPLAY_INDEX=2 REMOTE_DISPLAY_OFFSET_X=1920 REMOTE_DISPLAY_OFFSET_Y=0 npm run server
```

Use the display number shown by macOS for the BetterDisplay monitor. The offset is its position in **System Settings > Displays > Arrange**. Keep this Terminal window running.
