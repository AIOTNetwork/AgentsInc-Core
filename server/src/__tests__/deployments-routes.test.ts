import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentRoutes } from "../routes/deployments.js";
import { errorHandler } from "../middleware/index.js";
import { DeploymentServiceError } from "../services/deployments.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockDeploymentsService = vi.hoisted(() => ({
  applyPatch: vi.fn(),
  applyResult: vi.fn(),
  list: vi.fn(),
  sweepStuck: vi.fn(),
}));

const mockQuotaService = vi.hoisted(() => ({
  snapshot: vi.fn(),
  loadLimits: vi.fn(),
  check: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockAgentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockCompanyService = vi.hoisted(() => ({ update: vi.fn() }));
const mockHeartbeatService = vi.hoisted(() => ({ wakeup: vi.fn() }));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockReadDeploymentManifest = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", async () => {
  // `...actual` preserves DeploymentServiceError so the route's `instanceof`
  // check sees the same class the tests use to construct errors.
  const actual = await vi.importActual<typeof import("../services/index.js")>(
    "../services/index.js",
  );
  return {
    ...actual,
    agentService: () => mockAgentService,
    companyService: () => mockCompanyService,
    deploymentsService: () => mockDeploymentsService,
    heartbeatService: () => mockHeartbeatService,
    projectService: () => mockProjectService,
    logActivity: mockLogActivity,
  };
});

vi.mock("../services/deployment-quota.js", () => ({
  deploymentQuotaService: () => mockQuotaService,
}));

vi.mock("../services/deployment-manifest.js", () => ({
  readDeploymentManifest: mockReadDeploymentManifest,
}));

// ── Test app helper ───────────────────────────────────────────────────────

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = actor;
    next();
  });
  app.use("/api", deploymentRoutes({} as never));
  app.use(errorHandler);
  return app;
}

const BOARD_ACTOR = {
  type: "board",
  userId: "u1",
  source: "local_implicit",
  isInstanceAdmin: false,
  companyIds: ["c1"],
};

