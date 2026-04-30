# Paperclip Create Agent API Reference

## Core Endpoints

- `GET /llms/agent-configuration.txt`
- `GET /llms/agent-configuration/:adapterType.txt`
- `GET /llms/agent-icons.txt`
- `GET /api/companies/:companyId/agent-configurations`
- `GET /api/companies/:companyId/skills`
- `POST /api/companies/:companyId/skills/import`
- `GET /api/agents/:agentId/configuration`
- `POST /api/agents/:agentId/skills/sync`
- `POST /api/companies/:companyId/agent-hires`
- `POST /api/companies/:companyId/agents`
- `GET /api/agents/:agentId/config-revisions`
- `POST /api/agents/:agentId/config-revisions/:revisionId/rollback`
- `POST /api/issues/:issueId/approvals`
- `GET /api/approvals/:approvalId/issues`

Approval collaboration:

- `GET /api/approvals/:approvalId`
- `POST /api/approvals/:approvalId/request-revision` (board)
- `POST /api/approvals/:approvalId/resubmit`
- `GET /api/approvals/:approvalId/comments`
- `POST /api/approvals/:approvalId/comments`
- `GET /api/approvals/:approvalId/issues`

## `POST /api/companies/:companyId/agent-hires`

Request body matches agent create shape:

```json
{
  "name": "CTO",
  "role": "cto",
  "title": "Chief Technology Officer",
  "icon": "crown",
  "reportsTo": "uuid-or-null",
  "capabilities": "Owns architecture and engineering execution",
  "desiredSkills": ["vercel-labs/agent-browser/agent-browser"],
  "catalogPath": "aiot-agents/leadership/leadership-cto",
  "adapterType": "claude_local",
  "adapterConfig": {
    "cwd": "/absolute/path",
    "model": "claude-sonnet-4-5-20250929"
  },
  "runtimeConfig": {
    "heartbeat": {
      "intervalSec": 300,
      "wakeOnDemand": true
    }
  },
  "budgetMonthlyCents": 0,
  "sourceIssueId": "uuid-or-null",
  "sourceIssueIds": ["uuid-1", "uuid-2"]
}
```

Response:

```json
{
  "agent": {
    "id": "uuid",
    "status": "pending_approval"
  },
  "approval": {
    "id": "uuid",
    "type": "hire_agent",
    "status": "pending",
    "payload": {
      "desiredSkills": ["vercel-labs/agent-browser/agent-browser"]
    }
  }
}
```

If company setting disables required approval, `approval` is `null` and the agent is created as `idle`.

`desiredSkills` accepts company skill ids, canonical keys, or a unique slug. The server resolves and stores canonical company skill keys.

### Heartbeat default (body wins)

`runtimeConfig.heartbeat.enabled` is body-wins:

- **Include it** (`true` or `false`) only when this specific agent must
  override the deployment-wide policy — e.g., the deployment env says
  `false` but this agent must heartbeat, or the env says `true` but this
  agent must stay silent. Use sparingly.
- **Omit it** in the normal case. The server fills it from env
  `HEARTBEAT_SCHEDULER_ENABLED` (default: `false`) at hire time, so the
  agent follows whatever the deployment is configured for.

**The per-agent value is not a behavior guarantee.** Whether the agent
actually heartbeats also depends on whether the scheduler loop itself is
on, which is gated by the same `HEARTBEAT_SCHEDULER_ENABLED` env. So
`enabled: true` in the body only takes effect when the scheduler is also
on.

Other heartbeat fields (`intervalSec`, `wakeOnDemand`, `maxConcurrentRuns`,
`cooldownSec`) have **no** env fallback — set them explicitly if you need
non-zero values.

**Do not probe `POST /agent-hires` to discover this default.** Each probe
creates a real `pending_approval` agent + approval row that the board must
reject manually. Read this doc, or ask the board.

## Approval Lifecycle

Statuses:

- `pending`
- `revision_requested`
- `approved`
- `rejected`
- `cancelled`

For hire approvals:

- approved: linked agent transitions `pending_approval -> idle`
- rejected: linked agent is terminated

## Safety Notes

- Config read APIs redact obvious secrets.
- `pending_approval` agents cannot run heartbeats, receive assignments, or create keys.
- All actions are logged in activity for auditability.
- Use markdown in issue/approval comments and include links to approval, agent, and source issue.
- After approval resolution, requester may be woken with `PAPERCLIP_APPROVAL_ID` and should reconcile linked issues.
