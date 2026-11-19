# Deployment

This MVP is **local-first and single-user**. It is meant to run on your Mac, not on a server.

- The dashboard binds to `127.0.0.1:3000`; n8n binds to `127.0.0.1:<N8N_HOST_PORT>`.
- Middleware refuses non-local `Host` headers (DNS-rebinding protection) and requires
  `x-acs-client: dashboard` on every mutating API call, which other websites cannot send without a
  CORS preflight the app never allows.
- `/api/orchestrator/*` requires the shared token (`x-acs-token`, constant-time compare) and accepts
  `host.docker.internal` as host for n8n.
- There are no user accounts. Anyone with access to your Mac's localhost can use the dashboard.
  Approvals record the name the reviewer types; this is accountability, not authentication.

## Do not expose it publicly

Putting this on the internet needs, at minimum: real authentication and roles (who may approve),
HTTPS, moving secrets out of `.env` files, a server database, object storage for media, rate limits,
and a security review. These are listed in [roadmap.md](roadmap.md).

## Running it day to day

```bash
docker compose -f n8n/docker-compose.yml --env-file n8n/.env up -d    # if you use n8n
npm --prefix web run build && npm --prefix web run start              # or: npm --prefix web run dev
```

Backups: copy `data/` (SQLite + logs), `briefs/`, `outputs/`, `assets/`, `characters/*/references/`,
and the Docker volume `acs-n8n_n8n_data` if you changed workflows in n8n.

Upgrading n8n: change the pinned image tag in `n8n/docker-compose.yml`, `docker compose … pull`,
`up -d`, then re-run `scripts/n8n-import.sh` and `node web/scripts/n8n-smoke.mjs`.