const CEO_AGENT_ACTOR = {
  type: "agent",
  agentId: "a1",
  companyId: "c1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLogActivity.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("PATCH /companies/:c/projects/:p/deployments", () => {
  it("returns 201 with pending row on first deploy", async () => {
    mockDeploymentsService.applyPatch.mockResolvedValue({
      deployments: [
        { id: "d1", status: "pending", url: null, targetName: "web", type: "preview" },
      ],
    });
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/projects/p1/deployments")
      .send({ action: "deploy", targets: [{ targetName: "web", type: "preview" }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.deployments[0].status).toBe("pending");
    expect(mockDeploymentsService.applyPatch).toHaveBeenCalledTimes(1);
  });

  it("returns 200 when redeploying an existing target with a populated url", async () => {
    mockDeploymentsService.applyPatch.mockResolvedValue({
      deployments: [
        { id: "d1", status: "pending", url: "https://prev.vercel.app", targetName: "web" },
      ],
    });
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/projects/p1/deployments")
      .send({ action: "deploy", targets: [{ targetName: "web", type: "preview" }] });
    expect(res.status).toBe(200);
  });

  it("refresh returns 202", async () => {
    mockDeploymentsService.applyPatch.mockResolvedValue({ deployments: [] });
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/projects/p1/deployments")
      .send({ action: "refresh" });
    expect(res.status).toBe(202);
  });

  it("returns 403 quota_exceeded with shape", async () => {
    mockDeploymentsService.applyPatch.mockRejectedValue(
      new DeploymentServiceError("quota_exceeded", {
        scope: "repo",
        used: 1,
        limit: 1,
        requested: 1,
      }),
    );
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/projects/p1/deployments")
      .send({ action: "deploy", targets: [{ targetName: "api", type: "preview" }] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "quota_exceeded",
      scope: "repo",
      used: 1,
      limit: 1,
    });
  });

  it("returns 409 invalid_state", async () => {
    mockDeploymentsService.applyPatch.mockRejectedValue(
      new DeploymentServiceError("invalid_state", {
        conflicts: [{ targetName: "web", currentStatus: "deploying" }],
      }),
    );
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/projects/p1/deployments")
      .send({ action: "stop", targets: [{ targetName: "web" }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invalid_state");
  });
});

describe("GET /companies/:c/projects/:p/deployments", () => {
  it("returns deployments + manifestTargets + quota", async () => {
    mockProjectService.getById.mockResolvedValue({
      id: "p1",
      companyId: "c1",
      primaryWorkspace: { cwd: "/tmp/repo" },
      codebase: null,
    });
    mockDeploymentsService.list.mockResolvedValue([
      { id: "d1", targetName: "web", status: "deployed", url: "https://x.vercel.app" },
    ]);
    mockQuotaService.snapshot.mockResolvedValue({
      project: { used: 1, limit: 1, planCap: 1 },
      repo: { used: 1, limit: 1, planCap: 1 },
    });
    mockReadDeploymentManifest.mockResolvedValue({
      targets: [{ name: "web" }],
      warnings: [],
    });
    const res = await request(createApp(BOARD_ACTOR)).get(
      "/api/companies/c1/projects/p1/deployments",
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deployments");
    expect(res.body).toHaveProperty("manifestTargets");
    expect(res.body).toHaveProperty("quota");
    expect(res.body.deployments).toHaveLength(1);
    expect(res.body.manifestTargets).toEqual([{ name: "web" }]);
  });

  it("returns empty manifest when project has no workspace dir", async () => {
    mockProjectService.getById.mockResolvedValue({
      id: "p1",
      companyId: "c1",
      primaryWorkspace: null,
      codebase: null,
    });
    mockDeploymentsService.list.mockResolvedValue([]);
    mockQuotaService.snapshot.mockResolvedValue({
      project: { used: 0, limit: 1, planCap: 1 },
      repo: { used: 0, limit: 1, planCap: 1 },
    });
    const res = await request(createApp(BOARD_ACTOR)).get(
      "/api/companies/c1/projects/p1/deployments",
    );
    expect(res.status).toBe(200);
    expect(res.body.manifestTargets).toEqual([]);
    expect(mockReadDeploymentManifest).not.toHaveBeenCalled();
  });
});

describe("POST /companies/:c/projects/:p/deployments/:id/result", () => {
  it("rejects non-agent caller with 403 agent_required", async () => {
    const res = await request(createApp(BOARD_ACTOR))
      .post("/api/companies/c1/projects/p1/deployments/d1/result")
      .send({ kind: "deploy_started" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "agent_required" });
    expect(mockDeploymentsService.applyResult).not.toHaveBeenCalled();
  });

  it("rejects non-CEO agent with 403 ceo_required", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "a1",
      companyId: "c1",
      role: "engineer",
    });
    const res = await request(createApp(CEO_AGENT_ACTOR))
      .post("/api/companies/c1/projects/p1/deployments/d1/result")
      .send({ kind: "deploy_started" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "ceo_required" });
    expect(mockDeploymentsService.applyResult).not.toHaveBeenCalled();
  });

  it("CEO + deploy_started → 200 with deployment body", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "a1",
      companyId: "c1",
      role: "ceo",
    });
    mockDeploymentsService.applyResult.mockResolvedValue({
      deployment: { id: "d1", status: "deploying", targetName: "web" },
    });
    const res = await request(createApp(CEO_AGENT_ACTOR))
      .post("/api/companies/c1/projects/p1/deployments/d1/result")
      .send({ kind: "deploy_started" });
    expect(res.status).toBe(200);
    expect(res.body.deployment.status).toBe("deploying");
    expect(mockDeploymentsService.applyResult).toHaveBeenCalledWith({
      companyId: "c1",
      projectId: "p1",
      deploymentId: "d1",
      body: { kind: "deploy_started" },
    });
  });
});

describe("GET /companies/:c/deployment-settings", () => {
  it("returns shape with company values + plan caps", async () => {
    mockQuotaService.loadLimits.mockResolvedValue({ projectLimit: 2, repoLimit: 3 });
    const res = await request(createApp(BOARD_ACTOR)).get(
      "/api/companies/c1/deployment-settings",
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      maxDeployableProjects: 2,
      maxDeploymentsPerRepo: 3,
      plan: {
        maxDeployableProjectsCap: 2,
        maxDeploymentsPerRepoCap: 3,
      },
    });
  });
});

describe("PATCH /companies/:c/deployment-settings", () => {
  it("clamps requested values above plan cap", async () => {
    mockQuotaService.loadLimits
      .mockResolvedValueOnce({ projectLimit: 1, repoLimit: 1 })
      .mockResolvedValueOnce({ projectLimit: 1, repoLimit: 1 });
    mockCompanyService.update.mockResolvedValue({});
    const res = await request(createApp(BOARD_ACTOR))
      .patch("/api/companies/c1/deployment-settings")
      .send({ maxDeployableProjects: 999 });
    expect(res.status).toBe(200);
    expect(res.body.maxDeployableProjects).toBe(1);
    expect(res.body.plan.maxDeployableProjectsCap).toBe(1);
    expect(mockCompanyService.update).toHaveBeenCalledWith("c1", {
      deploymentMaxDeployableProjects: 1,
    });
  });

  it("rejects non-CEO agent (403)", async () => {
    mockQuotaService.loadLimits.mockResolvedValue({ projectLimit: 1, repoLimit: 1 });
    mockAgentService.getById.mockResolvedValue({
      id: "a1",
      companyId: "c1",
      role: "engineer",
    });
    const res = await request(createApp(CEO_AGENT_ACTOR))
      .patch("/api/companies/c1/deployment-settings")
      .send({ maxDeployableProjects: 1 });
    expect(res.status).toBe(403);
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });
});
