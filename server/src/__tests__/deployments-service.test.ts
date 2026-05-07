import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, companies, projects, projectDeployments, agents } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { DeploymentAction, DeploymentResultKind, DeploymentStatus, DeploymentType } from "@paperclipai/shared";
import { deploymentsService, DeploymentServiceError } from "../services/deployments.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("deploymentsService.applyPatch", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let projectId!: string;
  let wakeup!: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("deployments-service-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => { await tempDb?.cleanup(); });

  afterEach(async () => {
    await db.delete(projectDeployments);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  beforeEach(async () => {
    const [c] = await db.insert(companies).values({ name: "T", issuePrefix: `T${Date.now()}` }).returning();
    const [p] = await db.insert(projects).values({ companyId: c.id, name: "P" }).returning();
    await db.insert(agents).values({ companyId: c.id, name: "CEO", role: "ceo" });
    companyId = c.id; projectId = p.id;
    wakeup = vi.fn(async () => ({ runId: "run-1" }));
  });

  it("creates a pending row on first deploy and wakes CEO once", async () => {
    const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
    const res = await svc.applyPatch({
      companyId, projectId, userId: "u1",
      body: { action: DeploymentAction.DEPLOY, targets: [{ targetName: "web", type: DeploymentType.PREVIEW }] },
    });
    expect(res.deployments).toHaveLength(1);
    expect(res.deployments[0]!.status).toBe(DeploymentStatus.PENDING);
    expect(wakeup).toHaveBeenCalledTimes(1);
  });

  it("rejects stop when target row is missing", async () => {
    const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
    await expect(svc.applyPatch({
      companyId, projectId, userId: "u1",
      body: { action: DeploymentAction.STOP, targets: [{ targetName: "missing" }] },
    })).rejects.toBeInstanceOf(DeploymentServiceError);
  });

  it("rejects stop when target not idle", async () => {
    await db.insert(projectDeployments).values({
      companyId, projectId, targetName: "web",
      type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYING,
    });
    const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
    await expect(svc.applyPatch({
      companyId, projectId, userId: "u1",
      body: { action: DeploymentAction.STOP, targets: [{ targetName: "web" }] },
    })).rejects.toMatchObject({ code: "invalid_state" });
  });

  describe("bypassCoalesce on heartbeat wakes", () => {
    // Deployment wakes carry no taskKey/issueId, so the heartbeat coalescer
    // groups them under the same null scope and silently merges new deploy
    // wakes into any in-flight CEO run (e.g. an earlier teardown), losing
    // payload.kind and payload.deployments. We tell heartbeat to skip coalescing.
    it("deploy passes bypassCoalesce: true", async () => {
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      await svc.applyPatch({
        companyId, projectId, userId: "u1",
        body: { action: DeploymentAction.DEPLOY, targets: [{ targetName: "web", type: DeploymentType.PREVIEW }] },
      });
      expect(wakeup).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bypassCoalesce: true }),
      );
    });

    it("stop passes bypassCoalesce: true", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYED,
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      await svc.applyPatch({
        companyId, projectId, userId: "u1",
        body: { action: DeploymentAction.STOP, targets: [{ targetName: "web" }] },
      });
      expect(wakeup).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bypassCoalesce: true }),
      );
    });

    it("refresh passes bypassCoalesce: true", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYED,
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      await svc.applyPatch({
        companyId, projectId, userId: "u1",
        body: { action: DeploymentAction.REFRESH },
      });
      expect(wakeup).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ bypassCoalesce: true }),
      );
    });
  });

  describe("sweepStuck", () => {
    it("flips DEPLOYING → DEPLOY_FAILED after the timeout window", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYING,
        updatedAt: new Date(Date.now() - 16 * 60 * 1000),
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const res = await svc.sweepStuck({ now: new Date() });
      expect(res.swept).toBe(1);
      const [row] = await db.select().from(projectDeployments);
      expect(row!.status).toBe(DeploymentStatus.DEPLOY_FAILED);
      expect(row!.lastError).toMatch(/timed out/i);
    });

    it("flips STOPPING → STOP_FAILED", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "api",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.STOPPING,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const res = await svc.sweepStuck({ now: new Date() });
      expect(res.swept).toBe(1);
      const [row] = await db.select().from(projectDeployments);
      expect(row!.status).toBe(DeploymentStatus.STOP_FAILED);
    });

    it("leaves fresh rows alone", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYING,
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const res = await svc.sweepStuck({ now: new Date() });
      expect(res.swept).toBe(0);
      const [row] = await db.select().from(projectDeployments);
      expect(row!.status).toBe(DeploymentStatus.DEPLOYING);
    });

    it("flips PENDING → DEPLOY_FAILED after the timeout window", async () => {
      await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.PENDING,
        updatedAt: new Date(Date.now() - 16 * 60 * 1000),
      });
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const res = await svc.sweepStuck({ now: new Date() });
      expect(res.swept).toBe(1);
      const [row] = await db.select().from(projectDeployments);
      expect(row!.status).toBe(DeploymentStatus.DEPLOY_FAILED);
      expect(row!.lastError).toMatch(/timed out/i);
    });

    it("scopes by projectId so other projects' stuck rows are not swept", async () => {
      const [otherProject] = await db
        .insert(projects)
        .values({ companyId, name: "other" })
        .returning();
      await db.insert(projectDeployments).values([
        {
          companyId, projectId, targetName: "web",
          type: DeploymentType.PREVIEW, status: DeploymentStatus.PENDING,
          updatedAt: new Date(Date.now() - 16 * 60 * 1000),
        },
        {
          companyId, projectId: otherProject!.id, targetName: "web",
          type: DeploymentType.PREVIEW, status: DeploymentStatus.PENDING,
          updatedAt: new Date(Date.now() - 16 * 60 * 1000),
        },
      ]);
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const res = await svc.sweepStuck({ now: new Date(), projectId });
      expect(res.swept).toBe(1);
      const otherRow = await db
        .select()
        .from(projectDeployments)
        .then((rows) => rows.find((r) => r.projectId === otherProject!.id));
      expect(otherRow!.status).toBe(DeploymentStatus.PENDING);
    });
  });

  describe("applyResult lastDeployedAt", () => {
    it("sets lastDeployedAt when a deploy succeeds", async () => {
      const [row] = await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYING,
      }).returning();
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      const before = Date.now();
      await svc.applyResult({
        companyId, projectId, deploymentId: row!.id,
        body: { kind: DeploymentResultKind.DEPLOY, success: true, url: "https://x.vercel.app" },
      });
      const [updated] = await db.select().from(projectDeployments);
      expect(updated!.status).toBe(DeploymentStatus.DEPLOYED);
      expect(updated!.lastDeployedAt).toBeTruthy();
      expect(updated!.lastDeployedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("does NOT update lastDeployedAt on a failed deploy", async () => {
      const [row] = await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYING,
      }).returning();
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      await svc.applyResult({
        companyId, projectId, deploymentId: row!.id,
        body: { kind: DeploymentResultKind.DEPLOY, success: false, error: "boom" },
      });
      const [updated] = await db.select().from(projectDeployments);
      expect(updated!.status).toBe(DeploymentStatus.DEPLOY_FAILED);
      expect(updated!.lastDeployedAt).toBeNull();
    });

    it("retains a previous lastDeployedAt across a new pending state", async () => {
      const previous = new Date("2026-04-01T00:00:00.000Z");
      const [row] = await db.insert(projectDeployments).values({
        companyId, projectId, targetName: "web",
        type: DeploymentType.PREVIEW, status: DeploymentStatus.DEPLOYED,
        lastDeployedAt: previous,
      }).returning();
      const svc = deploymentsService(db, { heartbeatWakeup: wakeup });
      // User clicks Redeploy → applyPatch flips status back to PENDING.
      await svc.applyPatch({
        companyId, projectId, userId: "u1",
        body: { action: DeploymentAction.DEPLOY, targets: [{ targetName: "web", type: DeploymentType.PREVIEW }] },
      });
      const [afterRedeploy] = await db.select().from(projectDeployments);
      expect(afterRedeploy!.status).toBe(DeploymentStatus.PENDING);
      expect(afterRedeploy!.lastDeployedAt!.getTime()).toBe(previous.getTime());
      void row;
    });
  });
});
