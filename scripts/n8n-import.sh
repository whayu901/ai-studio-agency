#!/usr/bin/env bash
# Import the ACS workflows into the running n8n container and activate them.
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose -f n8n/docker-compose.yml --env-file n8n/.env)
python3 n8n/build_workflows.py >/dev/null
"${DC[@]}" exec -T n8n n8n import:workflow --separate --input=/workflows
for id in acsWfOriginal001 acsWfReference01 acsWfReview00001 acsWfDelivery001; do
  "${DC[@]}" exec -T n8n n8n update:workflow --id="$id" --active=true
done
# The error workflow (E) stays inactive: n8n runs it through the other workflows' errorWorkflow setting.
"${DC[@]}" exec -T n8n n8n update:workflow --id=acsWfErrors00001 --active=false
# Activation changes made through the CLI take effect after a restart.
"${DC[@]}" restart n8n
echo "Waiting for n8n to become healthy…"
PORT="$(grep -E '^N8N_HOST_PORT=' n8n/.env | cut -d= -f2 || true)"; PORT="${PORT:-5678}"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then echo "n8n is up: http://localhost:${PORT}"; exit 0; fi
  sleep 2
done
echo "n8n did not come back within 2 minutes" >&2
exit 1
