/**
 * Git operations for workspace management.
 *
 * Handles credential injection, fetch, commit, merge, and push
 * using GitHub App installation tokens.
 *
 * Key design:
 * - Agents commit locally in their worktree, merge into base (main) locally, push only base.
 * - No feature branches are pushed to remote — only the base branch reaches origin.
 * - Per-directory mutex prevents concurrent git index corruption.
 * - Merge conflicts return structured info so callers can create resolution issues.
 */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { logger } from "../middleware/logger.js";
import type { GitHubAppService } from "./github-app.js";

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT = 60_000;

// ── Types ───────────────────────────────────────────────────────────────

interface GitResult {
  ok: boolean;
  warning?: string;
}

export interface GitMergeResult extends GitResult {
  conflicted?: boolean;
  conflictFiles?: string[];
}

// ── Per-directory mutex ─────────────────────────────────────────────────

const directoryLocks = new Map<string, Promise<void>>();

/**
 * Serialize git operations on the same directory to prevent index corruption.
 */
async function withDirectoryLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(cwd);
  while (directoryLocks.has(key)) {
    await directoryLocks.get(key);
  }
  let resolve!: () => void;
  const lock = new Promise<void>((r) => { resolve = r; });
  directoryLocks.set(key, lock);
  try {
    return await fn();
  } finally {
    directoryLocks.delete(key);
    resolve();
  }
}

/**
 * Fetch latest from remote and reset to the target branch.
 * Used before agent runs to ensure fresh code.
 */
export async function gitFetchAndReset(
  cwd: string,
  credUrl: string,
  branch: string,
): Promise<GitResult> {
  return withDirectoryLock(cwd, async () => {
    try {
      await execFile("git", ["-C", cwd, "remote", "set-url", "origin", credUrl], { timeout: GIT_TIMEOUT });
      await execFile("git", ["-C", cwd, "fetch", "origin", "--prune"], { timeout: GIT_TIMEOUT });

      const targetRef = `origin/${branch}`;
      await execFile("git", ["-C", cwd, "reset", "--hard", targetRef], { timeout: GIT_TIMEOUT });

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, warning: `git fetch+reset failed: ${msg}` };
    } finally {
      await clearRemoteCredentials(cwd).catch(() => {});
    }
  });
}

/**
 * Clone a repo with credentials. Uses shallow clone for speed.
 */
export async function gitClone(
  credUrl: string,
  cwd: string,
  cleanUrl: string,
): Promise<GitResult> {
  try {
    await execFile("git", ["clone", "--depth", "1", credUrl, cwd], { timeout: GIT_TIMEOUT });
    await execFile("git", ["-C", cwd, "remote", "set-url", "origin", cleanUrl], { timeout: GIT_TIMEOUT });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, warning: `git clone failed: ${msg}` };
  }
}

/**
 * Stage and commit all changes in the working directory.
 * Local only — does not push or merge anything.
 */
export async function gitCommitLocal(opts: {
  cwd: string;
  commitMessage: string;
}): Promise<GitResult> {
  return withDirectoryLock(opts.cwd, async () => {
    const { cwd, commitMessage } = opts;
    try {
      await execFile("git", ["-C", cwd, "add", "-A"], { timeout: GIT_TIMEOUT });
      const { stdout: status } = await execFile("git", ["-C", cwd, "status", "--porcelain"], { timeout: 10_000 });
      if (!status.trim()) {
        return { ok: true, warning: "nothing to commit" };
      }
      await execFile("git", ["-C", cwd, "commit", "-m", commitMessage], { timeout: GIT_TIMEOUT });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, warning: `git commit failed: ${msg}` };
    }
  });
}

/**
 * Merge a worktree branch into the base branch locally, then push base to remote.
 * No feature branches are pushed — only the base branch (e.g. main) reaches origin.
 */
