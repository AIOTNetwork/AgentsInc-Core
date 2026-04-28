import { z } from "zod";

const preRegisterAccountSchema = z.object({
  email: z.string().email().optional(),
  walletAddress: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  chainId: z.string().min(1).optional(),
});

const preRegisterAgentSchema = z.object({
  agentId: z.string().min(1),
  idea: z.string(),
});

export const createPreRegisterSchema = z.object({
  account: preRegisterAccountSchema,
  agent: preRegisterAgentSchema.optional(),
});

export type CreatePreRegister = z.infer<typeof createPreRegisterSchema>;

export const preRegisterQuerySchema = z.object({
  email: z.string().email().optional(),
  walletAddress: z.string().min(1).optional(),
});

export type PreRegisterQuery = z.infer<typeof preRegisterQuerySchema>;

export const recordMintSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "txHash must be 0x + 64 hex chars"),
  agentId: z.string().min(1),
});

export type RecordMint = z.infer<typeof recordMintSchema>;
