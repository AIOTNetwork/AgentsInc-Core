import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, companies, projects, projectDeployments, agents } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { DeploymentAction, DeploymentStatus, DeploymentType } from "@paperclipai/shared";
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
});
