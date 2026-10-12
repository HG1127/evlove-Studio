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
  const activeProject = useRef(project);
  const readInFlight = useRef<Promise<ServerFailedControlRetryTarget | undefined> | undefined>(undefined);
  const submittedTarget = useRef<ServerFailedControlRetryTarget | undefined>(undefined);
  const [target, setTarget] = useState<ServerFailedControlRetryTarget>();
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string>();
  const [readError, setReadError] = useState<string>();
  useEffect(() => {
    let mounted = true, timer: ReturnType<typeof setTimeout> | undefined;
    active.current = true; activeProject.current = project;
    const read = async () => {
      if (!mounted) return;
      const previous = readInFlight.current;
      if (previous) {
        await previous.catch(() => undefined);
        if (mounted) timer = setTimeout(() => void read(), 0);
        return;
      }
      if (locked.current) {
        timer = setTimeout(() => void read(), 15_000);
        return;
      }
      const request = Promise.resolve().then(() => loadServerFailedControlRetry(project));
      readInFlight.current = request;
      try {
        const value = await request;
        if (!mounted || locked.current) return;
        setReadError(undefined);
        const submitted = submittedTarget.current;
        if (submitted) {
          if (!value || value.jobId === submitted.jobId && value.runId === submitted.runId) return;
          submittedTarget.current = undefined; setStarted(false);
        }
        setTarget(value); onRecoveryStateChange(value ? "failed" : undefined);
      } catch (cause) {
        if (mounted && !locked.current) {
          if (!submittedTarget.current) { setTarget(undefined); onRecoveryStateChange(undefined); }
          setReadError(cause instanceof Error ? cause.message : "无法读取后台执行状态，请查看运行记录。");
        }
      } finally {
        if (readInFlight.current === request) readInFlight.current = undefined;
        if (mounted) timer = setTimeout(() => void read(), 15_000);
      }
    };
    void read();
    return () => { mounted = false; active.current = false; clearTimeout(timer); };
  }, [project, onRecoveryStateChange]);
  const retry = async () => {
    if (!target || busy || locked.current || started) return;
    locked.current = true; setPending(true); setError(undefined); setReadError(undefined);
    try {
      await retryServerFailedControl(project, target);
      if (active.current && activeProject.current === project) {
        submittedTarget.current = target; setStarted(true); onRecoveryStateChange("submitted");
      }
    } catch (cause) {
      if (active.current && activeProject.current === project) {
        if (cause instanceof ServerFailedControlRetryUnavailableError) { setTarget(undefined); onRecoveryStateChange(undefined); }
        setError(cause instanceof Error ? cause.message : "后台重试未能启动，请稍后重试。");
      }
    } finally { locked.current = false; if (active.current) setPending(false); }
  };
  const message = error ?? readError;
  if (!target && !message) return null;
  return <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-3">
    <div className="flex flex-wrap gap-2">
      {target && <Button disabled={busy || pending || started} onClick={() => void retry()}>
        {pending ? <Loader2 className="size-4 animate-spin"/> : <RefreshCcw className="size-4"/>}
        {pending ? "正在提交重试…" : started ? "新后台执行已提交" : "重试后台执行"}
      </Button>}
      <Button variant="secondary" onClick={onOpenRuntime}>查看运行记录</Button>
    </div>
    <p className="text-xs leading-5 text-slate-700" role={message ? "alert" : "status"}>
      {message ?? (started ? "新后台执行已提交，请查看实时运行状态。" : "后台执行已失败或已取消。重试会保留已有成果和运行记录，并由后台核验当前任务后继续。")}
    </p>
  </div>;
}
