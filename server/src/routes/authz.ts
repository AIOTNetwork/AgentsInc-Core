import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import type { PermissionKey } from "@paperclipai/shared";
import { forbidden, unauthorized } from "../errors.js";
import { accessService } from "../services/access.js";

export const PermissionLevel = {
  ELEVATED: "elevated",
  GRANTED: "granted",
} as const;
export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

export function assertBoard(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function assertInstanceAdmin(req: Request) {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function assertCompanyAccess(req: Request, companyId: string) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  if (req.actor.type === "board" && req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
  }
}

export async function assertCompanyPermission(
  req: Request,
  db: Db,
  companyId: string,
  permissionKey: PermissionKey,
): Promise<PermissionLevel> {
  assertCompanyAccess(req, companyId);
  if (req.actor.type !== "board") throw forbidden("Board access required");
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return PermissionLevel.ELEVATED;
  const access = accessService(db);
  const membership = await access.getMembership(companyId, "user", req.actor.userId ?? "");
  if (membership?.status === "active" && membership?.membershipRole === "owner") return PermissionLevel.ELEVATED;
  const allowed = await access.hasPermission(companyId, "user", req.actor.userId ?? "", permissionKey);
  if (!allowed) throw forbidden(`Missing permission: ${permissionKey}`);
  return PermissionLevel.GRANTED;
}

export function getActorInfo(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}
