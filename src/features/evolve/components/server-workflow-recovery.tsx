import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EvolveProject } from "@evolution/contracts";
import type { ServerFailedControlRetryTarget } from "@evolution/harness";
import { loadServerFailedControlRetry, retryServerFailedControl, ServerFailedControlRetryUnavailableError } from "../runtime/server-failed-control-retry";

export type ServerWorkflowRecoveryState = "failed" | "submitted" | undefined;

export function ServerWorkflowRecovery({ project, busy, onOpenRuntime, onRecoveryStateChange }: {
  project: EvolveProject; busy: boolean; onOpenRuntime: () => void;
  onRecoveryStateChange: (state: ServerWorkflowRecoveryState) => void;
}) {
  const locked = useRef(false);
  const active = useRef(true);
  const [target, setTarget] = useState<ServerFailedControlRetryTarget>();
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true; active.current = true;
    void loadServerFailedControlRetry(project).then(value => {
      if (mounted) { setTarget(value); onRecoveryStateChange(value ? "failed" : undefined); }
    }).catch(cause => {
      if (mounted) {
        setTarget(undefined); onRecoveryStateChange(undefined);
        setError(cause instanceof Error ? cause.message : "无法读取后台执行状态，请查看运行记录。");
      }
    });
    return () => { mounted = false; active.current = false; };
  }, [project, onRecoveryStateChange]);
  const retry = async () => {
    if (!target || busy || locked.current || started) return;
    locked.current = true; setPending(true); setError(undefined);
    try {
      await retryServerFailedControl(project, target);
      if (active.current) { setStarted(true); onRecoveryStateChange("submitted"); }
    }
    catch (cause) {
      if (active.current) {
        if (cause instanceof ServerFailedControlRetryUnavailableError) { setTarget(undefined); onRecoveryStateChange(undefined); }
        setError(cause instanceof Error ? cause.message : "后台重试未能启动，请稍后重试。");
      }
    }
    finally { locked.current = false; if (active.current) setPending(false); }
  };
  if (!target && !error) return null;
  return <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-3">
    <div className="flex flex-wrap gap-2">
      {target && <Button disabled={busy || pending || started} onClick={() => void retry()}>
        {pending ? <Loader2 className="size-4 animate-spin"/> : <RefreshCcw className="size-4"/>}
        {pending ? "正在提交重试…" : started ? "新后台执行已提交" : "重试后台执行"}
      </Button>}
      <Button variant="secondary" onClick={onOpenRuntime}>查看运行记录</Button>
    </div>
    <p className="text-xs leading-5 text-slate-700" role={error ? "alert" : "status"}>
      {error ?? (started ? "新后台执行已提交，请查看实时运行状态。" : "后台执行已失败或已取消。重试会保留已有成果和运行记录，并由后台核验当前任务后继续。")}
    </p>
  </div>;
}