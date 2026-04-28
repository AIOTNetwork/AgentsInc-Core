import { decodeEventLog, type Address, type Hash, type Hex } from "viem";
import { unprocessable } from "../errors.js";
import {
  AGENT_MINTED_EVENT_NAME,
  HANDLE_ABI,
  NFT_ABI,
  type BscRpcContext,
} from "../lib/bsc-rpc.js";
import type { PreRegisterService } from "./pre-register.js";

const RECEIPT_RETRY_ATTEMPTS = 5;
const RECEIPT_RETRY_BASE_MS = 500;

type AgentRow = NonNullable<Awaited<ReturnType<PreRegisterService["findAgentByTokenId"]>>>;
type UserRow = NonNullable<Awaited<ReturnType<PreRegisterService["findUserByWallet"]>>>;

export type AgentMintResult =
  | { kind: "ok"; agent: AgentRow; account: UserRow | null }
  | { kind: "pending"; reason: string }
  | { kind: "rpc_unavailable"; reason: string };

export interface RecordMintInput {
  txHash: string;
  agentId: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchReceiptWithRetries(rpc: BscRpcContext, txHash: Hash) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= RECEIPT_RETRY_ATTEMPTS; attempt++) {
    try {
      const receipt = await rpc.client.getTransactionReceipt({ hash: txHash });
      return { ok: true as const, receipt };
    } catch (err) {
      lastError = err;
      if (attempt < RECEIPT_RETRY_ATTEMPTS) await sleep(RECEIPT_RETRY_BASE_MS * attempt);
    }
  }
  return { ok: false as const, lastError };
}

export function agentMintService(svc: PreRegisterService, rpc: BscRpcContext) {
  async function recordMint(input: RecordMintInput): Promise<AgentMintResult> {
    const txHash = input.txHash.toLowerCase() as Hash;

    const fetched = await fetchReceiptWithRetries(rpc, txHash);
    if (!fetched.ok) {
      const errName = (fetched.lastError as { name?: string } | null)?.name ?? "";
      if (errName === "TransactionReceiptNotFoundError") {
        return { kind: "pending", reason: "Transaction not yet confirmed" };
      }
      return { kind: "rpc_unavailable", reason: "Failed to fetch transaction receipt" };
    }

    const { receipt } = fetched;
    if (receipt.status !== "success") {
      throw unprocessable("Transaction reverted on-chain");
    }

    if (rpc.config.minConfirmations > 0) {
      let head: bigint;
      try {
        head = await rpc.client.getBlockNumber();
      } catch {
        return { kind: "rpc_unavailable", reason: "Failed to read head block" };
      }
      const confirmations = Number(head - receipt.blockNumber + 1n);
      if (confirmations < rpc.config.minConfirmations) {
        return {
          kind: "pending",
          reason: `Need ${rpc.config.minConfirmations} confirmations, have ${confirmations}`,
        };
      }
    }

    const handle = rpc.config.handleContract;
    const log = receipt.logs.find(
      (l) =>
        (l.address.toLowerCase() as Address) === handle &&
        l.topics[0] === rpc.agentMintedTopic,
    );
    if (!log) {
      throw unprocessable(`No ${AGENT_MINTED_EVENT_NAME} log from the Handle contract`);
    }

    const decoded = decodeEventLog({
      abi: HANDLE_ABI,
      eventName: AGENT_MINTED_EVENT_NAME,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    });
    const caller = decoded.args.caller.toLowerCase() as Address;
    const tokenId = decoded.args.tokenId.toString();

    let currentOwner: Address;
    try {
      const owner = await rpc.client.readContract({
        address: rpc.config.nftContract,
        abi: NFT_ABI,
        functionName: "ownerOf",
        args: [decoded.args.tokenId],
      });
      currentOwner = owner.toLowerCase() as Address;
    } catch {
      return { kind: "rpc_unavailable", reason: "Failed to read NFT owner" };
    }

    // Single DB hit for both wallets we care about: the minter and the current owner.
    const wallets = caller === currentOwner ? [caller] : [caller, currentOwner];
    const users = await svc.findUsersByWallets(wallets);
    const minter = users.find((u) => u.walletAddress === caller) ?? null;
    const currentOwnerUser = users.find((u) => u.walletAddress === currentOwner) ?? null;

    if (!minter) throw unprocessable("Caller is not pre-registered");

    const target = await svc.findAgentByAgentId(input.agentId);
    if (!target) throw unprocessable("Agent record not found");
    
    if (target.preRegisterUserId !== minter.id) {
      throw unprocessable("Mint wallet user is not the agent creator");
    }
    if (target.tokenId) {
      throw unprocessable("Agent already has a recorded mint");
    }

    const ownerBinding = currentOwnerUser
      ? { preRegisterUserId: currentOwnerUser.id, walletAddress: null }
      : { preRegisterUserId: null, walletAddress: currentOwner };

    const updated = await svc.recordAgentMint({
      agentRowId: target.id,
      tokenId,
      mintTxHash: txHash,
      preRegisterUserId: ownerBinding.preRegisterUserId,
      walletAddress: ownerBinding.walletAddress,
    });

    return { kind: "ok", agent: updated, account: currentOwnerUser ?? null };
  }

  return { recordMint };
}
