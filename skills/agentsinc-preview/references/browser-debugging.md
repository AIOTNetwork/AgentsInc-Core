# Browser Debugging

Connect a headless browser to inspect the running preview via Chrome DevTools Protocol.

## Connect

```bash
BROWSER=$(curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/connect-browser" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "headless" }')

CDP_ENDPOINT=$(echo "$BROWSER" | jq -r '.cdpEndpoint')
```

## Inspect via Chrome DevTools MCP

Use `--wsEndpoint $CDP_ENDPOINT`:

- `list_console_messages` — JS errors and warnings
- `list_network_requests` — HTTP traffic and failed requests
- `lighthouse_audit` — performance, accessibility, SEO scores
- `take_screenshot` — capture visual state
- `click`, `fill`, `navigate_page` — interact with the page

## Disconnect

```bash
curl -sS -X POST "$AGENTSINC_TOOLS_URL/tools/preview/$PREVIEW_ID/close-browser" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

## API

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/tools/preview/:id/connect-browser` | `{ mode?: "visible"\|"headless" }` | `{ cdpEndpoint, debugPort, status }` |
| POST | `/tools/preview/:id/close-browser` | — | `{ ok: true }` |
| GET | `/tools/preview/:id/browser` | — | `{ connected, cdpEndpoint?, debugPort? }` |
