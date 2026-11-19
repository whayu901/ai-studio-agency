#!/usr/bin/env bash
# Create web/.env.local and n8n/.env with one shared random token. Never overwrites existing files.
set -euo pipefail
cd "$(dirname "$0")/.."
rand() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
TOKEN="$(rand 32)"
if [ -f n8n/.env ]; then
  TOKEN="$(grep -E '^ACS_ORCHESTRATOR_TOKEN=' n8n/.env | cut -d= -f2-)"
  echo "n8n/.env exists — keeping it"
else
  ( umask 077
    sed -e "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$(rand 32)|" -e "s|^ACS_ORCHESTRATOR_TOKEN=.*|ACS_ORCHESTRATOR_TOKEN=${TOKEN}|" n8n/.env.example > n8n/.env )
  echo "wrote n8n/.env"
fi
if [ -f web/.env.local ]; then
  echo "web/.env.local exists — keeping it (make sure ACS_ORCHESTRATOR_TOKEN matches n8n/.env)"
else
  ( umask 077
    sed -e "s|^ACS_ORCHESTRATOR_TOKEN=.*|ACS_ORCHESTRATOR_TOKEN=${TOKEN}|" web/.env.example > web/.env.local )
  echo "wrote web/.env.local (ACS_ORCHESTRATOR=direct; change it to n8n once n8n is running)"
fi
