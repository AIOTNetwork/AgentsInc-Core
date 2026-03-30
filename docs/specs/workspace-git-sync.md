# Workspace Git Sync: Auto-Push & Multi-Agent Conflict Resolution

Status: Spec
Created: 2026-03-31
Audience: Engineers working on workspace and git integration

## 1. Problem

Agent-modified source code is only committed and pushed to git at the end of a heartbeat run. This creates several gaps:

- **Mid-run loss**: If the server is redeployed (k3s pod restart), uncommitted work is lost.
- **No on-demand push**: The Office frontend cannot trigger a git push before preview.
- **Multi-agent conflicts**: Multiple agents sharing a project can corrupt the git index with concurrent operations, and merge conflicts are silently aborted.
- **Stale workspaces**: In k3s, local workspaces may not reflect the latest remote `main`.

## 2. Architecture

### Git Flow (per agent)

```
Agent worktree → commit locally → merge into main (local) → push main to remote
                                       ↓ conflict?
                           Issue created → agent resolves locally → retry
```

**Key principles:**
- Agents never push feature branches to remote — only `main` is pushed.
- All merging happens locally on the server.
- Merge conflicts become agent tasks, not system failures.
- Per-directory mutex prevents concurrent git index corruption.

### Workspace Isolation

| Scenario | Workspace Path | Isolation |
|----------|---------------|-----------|
| Git worktree (per-issue) | `{repo}/.paperclip/worktrees/{branch}` | Full — each agent has own dir |
| Shared project workspace | `~/.paperclip/instances/{id}/projects/{company}/{project}/{repo}` | None — agents share dir |
| Agent home fallback | `~/.paperclip/instances/{id}/workspaces/{agentId}` | Full — per-agent dir |

## 3. Components

### 3.1 Git Service (`workspace-git.ts`)

Three new functions, replacing the monolithic `gitCommitMergeAndPush()`:

| Function | Purpose |
|----------|---------|
| `gitCommitLocal(cwd, message)` | Stage + commit in worktree. Local only, no network. |
| `gitMergeLocalAndPushBase(worktreeCwd, credUrl, branch, baseBranch)` | Merge worktree branch into `main` locally, push `main` to remote. Returns conflict info if merge fails. |
| `gitCommitMergeAndPush(...)` | Backward-compatible wrapper calling the above two. Used by heartbeat. |

**Per-directory mutex:** All git functions are wrapped in `withDirectoryLock(cwd)` to serialize operations on the same directory.

**Conflict detection:** On merge failure, `gitMergeLocalAndPushBase()` captures conflicting file names via `git diff --name-only --diff-filter=U`, aborts the merge, and returns structured `GitMergeResult`:

```typescript
interface GitMergeResult {
  ok: boolean;
  warning?: string;
  conflicted?: boolean;
  conflictFiles?: string[];
}
```

### 3.2 API Endpoint

```
POST /api/projects/{projectId}/workspace/git-push
```

**Request body** (optional):
```json
{
  "message": "Custom commit message"
}
```

**Behavior:**
1. Finds all active execution workspaces for the project (agent worktrees).
2. For each workspace:
   - Fetches latest `origin` (to ensure merge conflict detection is accurate).
   - Commits locally via `gitCommitLocal()`.
   - Merges into `main` locally and pushes `main` via `gitMergeLocalAndPushBase()`.
3. Also processes the shared project workspace if not covered by worktrees.
4. On merge conflict: creates a high-priority issue assigned to the owning agent.

**Response:**
```json
{
  "ok": true,
  "baseBranch": "main",
  "results": [
    { "workspaceName": "PROJ-42-fix-auth", "branch": "PROJ-42-fix-auth", "ok": true },
    { "workspaceName": "PROJ-43-add-tests", "branch": "PROJ-43-add-tests", "ok": false, "conflicted": true, "conflictFiles": ["src/auth.ts"] }
  ],
  "hasConflicts": true
}
```

