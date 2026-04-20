import { describe, expect, it } from "vitest";
import {
  deploymentsPatchSchema,
  deploymentResultSchema,
  deploymentSettingsUpdateSchema,
} from "./deployment.js";

describe("deploymentsPatchSchema", () => {
  it("accepts deploy with targets", () => {
    expect(deploymentsPatchSchema.safeParse({
      action: "deploy",
      targets: [{ targetName: "web", type: "preview" }],
    }).success).toBe(true);
  });

  it("accepts stop with only targetName per target", () => {
    expect(deploymentsPatchSchema.safeParse({
      action: "stop",
      targets: [{ targetName: "web" }],
    }).success).toBe(true);
  });

  it("accepts refresh with no targets", () => {
    expect(deploymentsPatchSchema.safeParse({ action: "refresh" }).success).toBe(true);
  });

  it("rejects invalid target names", () => {
    expect(deploymentsPatchSchema.safeParse({
      action: "deploy",
      targets: [{ targetName: "Has Space", type: "preview" }],
    }).success).toBe(false);
  });
});

describe("deploymentResultSchema", () => {
  it("accepts started kind without success", () => {
    expect(deploymentResultSchema.safeParse({ kind: "deploy_started" }).success).toBe(true);
  });

  it("requires success on final kind", () => {
    expect(deploymentResultSchema.safeParse({ kind: "deploy" }).success).toBe(false);
  });
});

describe("deploymentSettingsUpdateSchema", () => {
  it("accepts partial update", () => {
    expect(deploymentSettingsUpdateSchema.safeParse({ maxDeployableProjects: 2 }).success).toBe(true);
  });

  it("rejects negative values", () => {
    expect(deploymentSettingsUpdateSchema.safeParse({ maxDeployableProjects: -1 }).success).toBe(false);
  });
});
