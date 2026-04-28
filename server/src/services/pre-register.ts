import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { preRegisterUsers, preRegisterAgents } from "@paperclipai/db";
import { conflict } from "../errors.js";

type PreRegisterUserInsert = {
  email?: string;
  walletAddress?: string;
  provider?: string;
  chainId?: string;
};

type PreRegisterAgentInput = {
  agentId: string;
  idea: string;
};

type RecordAgentMintInput = {
  agentRowId: string;
  tokenId: string;
  mintTxHash: string;
  preRegisterUserId: string | null;
  walletAddress: string | null;
};

export function preRegisterService(db: Db) {
  const findAgentByAgentId = (agentId: string) =>
    db
      .select()
      .from(preRegisterAgents)
      .where(eq(preRegisterAgents.agentId, agentId))
      .then((rows) => rows[0] ?? null);

  return {
    findUserByEmail: (email: string) =>
      db
        .select()
        .from(preRegisterUsers)
        .where(eq(preRegisterUsers.email, email))
        .then((rows) => rows[0] ?? null),

    findUserByWallet: (walletAddress: string) =>
      db
        .select()
        .from(preRegisterUsers)
        .where(eq(preRegisterUsers.walletAddress, walletAddress))
        .then((rows) => rows[0] ?? null),

    findUserById: (id: string) =>
      db
        .select()
        .from(preRegisterUsers)
        .where(eq(preRegisterUsers.id, id))
        .then((rows) => rows[0] ?? null),

    findUsersByWallets: (walletAddresses: string[]) => {
      if (walletAddresses.length === 0) return Promise.resolve([]);
      return db
        .select()
        .from(preRegisterUsers)
        .where(inArray(preRegisterUsers.walletAddress, walletAddresses));
    },

    createUser: (input: PreRegisterUserInsert) =>
      db
        .insert(preRegisterUsers)
        .values({
          email: input.email ?? null,
          walletAddress: input.walletAddress ?? null,
          provider: input.provider ?? null,
          chainId: input.chainId ?? null,
        })
        .returning()
        .then((rows) => rows[0]),

    findAgentByUserId: (userId: string) =>
      db
        .select()
        .from(preRegisterAgents)
        .where(eq(preRegisterAgents.preRegisterUserId, userId))
        .then((rows) => rows[0] ?? null),

    findAgentByTokenId: (tokenId: string) =>
      db
        .select()
        .from(preRegisterAgents)
        .where(eq(preRegisterAgents.tokenId, tokenId))
        .then((rows) => rows[0] ?? null),

    findAgentByAgentId,

    upsertAgent: async (userId: string, data: PreRegisterAgentInput) => {
      const existing = await findAgentByAgentId(data.agentId);

      if (existing) {
        if (existing.preRegisterUserId !== userId) {
          throw conflict("agent_id already taken");
        }
        return db
          .update(preRegisterAgents)
          .set({
            idea: data.idea,
            updatedAt: new Date(),
          })
          .where(eq(preRegisterAgents.id, existing.id))
          .returning()
          .then((rows) => rows[0]);
      }

      return db
        .insert(preRegisterAgents)
        .values({
          preRegisterUserId: userId,
          agentId: data.agentId,
          idea: data.idea,
        })
        .returning()
        .then((rows) => rows[0]);
    },

    recordAgentMint: (input: RecordAgentMintInput) =>
      db
        .update(preRegisterAgents)
        .set({
          tokenId: input.tokenId,
          mintTxHash: input.mintTxHash,
          preRegisterUserId: input.preRegisterUserId,
          walletAddress: input.walletAddress,
          updatedAt: new Date(),
        })
        .where(eq(preRegisterAgents.id, input.agentRowId))
        .returning()
        .then((rows) => rows[0]),

    claimOrphansByWallet: (walletAddress: string, newUserId: string) =>
      db
        .update(preRegisterAgents)
        .set({
          preRegisterUserId: newUserId,
          walletAddress: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(preRegisterAgents.walletAddress, walletAddress),
            isNull(preRegisterAgents.preRegisterUserId),
          ),
        )
        .returning(),
  };
}

export type PreRegisterService = ReturnType<typeof preRegisterService>;