# K8s Ephemeral Storage Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentsInc-Core resilient to K8s pod restarts where local disk is ephemeral, by enabling S3 storage and ensuring all critical state survives restarts.

**Architecture:** The codebase already has S3 support for most subsystems (run logs, workspace snapshots, agent instructions, file storage) via `PAPERCLIP_STORAGE_PROVIDER=s3`. The gap is: (1) S3 is not enabled in production, (2) skills bundled files need DB fallback (already fixed), (3) secrets master key needs ENV var config, (4) adapter plugin registry has no persistence.

**Tech Stack:** Node.js, MinIO/S3 (`@aws-sdk/client-s3`), PostgreSQL, TypeScript

---

## Current State Audit

| Component | Writes To | S3 Ready | DB Fallback | Action Needed |
|-----------|-----------|----------|-------------|---------------|
| Run logs | `data/run-logs/` | YES | No | Enable S3 via env |
| Workspace op logs | `data/workspace-operation-logs/` | YES | No | Enable S3 via env |
| Workspace snapshots | `workspaces/` | YES | No | Enable S3 via env |
| Agent home snapshots | `agent-homes/` | YES | No | Enable S3 via env |
| Agent instructions | `companies/{id}/agents/{id}/instructions/` | YES (bundle sync) | No | Enable S3 via env |
| Storage objects (uploads) | `data/storage/` | YES | No | Enable S3 via env |
| Skills files | `skills/{companyId}/` | No | YES (bundledFiles in metadata) | Already fixed |
| Secrets master key | `data/secrets/master.key` | No | No | Use ENV var |
| Worktree config | `instances/{id}/config.json` | No | No | Use ENV vars |
| Adapter plugins | `~/.paperclip/adapter-plugins.json` | No | No | Task 3 |
| Server logs | `instances/{id}/logs/` | No | No (stdout fallback) | Acceptable |
| Service registry | `runtime-services/*.json` | No | No | Acceptable (ephemeral PIDs) |
| Telemetry state | `telemetry/` | No | No | Acceptable |

## Decision: What NOT to fix

These are acceptable to lose on pod restart:
- **Server logs** — pino logs to stdout by default, file is secondary
- **Service registry** — tracks local PIDs which are invalid after restart anyway
- **Telemetry state** — non-critical analytics
- **Worktree config** — regenerated from ENV vars on startup

---

### Task 1: Enable S3 storage in production environment

This is a **configuration-only change** — no code modifications needed. The S3 support already exists.

**Files:**
- Modify: Zeabur environment variables (dashboard)
- Modify: `server/src/config.ts` (verify S3 config keys)

- [ ] **Step 1: Verify S3 config structure**

Read `server/src/config.ts` and `server/src/storage/s3-provider.ts` to confirm the required env vars:

```bash
grep -n "S3\|STORAGE_PROVIDER\|MINIO" server/src/config.ts server/src/storage/s3-provider.ts
```

Expected env vars:
```
PAPERCLIP_STORAGE_PROVIDER=s3
PAPERCLIP_S3_ENDPOINT=<minio-endpoint>
PAPERCLIP_S3_BUCKET=<bucket-name>
PAPERCLIP_S3_ACCESS_KEY=<access-key>
PAPERCLIP_S3_SECRET_KEY=<secret-key>
PAPERCLIP_S3_REGION=<region>
```

- [ ] **Step 2: Set env vars in Zeabur dashboard**

For both beta and dev environments, add:
```
PAPERCLIP_STORAGE_PROVIDER=s3
PAPERCLIP_S3_ENDPOINT=https://<your-minio-endpoint>
PAPERCLIP_S3_BUCKET=paperclip
PAPERCLIP_S3_ACCESS_KEY=<key>
PAPERCLIP_S3_SECRET_KEY=<secret>
PAPERCLIP_S3_REGION=ap-southeast-1
```

- [ ] **Step 3: Create the S3 bucket if it doesn't exist**

```bash
# Via MinIO client or AWS CLI
mc mb minio/paperclip
# Or
aws s3 mb s3://paperclip --endpoint-url https://<minio-endpoint>
```

- [ ] **Step 4: Verify by restarting the pod**

After restart, create a preview and check:
- Run logs appear in S3: `mc ls minio/paperclip/data/run-logs/`
- Agent instructions restored: check agent can execute tasks
- Workspace snapshots: `mc ls minio/paperclip/workspaces/`

- [ ] **Step 5: Commit env documentation**

Update `.env.example` with the S3 config block.

---

### Task 2: Secure secrets master key via ENV var

**Files:**
- Modify: Zeabur environment variables (dashboard)
- Verify: `server/src/secrets/local-encrypted-provider.ts:48-66`

- [ ] **Step 1: Check current master key loading logic**

Read `server/src/secrets/local-encrypted-provider.ts` to confirm it checks `PAPERCLIP_SECRETS_MASTER_KEY` env var before generating a file-based key.

