import {
  encodeEventTopics,
  keccak256,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_MINTED_EVENT_NAME,
  HANDLE_ABI,
  type BscRpcContext,
} from "../lib/bsc-rpc.js";
import { agentMintService } from "../services/agentMint.js";
import type { PreRegisterService } from "../services/pre-register.js";

const HANDLE = "0x1111111111111111111111111111111111111111" as Address;
const NFT = "0x2222222222222222222222222222222222222222" as Address;
const CALLER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const OTHER_OWNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const TX_HASH = `0x${"a".repeat(64)}` as Hash;
const TOKEN_ID = 42n;
const AGENT_ID = "my-agent";

const agentMintedTopic = keccak256(
  toHex(`${AGENT_MINTED_EVENT_NAME}(address,uint256)`),
);

function makeAgentMintedLog(args: {
  address?: Address;
  caller?: Address;
  tokenId?: bigint;
} = {}) {
  const topics = encodeEventTopics({
    abi: HANDLE_ABI,
    eventName: AGENT_MINTED_EVENT_NAME,
    args: {
      caller: args.caller ?? CALLER,
      tokenId: args.tokenId ?? TOKEN_ID,
    },
  });
  return {
    address: args.address ?? HANDLE,
    topics,
    data: "0x" as Hex,
  };
}

function makeReceipt(overrides: {
  status?: "success" | "reverted";
  logs?: ReturnType<typeof makeAgentMintedLog>[];
  blockNumber?: bigint;
} = {}) {
  return {
    status: overrides.status ?? "success",
    logs: overrides.logs ?? [makeAgentMintedLog()],
    blockNumber: overrides.blockNumber ?? 100n,
  };
}

function makeRpcContext(overrides: {
  minConfirmations?: number;
  receipt?: ReturnType<typeof makeReceipt>;
  receiptError?: unknown;
  blockNumber?: bigint;
  blockNumberError?: unknown;
  ownerOf?: Address;
  ownerOfError?: unknown;
} = {}): BscRpcContext {
  const getTransactionReceipt =
    overrides.receiptError !== undefined
      ? vi.fn().mockRejectedValue(overrides.receiptError)
      : vi.fn().mockResolvedValue(overrides.receipt ?? makeReceipt());

  const getBlockNumber =
    overrides.blockNumberError !== undefined
      ? vi.fn().mockRejectedValue(overrides.blockNumberError)
      : vi.fn().mockResolvedValue(overrides.blockNumber ?? 101n);

  const readContract =
    overrides.ownerOfError !== undefined
      ? vi.fn().mockRejectedValue(overrides.ownerOfError)
      : vi.fn().mockResolvedValue(overrides.ownerOf ?? CALLER);

  return {
    config: {
      handleContract: HANDLE,
      nftContract: NFT,
      chainId: 97,
      primaryRpcUrl: undefined,
      fallbackRpcUrl: undefined,
      minConfirmations: overrides.minConfirmations ?? 0,
    },
    client: { getTransactionReceipt, getBlockNumber, readContract } as any,
    agentMintedTopic,
  };
}

function makeSvc(overrides: {
  users?: Array<{ id: string; walletAddress: string }>;
  agent?: { id: string; preRegisterUserId: string; tokenId: string | null } | null;
  recordedAgent?: unknown;
} = {}): PreRegisterService {
  const defaultMinter = { id: "u-caller", walletAddress: CALLER };
  return {
    findUserByEmail: vi.fn(),
    findUserByWallet: vi.fn(),
    findUserById: vi.fn(),
    findUsersByWallets: vi.fn().mockResolvedValue(overrides.users ?? [defaultMinter]),
    createUser: vi.fn(),
    findAgentByUserId: vi.fn(),
    findAgentByTokenId: vi.fn(),
    findAgentByAgentId: vi.fn().mockResolvedValue(
      overrides.agent === undefined
        ? { id: "agent-row-1", preRegisterUserId: "u-caller", tokenId: null }
        : overrides.agent,
    ),
    upsertAgent: vi.fn(),
    recordAgentMint: vi.fn().mockResolvedValue(
      overrides.recordedAgent ?? {
        id: "agent-row-1",
        agentId: AGENT_ID,
        idea: "do things",
        tokenId: TOKEN_ID.toString(),
        mintTxHash: TX_HASH,
        walletAddress: null,
      },
    ),
    claimOrphansByWallet: vi.fn(),
  } as any;
}

