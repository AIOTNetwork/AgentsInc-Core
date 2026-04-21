import { describe, expect, it } from "vitest";
import { buildVercelProjectName } from "../services/deployment-naming.js";

describe("buildVercelProjectName", () => {
  const companyId = "11111111-1111-1111-1111-111111111111";
  const projectId = "22222222-2222-2222-2222-222222222222";

  it("joins env, slugs, target, and hash in order", () => {
    const name = buildVercelProjectName({
      env: "dev", companyId, companySlug: "tes",
      projectId, projectSlug: "trading-company", targetName: "web",
    });
    expect(name).toMatch(/^dev-tes-trading-company-web-[a-f0-9]{8}$/);
  });

  it("is deterministic for the same inputs", () => {
    const base = {
      env: "dev", companyId, companySlug: "tes",
      projectId, projectSlug: "trading-company", targetName: "web",
    };
    expect(buildVercelProjectName(base)).toBe(buildVercelProjectName(base));
  });

  it("falls back to 'local' when env is empty", () => {
    const name = buildVercelProjectName({
      env: "", companyId, companySlug: "tes",
      projectId, projectSlug: "trading-company", targetName: "web",
    });
    expect(name).toMatch(/^local-/);
  });

  it("truncates projectSlug when name would exceed 100 chars", () => {
    const name = buildVercelProjectName({
      env: "prod", companyId, companySlug: "acme",
      projectId, projectSlug: "a".repeat(150), targetName: "web",
    });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toMatch(/-[a-f0-9]{8}$/);
    expect(name).toMatch(/^prod-acme-/);
  });
});
