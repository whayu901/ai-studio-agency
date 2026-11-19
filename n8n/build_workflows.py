#!/usr/bin/env python3
"""Generate the importable n8n workflow JSON files in n8n/workflows/.

The workflows contain no credentials. They read ACS_APP_URL and ACS_ORCHESTRATOR_TOKEN from
the n8n container's environment (docker-compose.yml) and call the app's /api/orchestrator/*
endpoints. All business rules stay in the app; n8n only sequences the calls.

    python3 n8n/build_workflows.py
"""
import json
import uuid
from pathlib import Path

OUT = Path(__file__).parent / "workflows"
ERROR_WF = "acsWfErrors00001"
WEBHOOK = "$('Webhook').first().json.body"


def nid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"acs:{name}"))


def headers(step: str, inbound: bool = False):
    h = [
        {"name": "x-acs-token", "value": "={{ $env.ACS_ORCHESTRATOR_TOKEN }}"},
        {"name": "x-acs-execution-id", "value": "={{ $execution.id }}"},
        {"name": "x-acs-run-key", "value": "={{ " + WEBHOOK + ".idempotency_key }}"},
        {"name": "x-acs-idempotency-key", "value": "={{ $execution.id }}:" + step},
    ]
    if inbound:
        # Proves the webhook request that started this execution carried the shared token.
        h.append({"name": "x-acs-inbound-token", "value": "={{ $('Webhook').first().json.headers['x-acs-token'] || '' }}"})
    return {"parameters": h}


def http(name: str, path: str, step: str, x: int, body: str = "{}", inbound: bool = False):
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ $env.ACS_APP_URL }}/api/orchestrator/jobs/{{ " + WEBHOOK + ".job_id }}" + path,
            "sendHeaders": True,
            "headerParameters": headers(step, inbound),
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": body,
            "options": {"timeout": 300000},
        },
        "id": nid(name + path),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, 300],
        "notes": f"POST {path} (no retries here: failures go to the error workflow; the app offers a bounded retry)",
    }


def webhook(path: str):
    return {
        "parameters": {"httpMethod": "POST", "path": path, "responseMode": "responseNode", "options": {}},
        "id": nid("webhook-" + path),
        "name": "Webhook",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [0, 300],
        "webhookId": nid("hook-" + path),
        "notes": "Receives the acs.job.v1 contract from the app (ids only, no paths or secrets).",
    }


def respond(x: int, last: str):
    body = (
        "={{ JSON.stringify({ execution_id: $execution.id, workflow: $workflow.name, job_id: " + WEBHOOK + ".job_id, "
        "state: $('" + last + "').first().json.state, label: $('" + last + "').first().json.label || null, "
        "waiting_for_human: $('" + last + "').first().json.waiting_for_human || false }) }}"
    )
    return {
        "parameters": {"respondWith": "json", "responseBody": body, "options": {}},
        "id": nid(f"respond-{x}-{last}"),
        "name": "Respond",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [x, 300],
    }


def chain(wf_id: str, name: str, path: str, steps):
    nodes = [webhook(path)]
    x = 250
    for i, (label, p, step) in enumerate(steps):
        nodes.append(http(label, p, step, x, body="={{ JSON.stringify(" + WEBHOOK + ") }}" if i == 0 else ("={{ JSON.stringify({ render_ids: " + WEBHOOK + ".render_ids }) }}" if step == "attach" else "{}"), inbound=(i == 0)))
        x += 250
    nodes.append(respond(x, steps[-1][0]))
    names = [n["name"] for n in nodes]
    connections = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}
    return {
        "id": wf_id,
        "name": name,
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1", "errorWorkflow": ERROR_WF, "saveDataErrorExecution": "all", "saveDataSuccessExecution": "all", "saveManualExecutions": True},
        "pinData": {},
        "meta": {"templateCredsSetupCompleted": True, "acs_contract": "acs.job.v1"},
        "tags": [],
    }


WORKFLOWS = {
    "A-original-creation.json": chain("acsWfOriginal001", "ACS A · Original Creation", "acs-original-creation", [
        ("Validate job", "/validate", "validate"),
        ("Creative brief", "/stages/brief", "brief"),
        ("Script", "/stages/script", "script"),
        ("Storyboard", "/stages/storyboard", "storyboard"),
        ("Prompt compiler", "/stages/prompts", "prompts"),
        ("Render readiness", "/stages/await_render", "await_render"),
        ("Approval pending", "/approval-pending", "pending"),
    ]),
    "B-reference-guided.json": chain("acsWfReference01", "ACS B · Reference Guided", "acs-reference-guided", [
        ("Validate reference", "/validate", "validate"),
        ("Analyze reference manifest", "/stages/reference_analysis", "reference_analysis"),
        ("Creative brief", "/stages/brief", "brief"),
        ("Creative adaptation", "/stages/script", "script"),
        ("Storyboard", "/stages/storyboard", "storyboard"),
        ("Prompt compiler", "/stages/prompts", "prompts"),
        ("Render readiness", "/stages/await_render", "await_render"),
        ("Approval pending", "/approval-pending", "pending"),
    ]),
    "C-production-review.json": chain("acsWfReview00001", "ACS C · Production Review", "acs-production-review", [
        ("Receive render metadata", "/validate", "validate"),
        ("Attach generated video", "/renders/attach", "attach"),
        ("Quality review pending", "/approval-pending", "pending"),
    ]),
    "D-delivery.json": chain("acsWfDelivery001", "ACS D · Delivery", "acs-delivery", [
        ("Validate approved job", "/validate", "validate"),
        ("Package assets", "/package", "package"),
        ("Generate delivery manifest", "/delivery-manifest", "manifest"),
        ("Mark delivered", "/delivered", "delivered"),
        ("Approval pending", "/approval-pending", "pending"),
    ]),
}

ERROR = {
    "id": ERROR_WF,
    "name": "ACS E · Error handling",
    "nodes": [
        {"parameters": {}, "id": nid("error-trigger"), "name": "Error Trigger", "type": "n8n-nodes-base.errorTrigger", "typeVersion": 1, "position": [0, 300]},
        {
            "parameters": {
                "method": "POST",
                "url": "={{ $env.ACS_APP_URL }}/api/orchestrator/errors",
                "sendHeaders": True,
                "headerParameters": {"parameters": [
                    {"name": "x-acs-token", "value": "={{ $env.ACS_ORCHESTRATOR_TOKEN }}"},
                    {"name": "x-acs-execution-id", "value": "={{ $json.execution.id }}"},
                ]},
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify({ execution_id: String($json.execution.id || ''), workflow: $json.workflow.name, message: String(($json.execution.error && $json.execution.error.message) || 'unknown error').slice(0, 3000), last_node: $json.execution.lastNodeExecuted || null }) }}",
                "options": {"timeout": 30000},
            },
            "id": nid("error-record"),
            "name": "Record error in app",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [250, 300],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 3000,
            "notes": "Marks the job FAILED (history kept); a person retries from the dashboard (bounded by ACS_MAX_RETRIES).",
        },
    ],
    "connections": {"Error Trigger": {"main": [[{"node": "Record error in app", "type": "main", "index": 0}]]}},
    "active": False,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
    "meta": {"templateCredsSetupCompleted": True},
    "tags": [],
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, wf in {**WORKFLOWS, "E-error-handling.json": ERROR}.items():
        (OUT / name).write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("wrote", OUT / name)
