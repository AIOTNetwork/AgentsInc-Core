import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_ACTIVE_STATUSES,
  DEPLOYMENT_IDLE_STATUSES,
  isActiveDeploymentStatus,
} from "./deployment.js";

describe("deployment constants", () => {
  it("lists providers", () => {
    expect(DEPLOYMENT_PROVIDERS).toEqual(["vercel"]);
  });

  it("lists all statuses", () => {
    expect(DEPLOYMENT_STATUSES).toEqual([
      "pending", "deploying", "deployed",
      "deploy_failed", "stopping", "stopped", "stop_failed",
    ]);
  });

  it("flags active vs terminal", () => {
    expect(isActiveDeploymentStatus("pending")).toBe(true);
    expect(isActiveDeploymentStatus("deployed")).toBe(true);
    expect(isActiveDeploymentStatus("stopped")).toBe(false);
  });

  it("idle statuses (Stop allowed)", () => {
    expect(DEPLOYMENT_IDLE_STATUSES).toEqual(["deployed", "deploy_failed", "stop_failed"]);
  });
});
