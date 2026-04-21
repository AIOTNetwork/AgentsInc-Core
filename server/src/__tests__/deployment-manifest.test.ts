import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DEPLOYMENT_MANIFEST_FILENAME } from "@paperclipai/shared";
import { readDeploymentManifest } from "../services/deployment-manifest.js";

let tmp: string | null = null;
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = null; });

function setup(contents: string | null) {
  tmp = mkdtempSync(path.join(tmpdir(), "dm-"));
  if (contents !== null) writeFileSync(path.join(tmp, DEPLOYMENT_MANIFEST_FILENAME), contents);
  return tmp;
}

describe("readDeploymentManifest", () => {
  it("returns empty when file missing", async () => {
    expect(await readDeploymentManifest(setup(null))).toEqual({ targets: [], warnings: [] });
  });

  it("parses a valid manifest", async () => {
    const dir = setup(JSON.stringify({
      targets: [
        { name: "web", framework: "next", dependsOn: ["api"] },
        { name: "api", framework: "node" },
      ],
    }));
    const r = await readDeploymentManifest(dir);
    expect(r.targets).toEqual([
      { name: "web", framework: "next", dependsOn: ["api"] },
      { name: "api", framework: "node" },
    ]);
  });

  it("skips invalid entries with warnings", async () => {
    const dir = setup(JSON.stringify({
      targets: [
        { name: "Bad Name" },
        { name: "ok" },
      ],
    }));
    const r = await readDeploymentManifest(dir);
    expect(r.targets).toEqual([{ name: "ok" }]);
    expect(r.warnings.length).toBe(1);
  });

  it("returns empty on malformed json with a warning", async () => {
    const r = await readDeploymentManifest(setup(`{ not valid json [[[`));
    expect(r.targets).toEqual([]);
    expect(r.warnings[0]).toMatch(/parse/i);
  });
});