describe("agentMintService.recordMint", () => {
  describe("receipt fetch", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns pending when the receipt is not yet on chain", async () => {
      const err = new Error("not found");
      err.name = "TransactionReceiptNotFoundError";
      const rpc = makeRpcContext({ receiptError: err });
      const svc = makeSvc();

      const promise = agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        kind: "pending",
        reason: "Transaction not yet confirmed",
      });
      expect(rpc.client.getTransactionReceipt).toHaveBeenCalledTimes(5);
    });

    it("returns rpc_unavailable when receipt fetch fails with a non-NotFound error", async () => {
      const rpc = makeRpcContext({ receiptError: new Error("boom") });
      const svc = makeSvc();

      const promise = agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({
        kind: "rpc_unavailable",
        reason: "Failed to fetch transaction receipt",
      });
    });
  });

  it("throws 422 when the transaction reverted on-chain", async () => {
    const rpc = makeRpcContext({ receipt: makeReceipt({ status: "reverted" }) });
    const svc = makeSvc();

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({ status: 422, message: "Transaction reverted on-chain" });
  });

  describe("confirmations", () => {
    it("returns pending when confirmations are below the minimum", async () => {
      const rpc = makeRpcContext({
        minConfirmations: 5,
        receipt: makeReceipt({ blockNumber: 100n }),
        blockNumber: 102n,
      });
      const svc = makeSvc();

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result).toEqual({
        kind: "pending",
        reason: "Need 5 confirmations, have 3",
      });
    });

    it("proceeds when confirmations meet the minimum", async () => {
      const rpc = makeRpcContext({
        minConfirmations: 3,
        receipt: makeReceipt({ blockNumber: 100n }),
        blockNumber: 102n,
      });
      const svc = makeSvc();

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result.kind).toBe("ok");
    });

    it("returns rpc_unavailable when getBlockNumber throws", async () => {
      const rpc = makeRpcContext({
        minConfirmations: 1,
        blockNumberError: new Error("net down"),
      });
      const svc = makeSvc();

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result).toEqual({
        kind: "rpc_unavailable",
        reason: "Failed to read head block",
      });
    });
  });

  it("throws 422 when no AgentMinted log is present from the Handle contract", async () => {
    const otherHandleLog = makeAgentMintedLog({ address: NFT });
    const rpc = makeRpcContext({ receipt: makeReceipt({ logs: [otherHandleLog] }) });
    const svc = makeSvc();

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({
      status: 422,
      message: `No ${AGENT_MINTED_EVENT_NAME} log from the Handle contract`,
    });
  });

  it("returns rpc_unavailable when ownerOf read fails", async () => {
    const rpc = makeRpcContext({ ownerOfError: new Error("rpc fail") });
    const svc = makeSvc();

    const result = await agentMintService(svc, rpc).recordMint({
      txHash: TX_HASH,
      agentId: AGENT_ID,
    });

    expect(result).toEqual({
      kind: "rpc_unavailable",
      reason: "Failed to read NFT owner",
    });
  });

  it("throws 422 when caller is not pre-registered", async () => {
    const rpc = makeRpcContext();
    const svc = makeSvc({ users: [] });

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({ status: 422, message: "Caller is not pre-registered" });
  });

  it("throws 422 when agent record is not found", async () => {
    const rpc = makeRpcContext();
    const svc = makeSvc({ agent: null });

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({ status: 422, message: "Agent record not found" });
  });

  it("throws 422 when mint wallet user is not the agent creator", async () => {
    const rpc = makeRpcContext();
    const svc = makeSvc({
      agent: { id: "agent-row-1", preRegisterUserId: "u-other", tokenId: null },
    });

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Mint wallet user is not the agent creator",
    });
  });

  it("throws 422 when the agent already has a recorded mint", async () => {
    const rpc = makeRpcContext();
    const svc = makeSvc({
      agent: { id: "agent-row-1", preRegisterUserId: "u-caller", tokenId: "7" },
    });

    await expect(
      agentMintService(svc, rpc).recordMint({ txHash: TX_HASH, agentId: AGENT_ID }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Agent already has a recorded mint",
    });
  });

  describe("happy path", () => {
    it("records mint and returns ok with account when caller is current owner and is pre-registered", async () => {
      const rpc = makeRpcContext({ ownerOf: CALLER });
      const minter = { id: "u-caller", walletAddress: CALLER };
      const svc = makeSvc({ users: [minter] });

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.account).toEqual(minter);
      expect(svc.findUsersByWallets).toHaveBeenCalledWith([CALLER]);
      expect(svc.recordAgentMint).toHaveBeenCalledWith({
        agentRowId: "agent-row-1",
        tokenId: TOKEN_ID.toString(),
        mintTxHash: TX_HASH,
        preRegisterUserId: "u-caller",
        walletAddress: null,
      });
    });

    it("records mint and returns ok with account when current owner differs and is pre-registered", async () => {
      const rpc = makeRpcContext({ ownerOf: OTHER_OWNER });
      const minter = { id: "u-caller", walletAddress: CALLER };
      const newOwner = { id: "u-owner", walletAddress: OTHER_OWNER };
      const svc = makeSvc({ users: [minter, newOwner] });

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.account).toEqual(newOwner);
      expect(svc.findUsersByWallets).toHaveBeenCalledWith([CALLER, OTHER_OWNER]);
      expect(svc.recordAgentMint).toHaveBeenCalledWith({
        agentRowId: "agent-row-1",
        tokenId: TOKEN_ID.toString(),
        mintTxHash: TX_HASH,
        preRegisterUserId: "u-owner",
        walletAddress: null,
      });
    });

    it("records mint and returns ok with account=null when current owner is not pre-registered", async () => {
      const rpc = makeRpcContext({ ownerOf: OTHER_OWNER });
      const minter = { id: "u-caller", walletAddress: CALLER };
      const svc = makeSvc({ users: [minter] });

      const result = await agentMintService(svc, rpc).recordMint({
        txHash: TX_HASH,
        agentId: AGENT_ID,
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.account).toBeNull();
      expect(svc.recordAgentMint).toHaveBeenCalledWith({
        agentRowId: "agent-row-1",
        tokenId: TOKEN_ID.toString(),
        mintTxHash: TX_HASH,
        preRegisterUserId: null,
        walletAddress: OTHER_OWNER,
      });
    });
  });
});
