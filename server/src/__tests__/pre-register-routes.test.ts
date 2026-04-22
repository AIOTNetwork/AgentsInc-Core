import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { preRegisterRoutes } from "../routes/pre-register.js";

const mockService = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  findUserByWallet: vi.fn(),
  createUser: vi.fn(),
  findAgentByUserId: vi.fn(),
  upsertAgent: vi.fn(),
}));

vi.mock("../services/pre-register.js", () => ({
  preRegisterService: () => mockService,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = { type: "none", source: "none" };
    next();
  });
  app.use("/api", preRegisterRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("pre-register routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/pre-register", () => {
    it("creates a new user via email path and returns 201", async () => {
      mockService.findUserByEmail.mockResolvedValue(null);
      mockService.createUser.mockResolvedValue({
        id: "user-1",
        email: "a@b.com",
        walletAddress: null,
        provider: null,
        chainId: null,
      });

      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: { email: "a@b.com" } });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        account: {
          email: "a@b.com",
          walletAddress: null,
          provider: null,
          chainId: null,
        },
        agent: null,
      });
      expect(mockService.createUser).toHaveBeenCalledWith({ email: "a@b.com" });
    });

    it("returns 200 when email user already exists", async () => {
      mockService.findUserByEmail.mockResolvedValue({
        id: "user-1",
        email: "a@b.com",
        walletAddress: null,
        provider: null,
        chainId: null,
      });

      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: { email: "a@b.com" } });

      expect(res.status).toBe(200);
      expect(mockService.createUser).not.toHaveBeenCalled();
      expect(res.body.account.email).toBe("a@b.com");
      expect(res.body.agent).toBeNull();
    });

    it("creates a new user via wallet path and lowercases the address", async () => {
      mockService.findUserByWallet.mockResolvedValue(null);
      mockService.createUser.mockResolvedValue({
        id: "user-2",
        email: null,
        walletAddress: "0xabc",
        provider: "metamask",
        chainId: "1",
      });

      const res = await request(createApp())
        .post("/api/pre-register")
        .send({
          account: { walletAddress: "0xABC", provider: "metamask", chainId: "1" },
        });

      expect(res.status).toBe(201);
      expect(res.body.account).toEqual({
        email: null,
        walletAddress: "0xabc",
        provider: "metamask",
        chainId: "1",
      });
      expect(mockService.findUserByWallet).toHaveBeenCalledWith("0xabc");
      expect(mockService.createUser).toHaveBeenCalledWith({
        walletAddress: "0xabc",
        provider: "metamask",
        chainId: "1",
      });
    });

    it("upserts agent when agent payload is provided (new agent)", async () => {
      mockService.findUserByEmail.mockResolvedValue({
        id: "user-1",
        email: "a@b.com",
        walletAddress: null,
        provider: null,
        chainId: null,
      });
      mockService.upsertAgent.mockResolvedValue({
        id: "agent-row-1",
        preRegisterUserId: "user-1",
        agentId: "my-agent",
        idea: "do things",
      });

      const res = await request(createApp())
        .post("/api/pre-register")
        .send({
          account: { email: "a@b.com" },
          agent: { agentId: "my-agent", idea: "do things" },
        });

      expect(res.status).toBe(200);
      expect(mockService.upsertAgent).toHaveBeenCalledWith("user-1", {
        agentId: "my-agent",
        idea: "do things",
      });
      expect(res.body.agent).toEqual({ agentId: "my-agent", idea: "do things" });
    });

    it("400 when account missing", async () => {
      const res = await request(createApp()).post("/api/pre-register").send({});
      expect(res.status).toBe(400);
    });

    it("400 when both email and walletAddress are set", async () => {
      const res = await request(createApp())
        .post("/api/pre-register")
        .send({
          account: {
            email: "a@b.com",
            walletAddress: "0xABC",
            provider: "metamask",
            chainId: "1",
          },
        });
      expect(res.status).toBe(400);
    });

    it("400 when neither email nor walletAddress is set", async () => {
      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: {} });
      expect(res.status).toBe(400);
    });

    it("400 on wallet path missing provider", async () => {
      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: { walletAddress: "0xABC", chainId: "1" } });
      expect(res.status).toBe(400);
    });

    it("400 on wallet path missing chainId", async () => {
      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: { walletAddress: "0xABC", provider: "metamask" } });
      expect(res.status).toBe(400);
    });

    it("400 on email path with any wallet-side field set", async () => {
      const res = await request(createApp())
        .post("/api/pre-register")
        .send({ account: { email: "a@b.com", provider: "metamask" } });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/pre-register", () => {
    it("returns 200 with account and agent when user found by email", async () => {
      mockService.findUserByEmail.mockResolvedValue({
        id: "user-1",
        email: "a@b.com",
        walletAddress: null,
        provider: null,
        chainId: null,
      });
      mockService.findAgentByUserId.mockResolvedValue({
        agentId: "my-agent",
        idea: "do things",
      });

      const res = await request(createApp()).get("/api/pre-register?email=a@b.com");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        account: {
          email: "a@b.com",
          walletAddress: null,
          provider: null,
          chainId: null,
        },
        agent: { agentId: "my-agent", idea: "do things" },
      });
    });

    it("returns 200 with null agent when user has no agent row, lowercasing wallet", async () => {
      mockService.findUserByWallet.mockResolvedValue({
        id: "user-2",
        email: null,
        walletAddress: "0xabc",
        provider: "metamask",
        chainId: "1",
      });
      mockService.findAgentByUserId.mockResolvedValue(null);

      const res = await request(createApp()).get(
        "/api/pre-register?walletAddress=0xABC",
      );

      expect(res.status).toBe(200);
      expect(res.body.agent).toBeNull();
      expect(mockService.findUserByWallet).toHaveBeenCalledWith("0xabc");
    });

    it("returns 404 when user not found", async () => {
      mockService.findUserByEmail.mockResolvedValue(null);

      const res = await request(createApp()).get("/api/pre-register?email=ghost@b.com");
      expect(res.status).toBe(404);
    });

    it("400 when both email and walletAddress provided", async () => {
      const res = await request(createApp()).get(
        "/api/pre-register?email=a@b.com&walletAddress=0xABC",
      );
      expect(res.status).toBe(400);
    });

    it("400 when neither param provided", async () => {
      const res = await request(createApp()).get("/api/pre-register");
      expect(res.status).toBe(400);
    });
  });
});