**Existing related endpoints:**
- `GET /api/projects/{projectId}/workspace/git-status` — Read-only check for uncommitted/unpushed changes.
- `POST /api/projects/{projectId}/workspace/snapshot` — Now auto-pushes before creating snapshot (non-fatal).

### 3.3 Conflict Resolution

When a merge conflict is detected, the system:

1. Captures the list of conflicting files.
2. Creates a `high` priority issue: *"Resolve merge conflict on `{branch}` → `{baseBranch}`"*.
3. Assigns it to the agent that owns the conflicting workspace (via `sourceIssueId` lookup).
4. Wakes the agent via `queueIssueAssignmentWakeup()`.
5. Deduplicates — skips if an open conflict issue already exists for the same branch.

The agent resolves the conflict by fetching latest `main` into its worktree, resolving the conflict files, and committing. The next push attempt will succeed.

### 3.4 k3s Resilience

#### Stale Workspace Detection

Before any push operation, the endpoint runs `git fetch origin` (without reset) to ensure `origin/main` is up-to-date. This enables accurate conflict detection without destroying local changes.

#### Workspace Wipe Recovery

When a k3s pod is redeployed, local workspace directories are destroyed. Three recovery layers:

1. **Git-push endpoint:** If `cwd` doesn't exist, marks the execution workspace as `workspace_lost` and re-clones from remote.
2. **Heartbeat pre-run:** If an execution workspace's `cwd` is missing, forces re-creation instead of reusing the stale DB record.
3. **Periodic auto-push:** During long-running agent sessions, commits and pushes to `main` every 5 minutes. If the pod dies, at most 5 minutes of work is lost.

### 3.5 Office Frontend Integration

The Office frontend (`AgentsInc-Office`) integrates via:

1. `fetchProjectGitStatus(config, projectId)` — Calls `GET .../git-status` to check workspace state.
2. `pushProjectWorkspace(config, projectId, message?)` — Calls `POST .../git-push`.
3. **Preview flow:** Before showing preview, checks git status. If dirty, shows a "Sync to Git" banner with uncommitted/unpushed counts and a push button.
4. **Conflict indicator:** If push returns `hasConflicts: true`, shows a warning that an agent has been assigned to resolve.

## 4. Data Flow Diagram

```
Office Frontend                    AgentsInc-Core                        GitHub
     │                                  │                                   │
     │ POST /workspace/git-push         │                                   │
     │─────────────────────────────────>│                                   │
     │                                  │                                   │
     │                     ┌────────────┴────────────┐                      │
     │                     │ For each exec workspace │                      │
     │                     │                         │                      │
     │                     │ 1. git fetch origin     │                      │
     │                     │ 2. gitCommitLocal()     │                      │
     │                     │ 3. git checkout main    │                      │
     │                     │ 4. git merge {branch}   │                      │
     │                     │    ├─ success ──────────────> git push main ──>│
     │                     │    └─ conflict:         │                      │
     │                     │       capture files     │                      │
     │                     │       abort merge       │                      │
     │                     │       create issue      │                      │
     │                     └────────────┬────────────┘                      │
     │                                  │                                   │
     │ { ok, results, hasConflicts }    │                                   │
     │<─────────────────────────────────│                                   │
```

## 5. Key Files

| File | Changes |
|------|---------|
| `server/src/services/workspace-git.ts` | New `gitCommitLocal()`, `gitMergeLocalAndPushBase()`, `withDirectoryLock()`. Refactor `gitCommitMergeAndPush()`. |
| `server/src/routes/projects.ts` | New `POST .../git-push` endpoint. Auto-push in `POST .../snapshot`. Conflict issue helper. |
| `server/src/services/heartbeat.ts` | Workspace wipe detection on reuse. Periodic auto-push (5 min). |
| `Office/src/data/api.ts` | `pushProjectWorkspace()`, `fetchProjectGitStatus()` functions. |
| `Office/src/ui/AgentPanel.ts` | Git sync banner in preview section. |
| `Office/src/i18n.ts` | Translation keys for sync UI. |
