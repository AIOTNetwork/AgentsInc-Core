import {
  createPublicClient,
  fallback,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";

export interface BscRpcConfig {
  handleContract: Address;
  nftContract: Address;
  chainId: number;
  primaryRpcUrl: string | undefined;
  fallbackRpcUrl: string | undefined;
  minConfirmations: number;
}

export interface BscRpcContext {
  config: BscRpcConfig;
  client: PublicClient;
  agentMintedTopic: Hex;
}

export class BscRpcNotConfiguredError extends Error {
  constructor() {
    super("BSC RPC not configured (missing AGENTS_HANDLE_CONTRACT or AGENTS_NFT_CONTRACT)");
    this.name = "BscRpcNotConfiguredError";
  }
}

export const AGENT_MINTED_EVENT_NAME = "AgentMintedThroughHandle" as const;
const AGENT_MINTED_EVENT_SIGNATURE = `${AGENT_MINTED_EVENT_NAME}(address,uint256)`;

const HANDLE_ABI = parseAbi([
  `event ${AGENT_MINTED_EVENT_NAME}(address indexed caller, uint256 indexed tokenId)`,
]);

const NFT_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

function readContractAddress(envName: string): Address | null {
  const raw = process.env[envName];
  if (!raw) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${envName} must be a 0x-prefixed 40-char hex address (got "${raw}")`);
  }
  return raw.toLowerCase() as Address;
}

function readChainId(): number {
  const raw = process.env.AGENTS_CHAIN_ID;
  if (!raw) return 97;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`AGENTS_CHAIN_ID must be a positive integer (got "${raw}")`);
  }
  return n;
}

function readMinConfirmations(): number {
  const raw = process.env.AGENTS_MIN_CONFIRMATIONS;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`AGENTS_MIN_CONFIRMATIONS must be a non-negative integer (got "${raw}")`);
  }
  return n;
}

let cachedContext: BscRpcContext | null = null;

export function getBscRpcContext(): BscRpcContext {
  if (cachedContext) return cachedContext;

  const handleContract = readContractAddress("AGENTS_HANDLE_CONTRACT");
  const nftContract = readContractAddress("AGENTS_NFT_CONTRACT");
  if (!handleContract || !nftContract) throw new BscRpcNotConfiguredError();

  const chainId = readChainId();
  const chain = chainId === 56 ? bsc : bscTestnet;
  const primaryRpcUrl = process.env.AGENTS_BSC_RPC_URL || undefined;
  const fallbackRpcUrl = process.env.AGENTS_BSC_RPC_FALLBACK_URL || undefined;
  const minConfirmations = readMinConfirmations();

  const transports = [primaryRpcUrl, fallbackRpcUrl]
    .filter((url): url is string => Boolean(url))
    .map((url) => http(url, { batch: true }));
  const transport = transports.length > 0 ? fallback(transports) : http(undefined, { batch: true });

  const client = createPublicClient({ chain, transport });
  const agentMintedTopic = keccak256(toHex(AGENT_MINTED_EVENT_SIGNATURE));

  cachedContext = {
    config: { handleContract, nftContract, chainId, primaryRpcUrl, fallbackRpcUrl, minConfirmations },
    client,
    agentMintedTopic,
  };
  return cachedContext;
}

async function assertContractDeployed(
  ctx: BscRpcContext,
  label: string,
  address: Address,
): Promise<void> {
  const code = await ctx.client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`${label} ${address} has no bytecode on chain ${ctx.config.chainId}`);
  }
}


enum ContractType {
  AgentHandler = "AgentHandler",
  AgentNFT = "AgentNFT",
}

export async function assertChainConfig(ctx: BscRpcContext = getBscRpcContext()): Promise<void> {
  const id = await ctx.client.getChainId();
  if (id !== ctx.config.chainId) {
    throw new Error(
      `BSC RPC chainId mismatch: configured AGENTS_CHAIN_ID=${ctx.config.chainId}, RPC reports ${id}`,
    );
  }

  const contracts: Array<{ label: string; address: Address }> = [
    { label: ContractType.AgentHandler, address: ctx.config.handleContract },
    { label: ContractType.AgentNFT, address: ctx.config.nftContract },
  ];

  await Promise.all(contracts.map((c) => assertContractDeployed(ctx, c.label, c.address)));
}

export { HANDLE_ABI, NFT_ABI };
