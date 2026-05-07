// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DeploymentAction,
  DeploymentProvider,
  DeploymentStatus,
  DeploymentType,
  type Deployment,
} from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentsPanel } from "./DeploymentsPanel";

const mockDeploymentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  patch: vi.fn(),
  sweep: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
}));

vi.mock("../api/deployments", () => ({
  deploymentsApi: mockDeploymentsApi,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type = "button", disabled, ...props }: ComponentProps<"button">) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

// Replace the Radix Select with a native <select> so jsdom can drive it.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="target-select"
      value={value ?? ""}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="">Pick a target…</option>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  // Render value as the option text. Production uses Radix SelectItem which
  // accepts rich JSX children; the mock keeps text-only to avoid HTML
  // nesting warnings (<option> can't contain <span>).
  SelectItem: ({ value }: { value: string }) => <option value={value}>{value}</option>,
}));

vi.mock("./StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status">{status}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => (
    <span data-slot="tooltip-content">{children}</span>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function createDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: "d1",
    companyId: "c1",
    projectId: "p1",
    targetName: "web",
    type: DeploymentType.PREVIEW,
    provider: DeploymentProvider.VERCEL,
    status: DeploymentStatus.DEPLOYED,
    url: "https://example.vercel.app",
    vercelProjectId: null,
    vercelDeploymentId: null,
    lastError: null,
    lastSyncedAt: null,
    lastDeployedAt: null,
    requestedByUserId: null,
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    ...overrides,
  };
}

function createListResponse(overrides: {
  deployments?: Deployment[];
  manifestTargets?: Array<{ name: string; displayName?: string }>;
} = {}) {
  return {
    deployments: overrides.deployments ?? [],
    manifestTargets: overrides.manifestTargets ?? [],
    quota: {
      project: { used: 1, limit: 5, planCap: 5 },
      repo: { used: 1, limit: 3, planCap: 3 },
    },
  };
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

async function mountPanel(container: HTMLDivElement) {
  const queryClient = newQueryClient();
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DeploymentsPanel companyId="c1" projectId="p1" />
      </QueryClientProvider>,
    );
  });
  await flush();
  return { root, queryClient };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

function getTargetSelect(container: HTMLElement): HTMLSelectElement | null {
  // The first Select in the deploy area is the target picker; the second is
  // the preview/production type picker.
  return container.querySelector<HTMLSelectElement>('[data-testid="target-select"]');
}

