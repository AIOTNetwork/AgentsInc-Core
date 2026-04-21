import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_ACTIVE_STATUSES,
  DEPLOYMENT_IDLE_STATUSES,
  isActiveDeploymentStatus,
  DEPLOYMENT_ACTIONS,
  DEPLOYMENT_WAKEUP_KINDS,
  DEPLOYMENT_RESULT_KINDS,
  DEPLOYMENT_MANIFEST_FILENAME,
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

describe("deployment action/kind constants", () => {
  it("lists actions", () => {
    expect(DEPLOYMENT_ACTIONS).toEqual(["deploy", "stop", "refresh"]);
  });
  it("lists wakeup kinds", () => {
    expect(DEPLOYMENT_WAKEUP_KINDS).toEqual(["deploy", "teardown", "reconcile"]);
  });
  it("lists result kinds", () => {
    expect(DEPLOYMENT_RESULT_KINDS).toEqual([
      "deploy_started", "deploy",
      "teardown_started", "teardown",
      "reconcile_started", "reconcile",
    ]);
  });
  it("exports manifest filename", () => {
    expect(DEPLOYMENT_MANIFEST_FILENAME).toBe("deploy-targets.json");
  });
});
