---
name: agentsinc-tools
description: >
  Use AgentsIncTools to preview websites you build, connect a browser for
  debugging (console, network, performance), and let humans view your work.
  Provides preview lifecycle management and Chrome DevTools Protocol access.
---

# AgentsIncTools Skill

Use this skill when you have built a website, web app, or any project with a dev server and need to:
- Preview it (so humans can see your work)
- Debug it (console errors, network requests, performance)
- Self-test it (navigate, click, verify)

## Prerequisites

- `AGENTSINC_TOOLS_URL` environment variable must be set (injected by Paperclip)
- `PAPERCLIP_API_KEY` for authentication

## Quick Start

```bash
# 1. Start your dev server
npm run dev -- --port 4007 --host 0.0.0.0

# 2. Register the preview with AgentsIncTools
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/register" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"http://$(hostname):4007\",
    \"taskId\": \"$PAPERCLIP_TASK_ID\"
  }"
# Returns: { "id": "...", "proxyUrl": "https://tools.example.com/p/{id}/{token}/", ... }

# 3. (Optional) Connect a browser for debugging
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/connect-browser" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "headless" }'
# Returns: { "cdpEndpoint": "ws://...", "debugPort": 9300, "status": "launched" }

# 4. Use Chrome DevTools MCP with the CDP endpoint to inspect the page

# 5. When done, stop the preview
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"id\": \"$PREVIEW_ID\" }"
```

## Workflow

### Step 1: Build your project
Write code, install dependencies, prepare the project as normal.

### Step 2: Start your dev server
Run the dev server yourself. You control it — AgentsIncTools doesn't spawn it for you in cloud mode.

```bash
# Vite
npx vite --port 4007 --host 0.0.0.0

# Next.js
npx next dev --port 4007 --hostname 0.0.0.0

# Static
npx serve -l 4007
```

Use `--host 0.0.0.0` so AgentsIncTools can reach it over the network.

### Step 3: Register the preview

```bash
PREVIEW=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/register" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"http://$(hostname):4007\",
    \"taskId\": \"$PAPERCLIP_TASK_ID\"
  }")

PREVIEW_ID=$(echo "$PREVIEW" | jq -r '.id')
PROXY_URL=$(echo "$PREVIEW" | jq -r '.proxyUrl')
echo "Preview live at: $PROXY_URL"
```

Once registered, humans can view the preview in:
- The AgentsInc-Office 3D view (iframe in agent panel)
- Direct browser access via the `proxyUrl`

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

After debugging, post screenshots or findings as task comments:

```bash
curl -sS -X POST "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "## Preview QA\n\n- Lighthouse: 95 performance, 100 accessibility\n- Console: 0 errors\n- Network: all requests 200 OK\n\nPreview: '"$PROXY_URL"'"
  }'
```

### Step 6: Clean up

```bash
# Stop the preview (also closes browser if connected)
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{ \"id\": \"$PREVIEW_ID\" }"

# Stop your dev server
kill %1  # or however you started it
```

## API Reference

All endpoints require `Authorization: Bearer $PAPERCLIP_API_KEY`.

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/tools/preview/register` | `{ url, taskId? }` | `{ id, proxyUrl, type, status }` |
| POST | `/tools/preview/start` | `{ cwd, taskId? }` | `{ id, proxyUrl, type, status }` (local mode only) |
| POST | `/tools/preview/stop` | `{ id }` | `{ ok: true }` |
| GET | `/tools/preview/active` | — | `[{ id, proxyUrl, status, ... }]` |
| GET | `/tools/preview/:id` | — | `{ id, proxyUrl, status, ... }` |
| POST | `/tools/preview/:id/connect-browser` | `{ mode?: "visible"\|"headless" }` | `{ cdpEndpoint, debugPort, status }` |
| POST | `/tools/preview/:id/close-browser` | — | `{ ok: true }` |
| GET | `/tools/preview/:id/browser` | — | `{ connected, cdpEndpoint?, debugPort? }` |

## Notes

- Max 2 concurrent previews per agent
- Previews auto-expire after 30 minutes
- `register` is for cloud deployments (agent runs dev server elsewhere)
- `start` is for local deployments (AgentsIncTools spawns the dev server)
- Browser mode `visible` opens a Chrome window (local dev); `headless` runs in background (cloud)
- The `proxyUrl` is safe to share — it includes an access token
