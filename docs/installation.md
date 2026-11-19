# Installation (macOS)

Everything runs on your Mac. No paid API is needed for the mock/manual workflow.

## Requirements

| Tool | Version used | Check | Install if missing |
|---|---|---|---|
| Python | 3.9+ (tested 3.12.3) | `python3 --version` | `xcode-select --install` or `brew install python` |
| FFmpeg + ffprobe | any recent (tested with libx264) | `ffmpeg -version` | `brew install ffmpeg` |
| Node.js | **22.13 or newer** (tested 22.23.3; needs the built-in `node:sqlite`) | `node -v` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| Docker Desktop | optional, for n8n (tested 29.5.3) | `docker info` | [docker.com](https://www.docker.com/products/docker-desktop/) |

## 1. Install the web app

```bash
cd ~/Documents/office/ai-creative-studio/web
npm ci
```

## 2. Create local configuration

```bash
cd ~/Documents/office/ai-creative-studio
bash scripts/setup-local-env.sh
```

This writes `web/.env.local` and `n8n/.env` (both git-ignored, mode 600) with one shared random
token. It never overwrites existing files. All variables are documented in `web/.env.example` and
`n8n/.env.example`.

## 3. Start the dashboard

Development (hot reload):

```bash
npm --prefix web run dev
```

Production build:

```bash
npm --prefix web run build
npm --prefix web run start
```

Open http://localhost:3000. The server listens on 127.0.0.1 only.

## 4. Optional: start n8n

See [n8n-integration.md](n8n-integration.md). In short:

```bash
docker compose -f n8n/docker-compose.yml --env-file n8n/.env up -d
bash scripts/n8n-import.sh
```

Then set `ACS_ORCHESTRATOR=n8n` in `web/.env.local` and restart the dashboard. If port 5678 is
already used by another n8n, set `N8N_HOST_PORT=5679` in `n8n/.env` and
`ACS_N8N_URL=http://127.0.0.1:5679` in `web/.env.local`.

## 5. Check everything

```bash
python3 -m unittest discover -s tests
npm --prefix web test
npm --prefix web run build && node web/scripts/e2e.mjs
```

See [testing.md](testing.md).

## Where things are stored

| What | Where | In Git? |
|---|---|---|
| Campaigns, jobs, history, approvals, reviews, costs | `data/studio.db` (SQLite) | no |
| Application log | `data/logs/app.log` | no |
| Template-pack exports | `data/exports/` | no |
| Campaign briefs | `briefs/<campaign>/brief.json` | yes (as before) |
| Product photos, reference videos | `assets/products/<campaign>/`, `assets/reference-videos/` | no |
| Job files: production, prompts, renders, packages | `outputs/<job>/` | no |
| n8n workflows, executions | Docker volume `acs-n8n_n8n_data` | no |
