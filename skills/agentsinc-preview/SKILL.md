---
name: agentsinc-preview
description: >
  Deploy a live preview of your project so humans can see your work.
  Supports git repos and snapshots. Auto-builds and serves with a proxy URL.
  Includes browser debugging via Chrome DevTools Protocol.
---

# AgentsInc Preview

Use this skill when you have built a website, web app, or any project and need to:
- Deploy a live preview (so humans can see your work)
- Get build/runtime logs
- Debug it (console errors, network requests, performance)

## Prerequisites

- `AGENTSINC_TOOLS_URL` environment variable (injected by Paperclip)
- `PAPERCLIP_API_KEY` for authentication

## Quick Start

```bash
# 1. Start a preview from a git repo
PREVIEW=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/start" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"git\": { \"repo\": \"https://github.com/user/repo.git\" },
    \"projectId\": \"$PAPERCLIP_PROJECT_ID\",
    \"projectName\": \"My Project\",
    \"taskId\": \"$PAPERCLIP_TASK_ID\"
  }")

PREVIEW_ID=$(echo "$PREVIEW" | jq -r '.id')
PROXY_URL=$(echo "$PREVIEW" | jq -r '.proxyUrl')
echo "Preview: $PROXY_URL"

# 2. Check status (queued → creating → building → running)
curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/status" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

# 3. Get build logs
curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/logs" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

# 4. When done, stop the preview
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"id\": \"$PREVIEW_ID\" }"
```

## Workflow

### Step 1: Start preview

The preview system clones your repo, installs dependencies, and starts the dev server automatically. You don't need to run anything yourself.

```bash
# From git repo (public or private)
PREVIEW=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/start" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"git\": { \"repo\": \"$REPO_URL\", \"branch\": \"main\" },
    \"projectId\": \"$PAPERCLIP_PROJECT_ID\",
    \"projectName\": \"My Project\",
    \"taskId\": \"$PAPERCLIP_TASK_ID\",
    \"framework\": \"next\",
    \"port\": 3000
  }")

PREVIEW_ID=$(echo "$PREVIEW" | jq -r '.id')
PROXY_URL=$(echo "$PREVIEW" | jq -r '.proxyUrl')
STATUS=$(echo "$PREVIEW" | jq -r '.status')
EXISTING=$(echo "$PREVIEW" | jq -r '.existing')
```

**Hints** (optional, improves detection):
- `framework`: `"vite"`, `"next"`, or omit for auto-detection
- `port`: port the dev server listens on (default: 3000)

**One per project**: If a preview already exists for the `projectId`, the existing one is returned with `existing: true`.

### Step 2: Wait for build

The preview goes through: `queued` → `creating` → `building` → `running`.

```bash
# Poll status until running
while true; do
  STATUS=$(curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/status" \
    -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq -r '.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "running" ] && break
  [ "$STATUS" = "expired" ] || [ "$STATUS" = "destroyed" ] && echo "Failed" && break
  sleep 5
done
```

### Step 3: Get logs

```bash
LOGS=$(curl -sS "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/logs" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq -r '.logs')
echo "$LOGS"
```

Use logs to diagnose build failures, missing dependencies, or runtime errors.

### Step 4: Connect browser for debugging (optional)

```bash
BROWSER=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/connect-browser" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "headless" }')

CDP_ENDPOINT=$(echo "$BROWSER" | jq -r '.cdpEndpoint')
```

Then use Chrome DevTools MCP with `--wsEndpoint $CDP_ENDPOINT` to:
- `list_console_messages` — see JS errors and warnings
- `list_network_requests` — see HTTP traffic and failed requests
- `lighthouse_audit` — get performance, accessibility, SEO scores
- `take_screenshot` — capture visual state
- `click`, `fill`, `navigate_page` — interact with the page

### Step 5: Post evidence to the task

```bash
curl -sS -X POST "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "## Preview QA\n\nPreview: '"$PROXY_URL"'\n\n- Build: success\n- Console: 0 errors\n- Status: running"
  }'
```

### Step 6: Clean up

```bash
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"id\": \"$PREVIEW_ID\" }"
```

## API Reference

All endpoints require `Authorization: Bearer $PAPERCLIP_API_KEY`.

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/tools/preview/start` | `{ git?, snapshotUrl?, projectId?, projectName?, taskId?, framework?, port? }` | `{ id, status, proxyUrl, existing }` |
| POST | `/tools/preview/stop` | `{ id }` | `{ ok: true }` |
| POST | `/tools/preview/restart` | `{ id }` | `{ id, status, proxyUrl }` |
| GET | `/tools/preview/:id/status` | — | `{ id, status, proxyUrl, ... }` |
| GET | `/tools/preview/:id/logs` | — | `{ logs: "..." }` |
| GET | `/tools/preview/active` | `?agentId=` or `?projectId=` | `[{ id, status, ... }]` |
| POST | `/tools/preview/:id/connect-browser` | `{ mode?: "visible"\|"headless" }` | `{ cdpEndpoint, debugPort, status }` |
| POST | `/tools/preview/:id/close-browser` | — | `{ ok: true }` |
| GET | `/tools/preview/:id/browser` | — | `{ connected, cdpEndpoint?, debugPort? }` |

## Notes

- One active preview per project (returns existing if already running)
- Previews auto-expire after 15 minutes of inactivity (TTL refreshes on access)
- Hard maximum lifetime: 60 minutes
- The `proxyUrl` is safe to share — it includes a cryptographic access token
- Humans can view previews in the AgentsInc-Office 3D view or via direct browser access
