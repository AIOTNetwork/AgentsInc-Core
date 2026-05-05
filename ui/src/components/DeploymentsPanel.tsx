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
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deploymentsApi } from "../api/deployments";
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

function targetLabel(t: Pick<DeploymentManifestTarget, "name" | "displayName">): string {
  return t.displayName ?? t.name;
}

function formatLastSynced(value: Deployment["lastSyncedAt"]): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeAgo(date);
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
      return data.deployments.some((d) => POLLING_STATUSES.has(d.status)) ? 3000 : false;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const deployMutation = useMutation({
    mutationFn: (targetName: string) =>
      deploymentsApi.patch(companyId, projectId, {
        action: DeploymentAction.DEPLOY,
        targets: [{ targetName, type: DeploymentType.PREVIEW }],
      }),
    onSuccess: invalidate,
  });

  const stopMutation = useMutation({
    mutationFn: (targetName: string) =>
      deploymentsApi.patch(companyId, projectId, {
        action: DeploymentAction.STOP,
        targets: [{ targetName }],
      }),
    onSuccess: invalidate,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      deploymentsApi.patch(companyId, projectId, { action: DeploymentAction.REFRESH }),
    onSuccess: invalidate,
  });

  const [selectedTargetName, setSelectedTargetName] = useState<string>("");

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
  const deployedTargetNames = new Set(deployments.map((d) => d.targetName));
  const undeployedManifestTargets = manifestTargets.filter(
    (t) => !deployedTargetNames.has(t.name),
  );

  const isOrphan = (d: Deployment) => !manifestByName.has(d.targetName);

  return (
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
      </div>

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
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {deployments.map((d) => {
                const orphan = isOrphan(d);
                const canStop = STOP_STATUSES.has(d.status);
                const canRedeploy = REDEPLOY_STATUSES.has(d.status);
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
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {canStop && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => stopMutation.mutate(d.targetName)}
                            disabled={stopMutation.isPending}
                          >
                            Stop
                          </Button>
                        )}
                        {canRedeploy && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deployMutation.mutate(d.targetName)}
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
        {undeployedManifestTargets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {manifestTargets.length === 0
              ? "No manifest entries. Ask the company's CEO agent to register deployables in deploy-targets.json."
              : "All manifest targets already have a deployment row."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedTargetName} onValueChange={setSelectedTargetName}>
              <SelectTrigger size="sm" className="min-w-[14rem]">
                <SelectValue placeholder="Pick a target…" />
              </SelectTrigger>
              <SelectContent>
                {undeployedManifestTargets.map((t: DeploymentManifestTarget) => (
                  <SelectItem key={t.name} value={t.name}>
                    <span>{targetLabel(t)}</span>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => {
                if (!selectedTargetName) return;
                deployMutation.mutate(selectedTargetName);
                setSelectedTargetName("");
              }}
              disabled={!selectedTargetName || deployMutation.isPending}
            >
              Deploy
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
