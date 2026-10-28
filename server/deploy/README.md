# Deploying the Timeblock sync server

The server is one binary plus one SQLite file. Caddy in front gives it HTTPS.

## 1. Build

On the VPS (or build on your laptop for the same OS/arch and copy the binary):

```bash
cd server && cargo build --release
sudo install -m 755 target/release/timeblock-sync /usr/local/bin/
```

## 2. User, data folder, service

```bash
sudo useradd --system --home /var/lib/timeblock-sync --shell /usr/sbin/nologin timeblock
sudo mkdir -p /var/lib/timeblock-sync && sudo chown timeblock:timeblock /var/lib/timeblock-sync
sudo cp deploy/timeblock-sync.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now timeblock-sync
curl http://127.0.0.1:8787/health   # → ok
```

## 3. HTTPS with Caddy

Point a DNS record (e.g. `sync.yourdomain.com`) at the VPS, install Caddy, then put the
block from `deploy/Caddyfile` (with your domain) in `/etc/caddy/Caddyfile` and run
`sudo systemctl reload caddy`. Check `https://sync.yourdomain.com/health`.

The server only trusts `X-Forwarded-For` (for rate limiting) when the request comes from
localhost, i.e. from Caddy. Keep `TIMEBLOCK_BIND` on `127.0.0.1`.

## 4. Point the apps at it

- **Web app:** in the GitHub repo, Settings → Secrets and variables → Actions → Variables,
  add `SYNC_URL` = `https://sync.yourdomain.com`. The next Pages deploy publishes the app
  at `https://9shrey.github.io/timeblock/app/`.
- **Desktop app:** Settings → Sync & account → enter the same server address.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `TIMEBLOCK_DB` | `./timeblock-sync.db` | SQLite file |
| `TIMEBLOCK_BIND` | `127.0.0.1:8787` | listen address |
| `TIMEBLOCK_ORIGINS` | GitHub Pages + localhost dev ports + Tauri | browser origins allowed by CORS |

## Backups

Once a day the server writes `backups/timeblock-YYYY-MM-DD.db` next to the database and keeps
the newest 14. Copy that folder off the VPS now and then. To restore: stop the service,
replace `timeblock-sync.db` with a backup, start it again. Clients that synced after the
backup re-download everything automatically.
