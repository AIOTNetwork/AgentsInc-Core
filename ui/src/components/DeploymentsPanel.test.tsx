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
  return container.querySelector<HTMLSelectElement>('[data-testid="target-select"]');
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

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, "api");
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

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

  it("lists only undeployed manifest targets in the dropdown", async () => {
    mockDeploymentsApi.list.mockResolvedValue(
      createListResponse({
        deployments: [createDeployment({ targetName: "web" })],
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
    expect(optionValues).toContain("api");
    expect(optionValues).toContain("worker");
    expect(optionValues).not.toContain("web"); // already deployed

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
});
