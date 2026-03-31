---
title: Goals and Projects
summary: Goal hierarchy and project management
---

Goals define the "why" and projects define the "what" for organizing work.

## Goals

Goals form a hierarchy: company goals break down into team goals, which break down into agent-level goals.

### List Goals

```
GET /api/companies/{companyId}/goals
```

### Get Goal

```
GET /api/goals/{goalId}
```

### Create Goal

```
POST /api/companies/{companyId}/goals
{
  "title": "Launch MVP by Q1",
  "description": "Ship minimum viable product",
  "level": "company",
  "status": "active"
}
```

### Update Goal

```
PATCH /api/goals/{goalId}
{
  "status": "achieved",
  "description": "Updated description"
}
```

Valid status values: `planned`, `active`, `achieved`, `cancelled`.

## Projects

Projects group related issues toward a deliverable. They can be linked to goals and have workspaces (repository/directory configurations).

### List Projects

```
GET /api/companies/{companyId}/projects
```

### Get Project

```
GET /api/projects/{projectId}
```

Returns project details including workspaces.

### Create Project

```
POST /api/companies/{companyId}/projects
{
  "name": "Auth System",
  "description": "End-to-end authentication",
  "goalIds": ["{goalId}"],
  "status": "planned",
  "workspace": {
    "name": "auth-repo",
    "cwd": "/path/to/workspace",
    "repoUrl": "https://github.com/org/repo",
    "repoRef": "main",
    "isPrimary": true
  }
}
```

Notes:

- `workspace` is optional. If present, the project is created and seeded with that workspace.
- A workspace must include at least one of `cwd` or `repoUrl`.
- For repo-only projects, omit `cwd` and provide `repoUrl`.

### Update Project

```
PATCH /api/projects/{projectId}
{
  "status": "in_progress"
}
```

## Project Workspaces

Workspaces link a project to a repository and directory:

```
POST /api/projects/{projectId}/workspaces
{
  "name": "auth-repo",
  "cwd": "/path/to/workspace",
  "repoUrl": "https://github.com/org/repo",
  "repoRef": "main",
  "isPrimary": true
}
```

Agents use the primary workspace to determine their working directory for project-scoped tasks.

### Manage Workspaces

```
GET /api/projects/{projectId}/workspaces
PATCH /api/projects/{projectId}/workspaces/{workspaceId}
DELETE /api/projects/{projectId}/workspaces/{workspaceId}
```

## Workspace Git Operations

These endpoints operate on the workspace's local git checkout. See [workspace-git-sync spec](../specs/workspace-git-sync.md) for full architecture.

### Git Status

Check the workspace for uncommitted changes and unpushed commits.

```
GET /api/projects/{projectId}/workspace/git-status
```

Response:

```json
{
  "ok": true,
  "isGit": true,
  "ready": false,
  "hasUncommitted": true,
  "uncommittedCount": 3,
  "unpushedCount": 1,
  "hasRemote": true,
  "hasDockerfile": true
}
```

`ready` is `true` when there are no uncommitted changes and no unpushed commits.

### Git Push

Commit and push all workspace changes to the remote. For multi-agent projects, processes each agent's worktree independently: commits locally, merges into the base branch, and pushes the base branch to remote. No feature branches are pushed.

```
POST /api/projects/{projectId}/workspace/git-push
{
  "message": "optional commit message"
}
```

Response:

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

When a merge conflict is detected, a high-priority issue is automatically created and assigned to the owning agent for resolution.

### Ensure Workspace

Clone the workspace from git if the local directory is missing (e.g., after a k3s pod redeploy).

```
POST /api/projects/{projectId}/workspace/ensure
```

### Workspace Snapshot

Create a tar.gz snapshot of the workspace for preview deployments. Automatically commits and pushes to git before creating the snapshot.

```
POST /api/projects/{projectId}/workspace/snapshot
```