function getTypeSelect(container: HTMLElement): HTMLSelectElement | null {
  const all = container.querySelectorAll<HTMLSelectElement>('[data-testid="target-select"]');
  return all[1] ?? null;
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("DeploymentsPanel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows Stop on a deployed target and not Redeploy", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ status: DeploymentStatus.DEPLOYED })],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(findButton(container, "Stop")).toBeTruthy();
    expect(findButton(container, "Redeploy")).toBeUndefined();

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("shows Redeploy (and not Stop) on a stopped target", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ status: DeploymentStatus.STOPPED })],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(findButton(container, "Redeploy")).toBeTruthy();
    expect(findButton(container, "Stop")).toBeUndefined();

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("shows both Stop and Redeploy on deploy_failed", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ status: DeploymentStatus.DEPLOY_FAILED })],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(findButton(container, "Stop")).toBeTruthy();
    expect(findButton(container, "Redeploy")).toBeTruthy();

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("hides Stop and Redeploy while deploying", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ status: DeploymentStatus.DEPLOYING })],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(findButton(container, "Stop")).toBeUndefined();
    expect(findButton(container, "Redeploy")).toBeUndefined();

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("tags a deployment as orphaned when its target is not in the manifest", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({ id: "d1", targetName: "web" }),
          createDeployment({ id: "d2", targetName: "ghost" }),
        ],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    const text = container.textContent ?? "";
    expect(text).toContain("ghost");
    expect(text).toContain("orphaned");

    // 'web' row exists but is not flagged as orphaned. We assert by checking
    // that "orphaned" appears once total — only on the ghost row.
    const orphanedMatches = text.match(/orphaned/g) ?? [];
    expect(orphanedMatches).toHaveLength(1);

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("renders displayName in the deployments table when the manifest provides one", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ targetName: "web" })],
        manifestTargets: [{ name: "web", displayName: "Frontend (Vite)" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(container.textContent ?? "").toContain("Frontend (Vite)");
    // The raw name still appears as a secondary label.
    expect(container.textContent ?? "").toContain("web");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("falls back to name when displayName is missing", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ targetName: "api" })],
        manifestTargets: [{ name: "api" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(container.textContent ?? "").toContain("api");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("dispatches deploy with the selected target's name when Deploy is clicked", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [],
        manifestTargets: [
          { name: "web", displayName: "Frontend (Vite)" },
          { name: "api", displayName: "API server" },
        ],
      }),
    );
    mockDeploymentsApi.patch.mockResolvedValue({ deployments: [] });
    const { root, queryClient } = await mountPanel(container);

    const select = getTargetSelect(container);
    expect(select).toBeTruthy();
    expect(select!.options.length).toBe(3); // placeholder + 2 manifest entries

    await act(async () => setSelectValue(select!, "api"));

    const deployButton = findButton(container, "Deploy");
    expect(deployButton).toBeTruthy();
    expect(deployButton!.disabled).toBe(false);

    await act(async () => {
      deployButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mockDeploymentsApi.patch).toHaveBeenCalledWith("c1", "p1", {
      action: DeploymentAction.DEPLOY,
      targets: [{ targetName: "api", type: DeploymentType.PREVIEW }],
    });

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("dispatches deploy with type=production when the type toggle is set to Production", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [],
        manifestTargets: [{ name: "web" }],
      }),
    );
    mockDeploymentsApi.patch.mockResolvedValue({ deployments: [] });
    const { root, queryClient } = await mountPanel(container);

    await act(async () => setSelectValue(getTargetSelect(container)!, "web"));
    await act(async () => setSelectValue(getTypeSelect(container)!, DeploymentType.PRODUCTION));

    await act(async () => {
      findButton(container, "Deploy")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    expect(mockDeploymentsApi.patch).toHaveBeenCalledWith("c1", "p1", {
      action: DeploymentAction.DEPLOY,
      targets: [{ targetName: "web", type: DeploymentType.PRODUCTION }],
    });

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("disables Deploy when the (target,type) combo is already running", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({
            targetName: "web",
            type: DeploymentType.PREVIEW,
            status: DeploymentStatus.DEPLOYED,
          }),
        ],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    // Default type=preview, target=web → already deployed → Deploy disabled.
    await act(async () => setSelectValue(getTargetSelect(container)!, "web"));
    expect(findButton(container, "Deploy")!.disabled).toBe(true);

    // Flip to production → Deploy is enabled (production row does not exist).
    await act(async () => setSelectValue(getTypeSelect(container)!, DeploymentType.PRODUCTION));
    expect(findButton(container, "Deploy")!.disabled).toBe(false);

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("Stop and Redeploy buttons send the row's type", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({
            id: "d1",
            targetName: "web",
            type: DeploymentType.PRODUCTION,
            status: DeploymentStatus.DEPLOY_FAILED,
          }),
        ],
        manifestTargets: [{ name: "web" }],
      }),
    );
    mockDeploymentsApi.patch.mockResolvedValue({ deployments: [] });
    const { root, queryClient } = await mountPanel(container);

    await act(async () => {
      findButton(container, "Redeploy")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    expect(mockDeploymentsApi.patch).toHaveBeenLastCalledWith("c1", "p1", {
      action: DeploymentAction.DEPLOY,
      targets: [{ targetName: "web", type: DeploymentType.PRODUCTION }],
    });

    await act(async () => {
      findButton(container, "Stop")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    expect(mockDeploymentsApi.patch).toHaveBeenLastCalledWith("c1", "p1", {
      action: DeploymentAction.STOP,
      targets: [{ targetName: "web", type: DeploymentType.PRODUCTION }],
    });

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("calls patch with action=refresh when Refresh is clicked", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({ deployments: [], manifestTargets: [] }),
    );
    mockDeploymentsApi.patch.mockResolvedValue({ deployments: [] });
    const { root, queryClient } = await mountPanel(container);

    const refreshButton = findButton(container, "Refresh");
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mockDeploymentsApi.patch).toHaveBeenCalledWith("c1", "p1", {
      action: DeploymentAction.REFRESH,
    });

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("lists every manifest target in the dropdown — including ones already deployed for some type", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          // `web` has a preview row, but the production slot is still open.
          createDeployment({ targetName: "web", type: DeploymentType.PREVIEW }),
        ],
        manifestTargets: [
          { name: "web", displayName: "Frontend" },
          { name: "api", displayName: "API server" },
          { name: "worker", displayName: "Background worker" },
        ],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    const select = getTargetSelect(container);
    expect(select).toBeTruthy();
    const optionValues = Array.from(select!.options).map((o) => o.value);
    expect(optionValues).toContain("web");
    expect(optionValues).toContain("api");
    expect(optionValues).toContain("worker");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("hides the dropdown and shows guidance when the manifest is empty", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({ deployments: [], manifestTargets: [] }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(getTargetSelect(container)).toBeNull();
    expect(container.textContent ?? "").toContain("deploy-targets.json");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("renders lastDeployedAt as exact local time, falling back to '—' when null", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({
            id: "d1",
            targetName: "web",
            lastDeployedAt: new Date("2026-05-06T07:30:45.000Z"),
          }),
          createDeployment({
            id: "d2",
            targetName: "api",
            lastDeployedAt: null,
          }),
        ],
        manifestTargets: [{ name: "web" }, { name: "api" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    const text = container.textContent ?? "";
    // Format: YYYY-MM-DD HH:mm:ss in local time. The exact local hour depends
    // on the runner's timezone, so we just assert the date/regex shape rather
    // than a specific clock value.
    expect(text).toMatch(/2026-05-0[5-7] \d{2}:\d{2}:\d{2}/);
    // The null-value row should still render "—" somewhere.
    expect(text).toContain("—");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("shows lastError under the status badge on deploy_failed rows", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({
            status: DeploymentStatus.DEPLOY_FAILED,
            lastError: "vercel_token_not_configured",
          }),
        ],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(container.textContent ?? "").toContain("vercel_token_not_configured");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("hides lastError on non-failed rows", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [
          createDeployment({
            status: DeploymentStatus.DEPLOYED,
            lastError: "stale error from previous failure",
          }),
        ],
        manifestTargets: [{ name: "web" }],
      }),
    );
    const { root, queryClient } = await mountPanel(container);

    expect(container.textContent ?? "").not.toContain("stale error from previous failure");

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("calls api.sweep when 'Sweep stuck' is clicked and surfaces the result count", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({ deployments: [], manifestTargets: [] }),
    );
    mockDeploymentsApi.sweep.mockResolvedValue({ swept: 2, sweptIds: ["a", "b"] });
    const { root, queryClient } = await mountPanel(container);

    const sweepButton = findButton(container, "Sweep stuck");
    expect(sweepButton).toBeTruthy();

    await act(async () => {
      sweepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mockDeploymentsApi.sweep).toHaveBeenCalledWith("c1", "p1");
    expect(container.textContent ?? "").toMatch(/2 stuck deployments/);

    await act(async () => root.unmount());
    queryClient.clear();
  });

  it("surfaces a retry message when sweep returns 429", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({ deployments: [], manifestTargets: [] }),
    );
    const { ApiError } = await import("../api/client");
    mockDeploymentsApi.sweep.mockRejectedValue(
      new ApiError("sweep_throttled", 429, { error: "sweep_throttled", retryAfterSeconds: 17 }),
    );
    const { root, queryClient } = await mountPanel(container);

    const sweepButton = findButton(container, "Sweep stuck");
    await act(async () => {
      sweepButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent ?? "").toMatch(/Try again in 17 seconds/);

    await act(async () => root.unmount());
    queryClient.clear();
  });
});
