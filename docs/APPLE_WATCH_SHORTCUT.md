# Apple Watch / iPhone Shortcut Commands

The watch does not run Ella. An iPhone Shortcut sends an explicitly allowlisted command to the Windows Ella coordinator.

## Configure authentication

Set `ELLA_WATCH_TOKEN` in the environment used to start `server.js`. Use a long random value and keep it only in the Shortcut's private configuration and the server environment. Do not put it in dashboard JavaScript or source control.

The API is unavailable until this variable is configured.

The recommended Windows startup mechanism is an external file at `%USERPROFILE%\.ella\watch.env`:

```text
ELLA_WATCH_TOKEN=replace-with-a-long-random-value
```

`Start-All-Ella.cmd` reads this file without printing its contents. You may set
`ELLA_WATCH_ENV_FILE` to a different protected path before starting Ella.

## Create the Shortcut

1. Create a new iPhone Shortcut.
2. Add **Dictate Text**.
3. Add an **If** action that maps the dictated phrase to an explicit command:
   - `lock_pc`
   - `get_pc_status`
   - `get_ella_status`
   - `get_research_status`
   - `cancel_research`
   - `shutdown_pc`
   - `restart_pc`
   - `sleep_pc`
   - `start_ella`
   - `stop_ella`
   - `restart_ella`
4. Add **Text** containing JSON like:

```json
{
  "command": "lock_pc",
  "source": "apple_watch",
  "requestId": "shortcut-generated-unique-id"
}
```

Use a new request ID for every invocation. A timestamp plus a random value is suitable.

5. Add **Get Contents of URL**:
   - Method: `POST`
   - URL: `https://<current-ella-host>/api/watch/command`
   - Request body: JSON
   - Header: `Authorization: Bearer <ELLA_WATCH_TOKEN>`
   - Header: `Content-Type: application/json`
6. Add **Get Dictionary from Input**.
7. Speak or display the returned `message`, `status`, and `error` fields.

## Network requirements

Do not expose port 3001 directly to the public Internet. For the existing Cloudflare Quick Tunnel, use the current hostname stored in `%USERPROFILE%\.ella\ella-public-url.txt` and append `/api/watch/command`. Quick Tunnel hostnames change after tunnel restarts, so update the Shortcut URL whenever that file changes. A stable hostname requires a named Cloudflare Tunnel and a domain; it is not available from a free Quick Tunnel.

## Security behavior

The Watch endpoints are intentionally outside the Ella admin-session middleware, but they have their own separate bearer-token authentication. The admin password will not work here, and the Watch token does not grant dashboard access. The endpoint rejects missing or invalid authentication, malformed requests, unknown commands, unsupported sources, and replayed request IDs. It never accepts arbitrary shell commands, URLs, file operations, or security/account changes.
