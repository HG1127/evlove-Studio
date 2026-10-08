import { useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EvolveProject } from "@evolution/contracts";
import { canRetryStoredServerExperiment, retryStoredServerExperiment } from "../runtime/server-experiment-retry";

export function ServerExperimentRetry({ project, busy, onOpenRuntime }: { project: EvolveProject; busy: boolean; onOpenRuntime: () => void }) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string>();
  if (!canRetryStoredServerExperiment(project)) return null;
  const retry = async () => {
    if (busy || locked.current || started) return;
    locked.current = true; setPending(true); setError(undefined);
    try { await retryStoredServerExperiment(project); setStarted(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "后台实验未能启动，请稍后重试。"); }
    finally { locked.current = false; setPending(false); }
  };
  return <div className="max-w-sm space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || pending || started} onClick={() => void retry()}>{pending ? <Loader2 className="size-4 animate-spin"/> : <RefreshCcw className="size-4"/>}{pending ? "正在恢复实验…" : started ? "已交给后台继续" : "重试已保存的实验"}</Button>
      <Button variant="secondary" onClick={onOpenRuntime}>查看运行记录</Button>
    </div>
    <p className="text-xs leading-5 text-slate-600" role={error ? "alert" : "status"}>{error ?? (started ? "后台已接收恢复请求；实验结果会更新到当前任务。" : "保留已生成的成果和测试记录，后台核验冻结文件、检查模型并继续独立评审。")}</p>
  </div>;
}
