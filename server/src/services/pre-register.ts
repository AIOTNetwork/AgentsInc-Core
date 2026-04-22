import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { preRegisterUsers, preRegisterAgents } from "@paperclipai/db";

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

export function preRegisterService(db: Db) {
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

    upsertAgent: async (userId: string, data: PreRegisterAgentInput) => {
      const existing = await db
        .select()
        .from(preRegisterAgents)
        .where(eq(preRegisterAgents.preRegisterUserId, userId))
        .then((rows) => rows[0] ?? null);

      if (existing) {
        return db
          .update(preRegisterAgents)
          .set({
            agentId: data.agentId,
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
  };
}
