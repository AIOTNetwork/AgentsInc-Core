/**
 * Git operations for workspace management.
 *
 * Handles credential injection, fetch, commit, merge, and push
 * using GitHub App installation tokens.
 */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { logger } from "../middleware/logger.js";
import type { GitHubAppService } from "./github-app.js";

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT = 60_000;

interface GitResult {
  ok: boolean;
  warning?: string;
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
  try {
    // Temporarily set credentialed remote URL
    await execFile("git", ["-C", cwd, "remote", "set-url", "origin", credUrl], { timeout: GIT_TIMEOUT });

    // Fetch all branches
    await execFile("git", ["-C", cwd, "fetch", "origin", "--prune"], { timeout: GIT_TIMEOUT });

    // Reset to the target branch
    const targetRef = `origin/${branch}`;
    await execFile("git", ["-C", cwd, "reset", "--hard", targetRef], { timeout: GIT_TIMEOUT });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, warning: `git fetch+reset failed: ${msg}` };
  } finally {
    // Always clear credentials from remote URL
    await clearRemoteCredentials(cwd).catch(() => {});
  }
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
    // Reset remote to non-credentialed URL
    await execFile("git", ["-C", cwd, "remote", "set-url", "origin", cleanUrl], { timeout: GIT_TIMEOUT });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, warning: `git clone failed: ${msg}` };
  }
}

/**
 * Commit all changes, push the branch, merge to base branch, push base.
 */
export async function gitCommitMergeAndPush(opts: {
  cwd: string;
  credUrl: string;
  cleanUrl: string;
  branch: string;
  baseBranch: string;
  commitMessage: string;
}): Promise<GitResult> {
  const { cwd, credUrl, cleanUrl, branch, baseBranch, commitMessage } = opts;

  try {
    // 1. Stage and commit on the current branch
    await execFile("git", ["-C", cwd, "add", "-A"], { timeout: GIT_TIMEOUT });

    const { stdout: status } = await execFile("git", ["-C", cwd, "status", "--porcelain"], { timeout: 10_000 });
    if (!status.trim()) {
      return { ok: true, warning: "nothing to commit" };
    }

    await execFile("git", ["-C", cwd, "commit", "-m", commitMessage], { timeout: GIT_TIMEOUT });

    // 2. Set credentialed remote
    await execFile("git", ["-C", cwd, "remote", "set-url", "origin", credUrl], { timeout: GIT_TIMEOUT });

    // 3. Push the branch
    await execFile("git", ["-C", cwd, "push", "origin", `HEAD:${branch}`, "--force-with-lease"], { timeout: GIT_TIMEOUT });

    // 4. Merge to base branch from the main repo (not the worktree)
    const mergeResult = await mergeToBase(cwd, credUrl, branch, baseBranch);

    // 5. Clear credentials
    await clearRemoteCredentials(cwd).catch(() => {});

    if (!mergeResult.ok) {
      return { ok: true, warning: `branch pushed but merge failed: ${mergeResult.warning}` };
    }

    return { ok: true };
  } catch (err) {
    await clearRemoteCredentials(cwd).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, warning: `git commit+push failed: ${msg}` };
  }
}

/**
 * Merge a branch into the base branch using the main repo checkout.
 * For worktrees, we need to operate on the main repo, not the worktree.
 */
async function mergeToBase(
  worktreeCwd: string,
  credUrl: string,
  branch: string,
  baseBranch: string,
): Promise<GitResult> {
  try {
    // Find the main repo root (git-common-dir for worktrees)
    const { stdout: commonDir } = await execFile(
      "git", ["-C", worktreeCwd, "rev-parse", "--git-common-dir"],
      { timeout: 10_000 },
    );
    const mainRepoGitDir = commonDir.trim();
    // The repo root is the parent of the .git directory
    const mainCwd = mainRepoGitDir.endsWith(".git")
      ? path.resolve(worktreeCwd, mainRepoGitDir, "..")
      : path.resolve(worktreeCwd, mainRepoGitDir, "..");

    // Verify main repo exists
    if (!fs.existsSync(path.join(mainCwd, ".git")) && !fs.existsSync(mainCwd)) {
      return { ok: false, warning: "main repo not found for merge" };
    }

    // Set credentials on main repo
    await execFile("git", ["-C", mainCwd, "remote", "set-url", "origin", credUrl], { timeout: GIT_TIMEOUT });

    // Fetch latest
    await execFile("git", ["-C", mainCwd, "fetch", "origin"], { timeout: GIT_TIMEOUT });

    // Checkout base branch
    await execFile("git", ["-C", mainCwd, "checkout", baseBranch], { timeout: GIT_TIMEOUT });

    // Pull latest base
    await execFile("git", ["-C", mainCwd, "pull", "origin", baseBranch, "--ff-only"], { timeout: GIT_TIMEOUT }).catch(() => {});

    // Merge the branch
    await execFile("git", ["-C", mainCwd, "merge", branch, "-m", `merge ${branch} into ${baseBranch}`], { timeout: GIT_TIMEOUT });

    // Push base branch
    await execFile("git", ["-C", mainCwd, "push", "origin", baseBranch], { timeout: GIT_TIMEOUT });

    // Clear credentials
    await clearRemoteCredentials(mainCwd).catch(() => {});

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, branch, baseBranch }, "merge to base failed");

    // Try to abort the merge if it's in a conflict state
    try {
      const { stdout: commonDir } = await execFile(
        "git", ["-C", worktreeCwd, "rev-parse", "--git-common-dir"],
        { timeout: 10_000 },
      );
      const mainCwd = path.resolve(worktreeCwd, commonDir.trim(), "..");
      await execFile("git", ["-C", mainCwd, "merge", "--abort"], { timeout: 10_000 }).catch(() => {});
      await clearRemoteCredentials(mainCwd).catch(() => {});
    } catch { /* best effort */ }

    return { ok: false, warning: msg };
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