export async function gitMergeLocalAndPushBase(opts: {
  worktreeCwd: string;
  credUrl: string;
  branch: string;
  baseBranch: string;
}): Promise<GitMergeResult> {
  const { worktreeCwd, credUrl, branch, baseBranch } = opts;

  const mainCwd = await resolveMainRepoCwd(worktreeCwd);
  if (!mainCwd) {
    return { ok: false, warning: "main repo not found for merge", conflicted: false };
  }

  return withDirectoryLock(mainCwd, async () => {
    try {
      await execFile("git", ["-C", mainCwd, "remote", "set-url", "origin", credUrl], { timeout: GIT_TIMEOUT });
      await execFile("git", ["-C", mainCwd, "fetch", "origin"], { timeout: GIT_TIMEOUT });
      await execFile("git", ["-C", mainCwd, "checkout", baseBranch], { timeout: GIT_TIMEOUT });
      await execFile("git", ["-C", mainCwd, "pull", "origin", baseBranch, "--ff-only"], { timeout: GIT_TIMEOUT }).catch(() => {});

      try {
        await execFile("git", ["-C", mainCwd, "merge", branch, "-m", `merge ${branch} into ${baseBranch}`], { timeout: GIT_TIMEOUT });
      } catch (mergeErr) {
        const { stdout: conflictList } = await execFile(
          "git", ["-C", mainCwd, "diff", "--name-only", "--diff-filter=U"],
          { timeout: 10_000 },
        ).catch(() => ({ stdout: "" }));
        const conflictFiles = conflictList.trim().split("\n").filter(Boolean);
        await execFile("git", ["-C", mainCwd, "merge", "--abort"], { timeout: 10_000 }).catch(() => {});
        await clearRemoteCredentials(mainCwd).catch(() => {});
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        logger.warn({ err: mergeErr, branch, baseBranch, conflictFiles }, "merge to base conflicted");
        return { ok: false, conflicted: true, conflictFiles, warning: msg };
      }

      await execFile("git", ["-C", mainCwd, "push", "origin", baseBranch], { timeout: GIT_TIMEOUT });
      await clearRemoteCredentials(mainCwd).catch(() => {});
      return { ok: true, conflicted: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, branch, baseBranch }, "merge+push base failed");
      await execFile("git", ["-C", mainCwd, "merge", "--abort"], { timeout: 10_000 }).catch(() => {});
      await clearRemoteCredentials(mainCwd).catch(() => {});
      return { ok: false, conflicted: false, warning: msg };
    }
  });
}

/**
 * Commit locally, merge into base, push base to remote.
 * Backward-compatible wrapper — existing heartbeat code continues to work.
 * No feature branches are pushed to remote.
 */
export async function gitCommitMergeAndPush(opts: {
  cwd: string;
  credUrl: string;
  cleanUrl: string;
  branch: string;
  baseBranch: string;
  commitMessage: string;
}): Promise<GitMergeResult> {
  const commitResult = await gitCommitLocal({
    cwd: opts.cwd,
    commitMessage: opts.commitMessage,
  });

  if (!commitResult.ok) {
    return { ...commitResult, conflicted: false };
  }
  if (commitResult.warning === "nothing to commit") {
    return { ...commitResult, conflicted: false };
  }

  const mergeResult = await gitMergeLocalAndPushBase({
    worktreeCwd: opts.cwd,
    credUrl: opts.credUrl,
    branch: opts.branch,
    baseBranch: opts.baseBranch,
  });

  if (!mergeResult.ok) {
    return {
      ok: false,
      warning: `committed locally but merge to ${opts.baseBranch} failed: ${mergeResult.warning}`,
      conflicted: mergeResult.conflicted,
      conflictFiles: mergeResult.conflictFiles,
    };
  }

  return { ok: true, conflicted: false };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the main repo root from a worktree path.
 */
async function resolveMainRepoCwd(worktreeCwd: string): Promise<string | null> {
  try {
    const { stdout: commonDir } = await execFile(
      "git", ["-C", worktreeCwd, "rev-parse", "--git-common-dir"],
      { timeout: 10_000 },
    );
    const mainRepoGitDir = commonDir.trim();
    const mainCwd = mainRepoGitDir.endsWith(".git")
      ? path.resolve(worktreeCwd, mainRepoGitDir, "..")
      : path.resolve(worktreeCwd, mainRepoGitDir, "..");
    if (!fs.existsSync(path.join(mainCwd, ".git")) && !fs.existsSync(mainCwd)) {
      return null;
    }
    return mainCwd;
  } catch {
    return null;
  }
}

/**
 * Remove credentials from the remote URL (set back to clean HTTPS).
 */
async function clearRemoteCredentials(cwd: string): Promise<void> {
  try {
    const { stdout } = await execFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: 10_000 });
    const url = stdout.trim();
    if (url.includes("@")) {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      await execFile("git", ["-C", cwd, "remote", "set-url", "origin", parsed.toString()], { timeout: 10_000 });
    }
  } catch { /* ignore */ }
}
