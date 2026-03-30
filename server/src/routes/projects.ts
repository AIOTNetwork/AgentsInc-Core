import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import {
  createProjectSchema,
  createProjectWorkspaceSchema,
  isUuidLike,
  updateProjectSchema,
  updateProjectWorkspaceSchema,
} from "@paperclipai/shared";
import { trackProjectCreated } from "@paperclipai/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { projectService, heartbeatService, logActivity, workspaceOperationService } from "../services/index.js";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";
import { conflict, notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { startRuntimeServicesForWorkspaceControl, stopRuntimeServicesForProjectWorkspace } from "../services/workspace-runtime.js";
import { getTelemetryClient } from "../telemetry.js";
import { createWorkspaceSnapshot, getWorkspaceS3Sync } from "../services/workspace-snapshot.js";
import { gitClone, gitFetchAndReset } from "../services/workspace-git.js";
import fsSync from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);
  const workspaceOperations = workspaceOperationService(db);
  const heartbeat = heartbeatService(db);

  async function resolveCompanyIdForProjectReference(req: Request) {
    const companyIdQuery = req.query.companyId;
    const requestedCompanyId =
      typeof companyIdQuery === "string" && companyIdQuery.trim().length > 0
        ? companyIdQuery.trim()
        : null;
    if (requestedCompanyId) {
      assertCompanyAccess(req, requestedCompanyId);
      return requestedCompanyId;
    }
    if (req.actor.type === "agent" && req.actor.companyId) {
      return req.actor.companyId;
    }
    return null;
  }

  async function normalizeProjectReference(req: Request, rawId: string) {
    if (isUuidLike(rawId)) return rawId;
    const companyId = await resolveCompanyIdForProjectReference(req);
    if (!companyId) return rawId;
    const resolved = await svc.resolveByReference(companyId, rawId);
    if (resolved.ambiguous) {
      throw conflict("Project shortname is ambiguous in this company. Use the project ID.");
    }
    return resolved.project?.id ?? rawId;
  }

  router.param("id", async (req, _res, next, rawId) => {
    try {
      req.params.id = await normalizeProjectReference(req, rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/companies/:companyId/projects", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  router.get("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    res.json(project);
  });

  router.post("/companies/:companyId/projects", validate(createProjectSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    type CreateProjectPayload = Parameters<typeof svc.create>[1] & {
      workspace?: Parameters<typeof svc.createWorkspace>[1];
    };

    const { workspace, ...projectData } = req.body as CreateProjectPayload;
    const project = await svc.create(companyId, projectData);
    let createdWorkspaceId: string | null = null;
    if (workspace) {
      const createdWorkspace = await svc.createWorkspace(project.id, workspace);
      if (!createdWorkspace) {
        await svc.remove(project.id);
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }
      createdWorkspaceId = createdWorkspace.id;
    } else {
      // Auto-create a workspace with a GitHub repo when none provided
      try {
        const { githubAppService } = await import("../services/github-app.js");
        const github = githubAppService(db);
        const repo = await github.createDefaultRepo(companyId, project.name);
        const createdWorkspace = await svc.createWorkspace(project.id, {
          name: project.name,
          repoUrl: repo.cloneUrl,
        });
        if (createdWorkspace) createdWorkspaceId = createdWorkspace.id;
        console.log(`[projects] Auto-created workspace with repo ${repo.fullName} for project "${project.name}"`);
      } catch (err) {
        console.warn("[projects] Auto-workspace creation failed:", err instanceof Error ? err.message : err);
      }
    }
    const hydratedProject = createdWorkspaceId ? await svc.getById(project.id) : project;

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      details: {
        name: project.name,
        workspaceId: createdWorkspaceId,
      },
    });
    const telemetryClient = getTelemetryClient();
    if (telemetryClient) {
      trackProjectCreated(telemetryClient);
    }
    res.status(201).json(hydratedProject ?? project);
  });

  router.patch("/projects/:id", validate(updateProjectSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const body = { ...req.body };
    if (typeof body.archivedAt === "string") {
      body.archivedAt = new Date(body.archivedAt);
    }
    const project = await svc.update(id, body);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Rename managed GitHub repo if project name changed
    if (req.body.name && existing.name !== project.name && project.workspaces?.length) {
      const { githubAppService } = await import("../services/github-app.js");
      const github = githubAppService(db);
      for (const ws of project.workspaces) {
        if (!ws.repoUrl || !github.isManagedRepo(ws.repoUrl, project.companyId)) continue;
        const fullName = github.parseRepoFullName(ws.repoUrl);
        if (!fullName) continue;
        const newRepoName = github.deriveRepoName(project.companyId, project.name);
        const newCloneUrl = await github.renameRepo(project.companyId, fullName, newRepoName);
        if (newCloneUrl) {
          await svc.updateWorkspace(project.id, ws.id, { repoUrl: newCloneUrl });
        }
      }
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      details: req.body,
    });

    res.json(project);
  });

  router.get("/projects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const workspaces = await svc.listWorkspaces(id);
    res.json(workspaces);
  });

  router.post("/projects/:id/workspaces", validate(createProjectWorkspaceSchema), async (req, res) => {
    const id = req.params.id as string;
    console.log(`[projects] POST /projects/${id}/workspaces`, JSON.stringify(req.body));
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const workspace = await svc.createWorkspace(id, req.body);
    if (!workspace) {
      console.warn(`[projects] createWorkspace returned null for project ${id}`);
      res.status(422).json({ error: "Invalid project workspace payload" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_created",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        isPrimary: workspace.isPrimary,
      },
    });

    res.status(201).json(workspace);
  });

  router.patch(
    "/projects/:id/workspaces/:workspaceId",
    validate(updateProjectWorkspaceSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const workspaceId = req.params.workspaceId as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const workspaceExists = (await svc.listWorkspaces(id)).some((workspace) => workspace.id === workspaceId);
      if (!workspaceExists) {
        res.status(404).json({ error: "Project workspace not found" });
        return;
      }
      const workspace = await svc.updateWorkspace(id, workspaceId, req.body);
      if (!workspace) {
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "project.workspace_updated",
        entityType: "project",
        entityId: id,
        details: {
          workspaceId: workspace.id,
          changedKeys: Object.keys(req.body).sort(),
        },
      });

      res.json(workspace);
    },
  );

  router.post("/projects/:id/workspaces/:workspaceId/runtime-services/:action", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const action = String(req.params.action ?? "").trim().toLowerCase();
    if (action !== "start" && action !== "stop" && action !== "restart") {
      res.status(404).json({ error: "Runtime service action not found" });
      return;
    }

    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);

    const workspace = project.workspaces.find((entry) => entry.id === workspaceId) ?? null;
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }

    const workspaceCwd = workspace.cwd;
    if (!workspaceCwd) {
      res.status(422).json({ error: "Project workspace needs a local path before Paperclip can manage local runtime services" });
      return;
    }

    const runtimeConfig = workspace.runtimeConfig?.workspaceRuntime ?? null;
    if ((action === "start" || action === "restart") && !runtimeConfig) {
      res.status(422).json({ error: "Project workspace has no runtime service configuration" });
      return;
    }

    const actor = getActorInfo(req);
    const recorder = workspaceOperations.createRecorder({ companyId: project.companyId });
    let runtimeServiceCount = workspace.runtimeServices?.length ?? 0;
    const stdout: string[] = [];
    const stderr: string[] = [];

    const operation = await recorder.recordOperation({
      phase: action === "stop" ? "workspace_teardown" : "workspace_provision",
      command: `workspace runtime ${action}`,
      cwd: workspace.cwd,
      metadata: {
        action,
        projectId: project.id,
        projectWorkspaceId: workspace.id,
      },
      run: async () => {
        const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
          if (stream === "stdout") stdout.push(chunk);
          else stderr.push(chunk);
        };

        if (action === "stop" || action === "restart") {
          await stopRuntimeServicesForProjectWorkspace({
            db,
            projectWorkspaceId: workspace.id,
          });
        }

        if (action === "start" || action === "restart") {
          const startedServices = await startRuntimeServicesForWorkspaceControl({
            db,
            actor: {
              id: actor.agentId ?? null,
              name: actor.actorType === "user" ? "Board" : "Agent",
              companyId: project.companyId,
            },
            issue: null,
            workspace: {
              baseCwd: workspaceCwd,
              source: "project_primary",
              projectId: project.id,
              workspaceId: workspace.id,
              repoUrl: workspace.repoUrl,
              repoRef: workspace.repoRef,
              strategy: "project_primary",
              cwd: workspaceCwd,
              branchName: workspace.defaultRef ?? workspace.repoRef ?? null,
              worktreePath: null,
              warnings: [],
              created: false,
            },
            config: { workspaceRuntime: runtimeConfig },
            adapterEnv: {},
            onLog,
          });
          runtimeServiceCount = startedServices.length;
        } else {
          runtimeServiceCount = 0;
        }

        await svc.updateWorkspace(project.id, workspace.id, {
          runtimeConfig: {
            desiredState: action === "stop" ? "stopped" : "running",
          },
        });

        return {
          status: "succeeded",
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          system:
            action === "stop"
              ? "Stopped project workspace runtime services.\n"
              : action === "restart"
                ? "Restarted project workspace runtime services.\n"
                : "Started project workspace runtime services.\n",
          metadata: {
            runtimeServiceCount,
          },
        };
      },
    });

    const updatedWorkspace = (await svc.listWorkspaces(project.id)).find((entry) => entry.id === workspace.id) ?? workspace;

    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: `project.workspace_runtime_${action}`,
      entityType: "project",
      entityId: project.id,
      details: {
        projectWorkspaceId: workspace.id,
        runtimeServiceCount,
      },
    });

    res.json({
      workspace: updatedWorkspace,
      operation,
    });
  });

  router.delete("/projects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const workspace = await svc.removeWorkspace(id, workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_deleted",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
      },
    });

    res.json(workspace);
  });

  router.delete("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    // Delete managed GitHub repos before DB delete
    if (existing.workspaces?.length) {
      const { githubAppService } = await import("../services/github-app.js");
      const github = githubAppService(db);
      for (const ws of existing.workspaces) {
        if (!ws.repoUrl || !github.isManagedRepo(ws.repoUrl, existing.companyId)) continue;
        const fullName = github.parseRepoFullName(ws.repoUrl);
        if (fullName) await github.deleteRepo(existing.companyId, fullName);
      }
    }

    const project = await svc.remove(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.deleted",
      entityType: "project",
      entityId: project.id,
    });

    res.json(project);
  });

  // --- Workspace File Browser ---

  function resolveWorkspaceDir(project: { codebase: { effectiveLocalFolder: string | null; managedFolder?: string | null } }): string | null {
    const candidates = [project.codebase.effectiveLocalFolder, project.codebase.managedFolder];
    for (const dir of candidates) {
      if (dir && fsSync.existsSync(dir) && fsSync.statSync(dir).isDirectory()) return dir;
    }
    return null;
  }

  /**
   * If the workspace directory is missing (e.g. after a redeploy) but the project
   * has a git repo URL, clone it to the managed workspace path so that previews,
   * file browsing, and snapshots work without manual intervention.
   */
  async function ensureWorkspaceCloned(project: {
    id: string;
    companyId: string;
    codebase: { repoUrl: string | null; managedFolder: string; effectiveLocalFolder: string | null };
  }): Promise<string | null> {
    // Already exists on disk — nothing to do
    const existing = resolveWorkspaceDir(project);
    if (existing) return existing;

    const repoUrl = project.codebase.repoUrl;
    if (!repoUrl) return null;

    const cwd = project.codebase.managedFolder;
    await fsPromises.mkdir(path.dirname(cwd), { recursive: true });

    // Check if directory exists but is not a git checkout (e.g. leftover empty dir)
    const stats = await fsPromises.stat(cwd).catch(() => null);
    const gitDirExists = await fsPromises
      .stat(path.resolve(cwd, ".git"))
      .then((entry) => entry.isDirectory())
      .catch(() => false);

    if (gitDirExists) {
      // Workspace dir exists with .git — just fetch + reset to latest
      const defaultBranch = await getDefaultBranch(cwd).catch(() => "main");
      const credUrl = await getCredentialUrl(project.companyId, repoUrl);
      await gitFetchAndReset(cwd, credUrl, defaultBranch);
      return cwd;
    }

    if (stats) {
      const entries = await fsPromises.readdir(cwd).catch(() => []);
      if (entries.length > 0) return cwd; // non-empty, non-git dir — use as-is
      await fsPromises.rm(cwd, { recursive: true, force: true });
    }

    // Clone the repo
    const credUrl = await getCredentialUrl(project.companyId, repoUrl);
    const result = await gitClone(credUrl, cwd, repoUrl);
    if (!result.ok) return null;
    return cwd;
  }

  async function getDefaultBranch(cwd: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["-C", cwd, "symbolic-ref", "--short", "HEAD"], { timeout: 5000 });
    return stdout.trim() || "main";
  }

  async function getCredentialUrl(companyId: string, repoUrl: string): Promise<string> {
    try {
      const { githubAppService } = await import("../services/github-app.js");
      const github = githubAppService(db);
      return await github.getCredentialUrl(companyId, repoUrl);
    } catch {
      return repoUrl;
    }
  }

  const FILE_EXCLUDES = new Set(["node_modules", ".git", ".next", ".nuxt", "dist", "build", ".cache", ".turbo", ".vercel", "__pycache__", "coverage", ".nyc_output"]);

  interface FileEntry { name: string; path: string; type: "file" | "dir"; size?: number }

  async function listDir(root: string, relPath: string): Promise<FileEntry[]> {
    const absDir = path.resolve(root, relPath);
    // Prevent directory traversal
    if (!absDir.startsWith(root)) return [];
    const entries = await fsPromises.readdir(absDir, { withFileTypes: true }).catch(() => []);
    const result: FileEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (FILE_EXCLUDES.has(entry.name)) continue;
      const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push({ name: entry.name, path: entryRelPath, type: "dir" });
      } else if (entry.isFile()) {
        const stat = await fsPromises.stat(path.join(absDir, entry.name)).catch(() => null);
        result.push({ name: entry.name, path: entryRelPath, type: "file", size: stat?.size ?? 0 });
      }
    }
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  router.get("/projects/:id/workspace/files", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const root = resolveWorkspaceDir(project) ?? await ensureWorkspaceCloned(project);
    if (!root) {
      res.status(404).json({ error: "workspace_not_found", files: [] });
      return;
    }

    const dirPath = typeof req.query.path === "string" ? req.query.path : "";
    const files = await listDir(root, dirPath);
    res.json({ root: dirPath || ".", files });
  });

  router.get("/projects/:id/workspace/files/read", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const root = resolveWorkspaceDir(project) ?? await ensureWorkspaceCloned(project);
    if (!root) { res.status(404).json({ error: "workspace_not_found" }); return; }

    const filePath = typeof req.query.path === "string" ? req.query.path : "";
    if (!filePath) { res.status(400).json({ error: "path is required" }); return; }

    const absPath = path.resolve(root, filePath);
    if (!absPath.startsWith(root)) { res.status(403).json({ error: "path traversal" }); return; }

    try {
      const stat = await fsPromises.stat(absPath);
      if (!stat.isFile()) { res.status(400).json({ error: "not a file" }); return; }
      if (stat.size > 512 * 1024) { res.status(422).json({ error: "file too large", size: stat.size }); return; }
      const content = await fsPromises.readFile(absPath, "utf-8");
      res.json({ path: filePath, content, size: stat.size });
    } catch {
      res.status(404).json({ error: "file not found" });
    }
  });

  // --- Ensure Workspace (clone if missing after redeploy) ---

  router.post("/projects/:id/workspace/ensure", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const existing = resolveWorkspaceDir(project);
    if (existing) {
      res.json({ ok: true, cwd: existing, cloned: false });
      return;
    }

    const cloned = await ensureWorkspaceCloned(project);
    if (cloned) {
      res.json({ ok: true, cwd: cloned, cloned: true });
    } else {
      res.status(422).json({ error: "no_repo", message: "Project has no git repo to clone" });
    }
  });

  // --- Workspace Git Status (pre-preview check) ---

  router.get("/projects/:id/workspace/git-status", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const wsDir = resolveWorkspaceDir(project);
    if (!wsDir) {
      res.json({ ok: true, isGit: false, message: "No local workspace" });
      return;
    }

    const gitDir = path.join(wsDir, ".git");
    if (!fsSync.existsSync(gitDir)) {
      res.json({ ok: true, isGit: false, message: "Workspace is not a git repo" });
      return;
    }

    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFileCb);

    try {
      // Check for uncommitted changes (staged + unstaged + untracked)
      const { stdout: statusOut } = await execFileAsync(
        "git", ["-C", wsDir, "status", "--porcelain"],
        { timeout: 10_000 },
      );
      const uncommittedFiles = statusOut.trim().split("\n").filter(Boolean);
      const hasUncommitted = uncommittedFiles.length > 0;

      // Check for unpushed commits
      let unpushedCount = 0;
      let hasRemote = false;
      try {
        const { stdout: trackingBranch } = await execFileAsync(
          "git", ["-C", wsDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
          { timeout: 5_000 },
        );
        hasRemote = !!trackingBranch.trim();
        if (hasRemote) {
          const { stdout: logOut } = await execFileAsync(
            "git", ["-C", wsDir, "log", "@{u}..HEAD", "--oneline"],
            { timeout: 5_000 },
          );
          unpushedCount = logOut.trim().split("\n").filter(Boolean).length;
        }
      } catch {
        // No upstream tracking branch — check if remote exists at all
        try {
          const { stdout: remoteOut } = await execFileAsync(
            "git", ["-C", wsDir, "remote"],
            { timeout: 5_000 },
          );
          hasRemote = !!remoteOut.trim();
          if (hasRemote) {
            // Has remote but no tracking — all local commits are unpushed
            const { stdout: logOut } = await execFileAsync(
              "git", ["-C", wsDir, "log", "--oneline"],
              { timeout: 5_000 },
            );
            unpushedCount = logOut.trim().split("\n").filter(Boolean).length;
          }
        } catch { /* ignore */ }
      }

      // Check if Dockerfile exists
      const hasDockerfile = fsSync.existsSync(path.join(wsDir, "Dockerfile"));

      const ready = !hasUncommitted && unpushedCount === 0;

      res.json({
        ok: true,
        isGit: true,
        ready,
        hasUncommitted,
        uncommittedCount: uncommittedFiles.length,
        uncommittedFiles: uncommittedFiles.slice(0, 20), // cap for response size
        unpushedCount,
        hasRemote,
        hasDockerfile,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: "git_status_failed", message: msg });
    }
  });

  // --- Workspace Snapshot (for preview) ---

  router.post("/projects/:id/workspace/snapshot", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    // Ensure workspace is cloned if missing (e.g. after a redeploy)
    await ensureWorkspaceCloned(project);

    // Auto-push uncommitted changes to git before snapshot (non-fatal)
    const snapshotWsDir = resolveWorkspaceDir(project);
    if (snapshotWsDir && fsSync.existsSync(path.join(snapshotWsDir, ".git")) && project.codebase.repoUrl) {
      try {
        const snapshotCredUrl = await getCredentialUrl(project.companyId, project.codebase.repoUrl);
        const snapshotBranch = await getDefaultBranch(snapshotWsDir).catch(() => "main");
        const snapshotBaseBranch = project.codebase.repoRef ?? "main";

        const commitResult = await gitCommitLocal({
          cwd: snapshotWsDir,
          commitMessage: `workspace sync before preview: ${project.name}`,
        });

        if (commitResult.ok && commitResult.warning !== "nothing to commit") {
          const mergeResult = await gitMergeLocalAndPushBase({
            worktreeCwd: snapshotWsDir,
            credUrl: snapshotCredUrl,
            branch: snapshotBranch,
            baseBranch: snapshotBaseBranch,
          });
          if (mergeResult.warning) {
            logger.info({ warning: mergeResult.warning, projectId: project.id }, "pre-snapshot merge+push warning");
          }
        }
      } catch (pushErr) {
        logger.warn({ err: pushErr, projectId: project.id }, "pre-snapshot git sync failed (non-fatal)");
      }
    }

    try {
      const result = await createWorkspaceSnapshot(project);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workspace directory not found on server";
      const isNotFound = message.includes("not found") || message.includes("not a directory");
      const errorCode = isNotFound ? "workspace_not_found" : "snapshot_failed";

      // Check for missing Dockerfile
      const wsDir = resolveWorkspaceDir(project);
      const hasDockerfile = wsDir ? fsSync.existsSync(path.join(wsDir, "Dockerfile")) : false;

      // Auto-create a detailed issue and assign to the CEO agent
      let issueId: string | null = null;
      try {
        const { agents: agentsTable } = await import("@paperclipai/db");
        const { eq, and } = await import("drizzle-orm");
        const issueSvc = (await import("../services/index.js")).issueService(db);

        // Find existing open preview issue for this project
        const existingIssues = await issueSvc.list(project.companyId, { projectId: project.id });
        const alreadyHasPreviewIssue = existingIssues.some(
          (i) => i.title.includes("preview") && i.status !== "done" && i.status !== "cancelled",
        );

        if (!alreadyHasPreviewIssue) {
          // Find the CEO agent for this company
          const ceoAgent = await db
            .select({ id: agentsTable.id })
            .from(agentsTable)
            .where(and(eq(agentsTable.companyId, project.companyId), eq(agentsTable.role, "ceo")))
            .then((rows) => rows[0] ?? null);

          const description = [
            `Preview snapshot failed for project "${project.name}".`,
            ``,
            `- **Error:** \`${errorCode}\``,
            `- **Details:** ${message}`,
            `- **Workspace directory:** ${wsDir ?? "not found"}`,
            `- **Dockerfile present:** ${hasDockerfile ? "yes" : "no"}`,
            ``,
            `Use the preview skill to diagnose and fix this issue.`,
          ].join("\n");

          const created = await issueSvc.create(project.companyId, {
            title: `Fix preview deployment for "${project.name}"`,
            projectId: project.id,
            priority: "high",
            status: "todo",
            description,
            ...(ceoAgent ? { assigneeAgentId: ceoAgent.id } : {}),
          });
          issueId = created.id;

          // Wake the CEO so it picks up the issue immediately
          if (ceoAgent) {
            void queueIssueAssignmentWakeup({
              heartbeat,
              issue: { id: created.id, assigneeAgentId: ceoAgent.id, status: "todo" },
              reason: "preview_build_failed",
              mutation: "create",
              contextSource: "preview.snapshot_failed",
              requestedByActorType: "system",
            });
          }
        }
      } catch (issueErr) {
        console.warn("[preview] Failed to create preview issue:", issueErr);
      }

      res.status(isNotFound ? 404 : 422).json({
        error: errorCode,
        message,
        ...(!hasDockerfile && { hint: "no_dockerfile" }),
        ...(issueId && { issueId }),
      });
    }
  });

  // --- Workspace Snapshot Download (for local disk storage without presigned URLs) ---

  router.get("/projects/:id/workspace/snapshot/download", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const objectKey = typeof req.query.key === "string" ? req.query.key : null;
    if (!objectKey) { res.status(400).json({ error: "key is required" }); return; }

    const { getStorageService } = await import("../storage/index.js");
    const storage = getStorageService();
    try {
      const result = await storage.getObject(project.companyId, objectKey);
      res.setHeader("Content-Type", result.contentType ?? "application/gzip");
      if (result.contentLength) res.setHeader("Content-Length", String(result.contentLength));
      res.setHeader("Content-Disposition", "attachment; filename=snapshot.tar.gz");
      result.stream.pipe(res);
    } catch {
      res.status(404).json({ error: "snapshot not found" });
    }
  });

  // --- Workspace Sync (upload tar.gz to S3 for cloud previews) ---

  const workspaceSyncUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 }, // 100MB
  });

  async function runSyncUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      workspaceSyncUpload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  router.post("/projects/:id/workspace/sync", async (req, res) => {
    const project = await svc.getById(req.params.id);
    if (!project) throw notFound("Project not found");
    assertCompanyAccess(req, project.companyId);

    const sync = getWorkspaceS3Sync();
    if (!sync.enabled) {
      res.status(422).json({ error: "s3_not_configured", message: "S3/MinIO storage is required for workspace sync" });
      return;
    }

    try {
      await runSyncUpload(req, res);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
        res.status(422).json({ error: "file_too_large", message: "Workspace snapshot exceeds 100MB limit" });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "missing_file", message: "Missing file field 'file'" });
      return;
    }

    await sync.saveSnapshot(project.companyId, project.id, file.buffer);
    res.json({ ok: true, byteSize: file.buffer.length });
  });

  return router;
}
