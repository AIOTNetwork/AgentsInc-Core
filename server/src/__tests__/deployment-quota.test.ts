import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  plans,
  projectDeployments,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { deploymentQuotaService } from "../services/deployment-quota.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres deployment quota tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("deploymentQuotaService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof deploymentQuotaService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId!: string;
  let projectId!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("deploy-quota-");
    db = createDb(tempDb.connectionString);
    svc = deploymentQuotaService(db);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  afterEach(async () => {
    await db.delete(projectDeployments);
    await db.delete(projects);
    await db.delete(companies);
    await db.delete(plans);
  });

  beforeEach(async () => {
    // Seed plan first (billing.getSubscriptionForCompany requires a membership, which we
    // skip here — so subscription lookup returns null and plan caps fall back to defaults of 1)
    await db.insert(plans).values({
      slug: "free",
      name: "Free",
      deploymentMaxDeployableProjectsCap: 1,
      deploymentMaxDeploymentsPerRepoCap: 1,
    });

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Test Co",
      issuePrefix: `TES${companyId.replace(/-/g, "").slice(0, 3).toUpperCase()}`,
      deploymentMaxDeployableProjects: 1,
      deploymentMaxDeploymentsPerRepo: 1,
    });

    projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "P1",
    });
  });

  it("returns ok:true for an empty project within caps (1,1)", async () => {
    const result = await svc.check(companyId, projectId, ["web"]);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false scope:repo when repo slot is full and a new target is requested", async () => {
    // Insert a deployed row for target "web" — it fills the single repo slot
    await db.insert(projectDeployments).values({
      companyId,
      projectId,
      targetName: "web",
      type: "production",
      status: "deployed",
    });

    // Requesting a new target "api" would require 2 slots but limit is 1
    const result = await svc.check(companyId, projectId, ["api"]);
    expect(result).toEqual({ ok: false, scope: "repo", used: 1, limit: 1, requested: 1 });
  });

  it("returns ok:true when the only deployment is stopped (inactive)", async () => {
    // A stopped deployment is not active, so the repo slot is free
    await db.insert(projectDeployments).values({
      companyId,
      projectId,
      targetName: "api",
      type: "production",
      status: "stopped",
    });

    const result = await svc.check(companyId, projectId, ["api"]);
    expect(result).toEqual({ ok: true });
  });
});
