import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createPreRegisterSchema,
  preRegisterQuerySchema,
  recordMintSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { preRegisterService } from "../services/pre-register.js";
import { agentMintService } from "../services/agentMint.js";
import { getBscRpcContext } from "../lib/bsc-rpc.js";
import { badRequest, notFound, HttpError } from "../errors.js";

type UserRow = {
  email: string | null;
  walletAddress: string | null;
  provider: string | null;
  chainId: string | null;
};

type AgentRow = {
  agentId: string;
  idea: string;
  tokenId: string | null;
  mintTxHash: string | null;
  walletAddress: string | null;
} | null;

function accountResponse(user: UserRow | null) {
  if (!user) return null;
  return {
    email: user.email,
    walletAddress: user.walletAddress,
    provider: user.provider,
    chainId: user.chainId,
  };
}

function agentResponse(agent: AgentRow) {
  if (!agent) return null;
  return {
    agentId: agent.agentId,
    idea: agent.idea,
    tokenId: agent.tokenId,
    mintTxHash: agent.mintTxHash,
    walletAddress: agent.walletAddress,
  };
}

type AccountInput = {
  email?: string;
  walletAddress?: string;
  provider?: string;
  chainId?: string;
};

type AccountPath =
  | { kind: "email"; email: string }
  | { kind: "wallet"; walletAddress: string; provider: string; chainId: string };

function classifyAccount(account: AccountInput): AccountPath {
  const hasEmail = account.email != null && account.email.length > 0;
  const hasWallet = account.walletAddress != null && account.walletAddress.length > 0;
  const hasProvider = account.provider != null && account.provider.length > 0;
  const hasChain = account.chainId != null && account.chainId.length > 0;

  if (hasEmail && (hasWallet || hasProvider || hasChain)) {
    throw badRequest("Provide either email or walletAddress + provider + chainId, not both");
  }
  if (hasEmail) {
    return { kind: "email", email: account.email! };
  }
  if (hasWallet) {
    if (!hasProvider) throw badRequest("provider is required with walletAddress");
    if (!hasChain) throw badRequest("chainId is required with walletAddress");
    return {
      kind: "wallet",
      walletAddress: account.walletAddress!.toLowerCase(),
      provider: account.provider!,
      chainId: account.chainId!,
    };
  }
  throw badRequest("Provide either email or walletAddress + provider + chainId");
}

export function preRegisterRoutes(db: Db) {
  const router = Router();
  const svc = preRegisterService(db);

  router.post("/pre-register", validate(createPreRegisterSchema), async (req, res) => {
    const { account, agent } = req.body as {
      account: AccountInput;
      agent?: { agentId: string; idea: string };
    };
    const path = classifyAccount(account);

    let user =
      path.kind === "email"
        ? await svc.findUserByEmail(path.email)
        : await svc.findUserByWallet(path.walletAddress);

    let userCreated = false;
    if (!user) {
      user =
        path.kind === "email"
          ? await svc.createUser({ email: path.email })
          : await svc.createUser({
              walletAddress: path.walletAddress,
              provider: path.provider,
              chainId: path.chainId,
            });
      userCreated = true;
    }

    if (path.kind === "wallet") {
      await svc.claimOrphansByWallet(path.walletAddress, user.id);
    }

    let agentRow = await svc.findAgentByUserId(user.id);
    if (agent) {
      agentRow = await svc.upsertAgent(user.id, agent);
    }

    res
      .status(userCreated ? 201 : 200)
      .json({ account: accountResponse(user), agent: agentResponse(agentRow) });
  });

  router.get("/pre-register", async (req, res) => {
    const parsed = preRegisterQuerySchema.parse({
      email: typeof req.query.email === "string" ? req.query.email : undefined,
      walletAddress:
        typeof req.query.walletAddress === "string" ? req.query.walletAddress : undefined,
    });
    const hasEmail = parsed.email != null && parsed.email.length > 0;
    const hasWallet = parsed.walletAddress != null && parsed.walletAddress.length > 0;
    if (hasEmail === hasWallet) {
      throw badRequest("Provide exactly one of email or walletAddress");
    }

    const user = hasEmail
      ? await svc.findUserByEmail(parsed.email!)
      : await svc.findUserByWallet(parsed.walletAddress!.toLowerCase());

    if (!user) throw notFound("Pre-register user not found");

    const agentRow = await svc.findAgentByUserId(user.id);
    res.json({ account: accountResponse(user), agent: agentResponse(agentRow) });
  });

  router.post("/pre-register/mint", validate(recordMintSchema), async (req, res) => {
    const mintSvc = agentMintService(svc, getBscRpcContext());
    const { txHash, agentId } = req.body as { txHash: string; agentId: string };
    const result = await mintSvc.recordMint({ txHash, agentId });

    if (result.kind === "pending") {
      res.status(202).json({ status: "pending", reason: result.reason });
      return;
    }
    if (result.kind === "rpc_unavailable") {
      throw new HttpError(503, result.reason);
    }

    res.json({ account: accountResponse(result.account), agent: agentResponse(result.agent) });
  });

  return router;
}
