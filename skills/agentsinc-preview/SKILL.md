---
name: agentsinc-preview
description: >
  Deploy a live preview of a web project so humans can view your work.
  Use when you need to: (1) show a website/app to humans for review,
  (2) verify a build succeeds, (3) get runtime logs from a deployed preview,
  (4) debug with a headless browser. Accepts git repos or snapshot URLs.
  Auto-detects framework (Next.js, Vite, etc.), installs deps, and serves.
---

# AgentsInc Preview

Deploy a preview by calling `/tools/preview/start` with a git repo. The system clones, installs, and serves automatically. One active preview per project.

## Start a preview

```bash
PREVIEW=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/start" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"git\": { \"repo\": \"$REPO_URL\", \"branch\": \"main\" },
    \"projectId\": \"$PAPERCLIP_PROJECT_ID\",
    \"projectName\": \"$PROJECT_NAME\",
    \"taskId\": \"$PAPERCLIP_TASK_ID\"
  }")

PREVIEW_ID=$(echo "$PREVIEW" | jq -r '.id')
PROXY_URL=$(echo "$PREVIEW" | jq -r '.proxyUrl')
```

Optional hints: `"framework": "next"` or `"vite"`, `"port": 3000`.

If a preview already exists for the project, it returns the existing one with `"existing": true`.

## Wait for build

Status progresses: `queued` -> `creating` -> `building` -> `running`.

```bash
while true; do
  STATUS=$(curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/status" \
    -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq -r '.status')
  [ "$STATUS" = "running" ] || [ "$STATUS" = "expired" ] && break
  sleep 5
done
```

## Get logs

```bash
curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/logs" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq -r '.logs'
```

## Stop

```bash
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"id\": \"$PREVIEW_ID\" }"
```

## Browser debugging (optional)

Connect a headless browser for console/network inspection, screenshots, and Lighthouse audits. See [references/browser-debugging.md](references/browser-debugging.md).

## API Reference

All endpoints require `Authorization: Bearer $PAPERCLIP_API_KEY`.

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/tools/preview/start` | `{ git?, snapshotUrl?, projectId?, projectName?, taskId?, framework?, port? }` | `{ id, status, proxyUrl, existing }` |
| GET | `/tools/preview/:id/status` | -- | `{ id, status, proxyUrl, ... }` |
| GET | `/tools/preview/:id/logs` | -- | `{ logs }` |
| POST | `/tools/preview/stop` | `{ id }` | `{ ok }` |
| POST | `/tools/preview/restart` | `{ id }` | `{ id, status, proxyUrl }` |
| GET | `/tools/preview/active` | `?agentId=` or `?projectId=` | `[{ id, status, ... }]` |

## Behavior

- One preview per project -- returns existing if already running
- 15-minute idle TTL (refreshes on access), 60-minute hard max
- `proxyUrl` includes a cryptographic access token and is safe to share
- Humans see previews in AgentsInc-Office or via direct browser access
