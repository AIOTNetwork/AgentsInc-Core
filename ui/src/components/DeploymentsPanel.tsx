import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEPLOYMENT_IDLE_STATUSES,
  DeploymentAction,
  DeploymentStatus,
  DeploymentType,
  type Deployment,
  type DeploymentManifestTarget,
} from "@paperclipai/shared";
import { ExternalLink, RefreshCw, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { deploymentsApi } from "../api/deployments";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "./StatusBadge";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";

const POLLING_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  DeploymentStatus.PENDING,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.STOPPING,
]);

const REDEPLOY_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  DeploymentStatus.STOPPED,
  DeploymentStatus.DEPLOY_FAILED,
  DeploymentStatus.STOP_FAILED,
]);

const STOP_STATUSES: ReadonlySet<DeploymentStatus> = new Set(DEPLOYMENT_IDLE_STATUSES);

const FAILED_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  DeploymentStatus.DEPLOY_FAILED,
  DeploymentStatus.STOP_FAILED,
]);

function targetLabel(t: Pick<DeploymentManifestTarget, "name" | "displayName">): string {
  return t.displayName ?? t.name;
}

function formatLastSynced(value: Deployment["lastSyncedAt"]): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeAgo(date);
}

function formatExactDateTime(value: Deployment["lastDeployedAt"]): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function DeploymentsPanel({
  companyId,
  projectId,
}: {
  companyId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.deployments.list(companyId, projectId);

  const query = useQuery({
    queryKey,
    queryFn: () => deploymentsApi.list(companyId, projectId),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      return data.deployments.some((d) => POLLING_STATUSES.has(d.status)) ? 30000 : false;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const deployMutation = useMutation({
    mutationFn: (input: { targetName: string; type: DeploymentType }) =>
      deploymentsApi.patch(companyId, projectId, {
        action: DeploymentAction.DEPLOY,
        targets: [{ targetName: input.targetName, type: input.type }],
      }),
    onSuccess: invalidate,
  });

  const stopMutation = useMutation({
    mutationFn: (input: { targetName: string; type: DeploymentType }) =>
      deploymentsApi.patch(companyId, projectId, {
        action: DeploymentAction.STOP,
        targets: [{ targetName: input.targetName, type: input.type }],
      }),
    onSuccess: invalidate,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      deploymentsApi.patch(companyId, projectId, { action: DeploymentAction.REFRESH }),
    onSuccess: invalidate,
  });

  const [sweepNotice, setSweepNotice] = useState<string | null>(null);
  const sweepMutation = useMutation({
    mutationFn: () => deploymentsApi.sweep(companyId, projectId),
    onSuccess: (data) => {
      setSweepNotice(
        data.swept === 0
          ? "No stuck deployments found."
          : `${data.swept} stuck deployment${data.swept === 1 ? "" : "s"} marked as failed.`,
      );
      invalidate();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 429) {
        const retry = (err.body as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
        setSweepNotice(`Sweep was just run. Try again in ${retry ?? "a few"} second${retry === 1 ? "" : "s"}.`);
      } else {
        setSweepNotice(`Sweep failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    },
  });

  const [selectedTargetName, setSelectedTargetName] = useState<string>("");
  const [selectedType, setSelectedType] = useState<DeploymentType>(DeploymentType.PREVIEW);

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading deployments…</p>;
  }
  if (query.error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load deployments: {(query.error as Error).message}
      </p>
    );
  }
  if (!query.data) return null;

  const { deployments, manifestTargets, quota } = query.data;
  const manifestByName = new Map(manifestTargets.map((t) => [t.name, t]));
  // A (target, type) is occupied if a deployment row for it exists in any
  // non-stopped/failed state — Deploy is disabled then. Stopped/failed rows
  // are reachable via the row-level Redeploy button.
  const occupiedKeys = new Set(
    deployments
      .filter((d) => !STOP_STATUSES.has(d.status))
      .map((d) => `${d.targetName}|${d.type}`),
  );
  const selectedKey = selectedTargetName ? `${selectedTargetName}|${selectedType}` : "";
  const selectionOccupied = !!selectedKey && occupiedKeys.has(selectedKey);

  const isOrphan = (d: Deployment) => !manifestByName.has(d.targetName);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <span className="tabular-nums">
              {quota.repo.used}/{quota.repo.limit}
            </span>{" "}
            deployments in this project ·{" "}
            <span className="tabular-nums">
              {quota.project.used}/{quota.project.limit}
            </span>{" "}
            deployable projects
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshMutation.isPending && "animate-spin")}
                  />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Ask the deployment agent to re-check Vercel and update what's shown here.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sweepMutation.mutate()}
                  disabled={sweepMutation.isPending}
                  data-testid="sweep-button"
                >
                  <Eraser className={cn("h-3.5 w-3.5", sweepMutation.isPending && "animate-pulse")} />
                  Sweep stuck
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Mark deployments stuck for over 15 min as failed so you can retry them.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {sweepNotice && (
          <p className="text-xs text-muted-foreground">{sweepNotice}</p>
        )}

        {deployments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deployments yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Target</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">URL</th>
                  <th className="px-3 py-2 text-left font-medium">Last synced</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Last deployed
                    <span className="ml-1 text-[9px] normal-case text-muted-foreground/70">
                      (local time)
                    </span>
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {deployments.map((d) => {
                  const orphan = isOrphan(d);
                  const canStop = STOP_STATUSES.has(d.status);
                  const canRedeploy = REDEPLOY_STATUSES.has(d.status);
                  const showError = FAILED_STATUSES.has(d.status) && d.lastError;
                  const manifestEntry = manifestByName.get(d.targetName);
                  const label = manifestEntry ? targetLabel(manifestEntry) : d.targetName;
                  return (
                    <tr key={d.id} className={cn(orphan && "opacity-70")}>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-medium">{label}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {d.targetName}
                        </div>
                        {orphan && (
                          <span className="mt-0.5 inline-block text-[10px] uppercase tracking-wider text-amber-300">
                            orphaned
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.type}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={d.status} />
                        {showError && (
                          <div
                            className="mt-1 max-w-xs truncate text-[10px] text-muted-foreground"
                            title={d.lastError ?? undefined}
                          >
                            {d.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            open
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatLastSynced(d.lastSyncedAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatExactDateTime(d.lastDeployedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {canStop && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => stopMutation.mutate({
                                targetName: d.targetName,
                                type: d.type,
                              })}
                              disabled={stopMutation.isPending}
                            >
                              Stop
                            </Button>
                          )}
                          {canRedeploy && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deployMutation.mutate({
                                targetName: d.targetName,
                                type: d.type,
                              })}
                              disabled={deployMutation.isPending}
                            >
                              Redeploy
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Deploy a target
          </div>
          {manifestTargets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No manifest entries. Ask the company's CEO agent to register deployables in deploy-targets.json.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedTargetName} onValueChange={setSelectedTargetName}>
                <SelectTrigger size="sm" className="min-w-[14rem]">
                  <SelectValue placeholder="Pick a target…" />
                </SelectTrigger>
                <SelectContent>
                  {manifestTargets.map((t: DeploymentManifestTarget) => (
                    <SelectItem key={t.name} value={t.name}>
                      <span>{targetLabel(t)}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedType}
                onValueChange={(v) => setSelectedType(v as DeploymentType)}
              >
                <SelectTrigger size="sm" className="min-w-[8rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DeploymentType.PREVIEW}>Preview</SelectItem>
                  <SelectItem value={DeploymentType.PRODUCTION}>Production</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!selectedTargetName || selectionOccupied) return;
                        deployMutation.mutate({
                          targetName: selectedTargetName,
                          type: selectedType,
                        });
                        setSelectedTargetName("");
                      }}
                      disabled={
                        !selectedTargetName || selectionOccupied || deployMutation.isPending
                      }
                    >
                      Deploy
                    </Button>
                  </span>
                </TooltipTrigger>
                {selectionOccupied && (
                  <TooltipContent>
                    A {selectedType} deployment for this target is already running. Stop it
                    first or use the Redeploy button on the row.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