```bash
grep -n "PAPERCLIP_SECRETS_MASTER_KEY" server/src/secrets/local-encrypted-provider.ts
```

- [ ] **Step 2: Generate a stable master key**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 3: Set in Zeabur dashboard**

```
PAPERCLIP_SECRETS_MASTER_KEY=<hex-string-from-step-2>
```

Set the SAME value for both beta and dev (or different per environment if secrets are separate).

- [ ] **Step 4: Verify encrypted secrets still decrypt after pod restart**

Restart the pod. Check that agents with encrypted adapter configs (API keys, tokens) can still start and execute.

---

### Task 3: Persist adapter plugin registry in DB

The adapter plugin registry (`adapter-plugins.json`, `adapter-settings.json`) is lost on restart. For K8s, persist in the database.

**Files:**
- Modify: `server/src/services/adapter-plugin-store.ts:47-112`
- Modify: `packages/db/src/schema/` (add settings table or use existing kv store)

- [ ] **Step 1: Check if a key-value store already exists**

```bash
grep -rn "kv_store\|key_value\|settings.*table\|system_settings" packages/db/src/schema/
```

If a settings/kv table exists, use it. If not, use the existing `metadata` or `config` mechanism.

- [ ] **Step 2: Evaluate if this is actually needed**

Check what's in `adapter-plugins.json` in production:

```bash
# On the running pod or local dev
cat ~/.paperclip/adapter-plugins.json
cat ~/.paperclip/adapter-settings.json
```

If these are empty/defaults (no custom external adapters installed), this task can be **SKIPPED** — the defaults are fine and the files are recreated empty on startup.

- [ ] **Step 3: If needed, add DB persistence**

Only implement if Step 2 shows non-default values. Store as a JSON blob in a system settings table:

```typescript
// In adapter-plugin-store.ts, add DB read/write alongside file operations
async function loadStore(): Promise<AdapterPluginStore> {
  // Try file first (fast path)
  try { return JSON.parse(await fs.readFile(storePath, 'utf8')); }
  catch {
    // Fall back to DB
    const row = await db.select().from(systemSettings).where(eq(systemSettings.key, 'adapter-plugins'));
    return row ? JSON.parse(row.value) : { version: 1, adapters: [] };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/adapter-plugin-store.ts
git commit -m "fix(adapters): persist adapter plugin registry in DB for K8s resilience"
```

---

### Task 4: Verify skills DB fallback (already implemented)

**Files:**
- Verify: `server/src/services/company-skills.ts` (readFile fallback, bundledFiles in metadata)

- [ ] **Step 1: Verify the fix is deployed**

```bash
git log --oneline -5 server/src/services/company-skills.ts
```

Confirm the commit with "persist bundled files in metadata" is present.

- [ ] **Step 2: Test resilience**

1. Import a skill with reference files (e.g., `agentsinc-preview` with `references/browser-debugging.md`)
2. Delete the local skill files: `rm -rf ~/.paperclip/instances/default/skills/<companyId>/`
3. Try to read the skill file via API: `GET /api/companies/<id>/skills/<skillId>/files/references/browser-debugging.md`
4. Verify it returns content from DB fallback

---

### Task 5: Verify instructions S3 sync

**Files:**
- Verify: `server/src/services/instructions-s3-sync.ts`
- Verify: `server/src/services/agent-instructions.ts`

- [ ] **Step 1: Check S3 sync is wired up**

```bash
grep -n "instructionsS3Sync\|restoreFromS3\|saveToS3" server/src/services/agent-instructions.ts
```

Confirm that when `PAPERCLIP_STORAGE_PROVIDER=s3`, instruction file writes also sync to S3, and on startup, missing files are restored from S3.

- [ ] **Step 2: Test after pod restart**

1. Create an agent with custom instructions
2. Restart the pod
3. Verify instructions are restored from S3 and agent can execute

---

## Summary: Required ENV vars for K8s resilience

```bash
# S3 storage (enables persistence for logs, snapshots, instructions, uploads)
PAPERCLIP_STORAGE_PROVIDER=s3
PAPERCLIP_S3_ENDPOINT=https://<minio-endpoint>
PAPERCLIP_S3_BUCKET=paperclip
PAPERCLIP_S3_ACCESS_KEY=<key>
PAPERCLIP_S3_SECRET_KEY=<secret>
PAPERCLIP_S3_REGION=ap-southeast-1

# Secrets master key (prevents key loss on restart)
PAPERCLIP_SECRETS_MASTER_KEY=<32-byte-hex-string>
```

With these set, the only things lost on pod restart are:
- Server log files (stdout captures them anyway)
- Service registry PIDs (invalid after restart)
- Telemetry state (non-critical)
- Materialized skill files on disk (re-created on demand from DB)
