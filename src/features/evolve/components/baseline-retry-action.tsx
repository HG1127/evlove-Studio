import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "../../../components/ui/button";

type Props = { busy: boolean; label?: string; retry: () => Promise<unknown> };
export function BaselineRetryAction({ busy, label, retry }: Props) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const execute = async () => {
    if (pending || busy) return;
    setPending(true);
    setFeedback("已收到补跑请求，正在启动缺证题执行…");
    try {
      const result = await retry();
      const summary = result && typeof result === "object" && "recoverySummary" in result ? String(result.recoverySummary) : undefined;
      setFeedback(summary ?? (result ? "本次补跑与评审完成；请查看更新后的缺证项。" : "本次补跑未返回结果，请检查运行状态或重试。"));
    } catch (error) {
      setFeedback(`补跑未完成：${error instanceof Error ? error.message : String(error)}`);
    } finally { setPending(false); }
  };
  return <div className="space-y-2">
    <Button type="button" disabled={pending || busy} onClick={() => void execute()}><RefreshCcw className={pending || busy ? "size-4 animate-spin" : "size-4"}/>{pending || busy ? "正在补跑与评审…" : "补跑缺证题并重新评审"}</Button>
    <div role="status" aria-live="polite" className="max-w-xl break-words text-xs leading-5">{pending && label ? label : feedback}</div>
  </div>;
}
