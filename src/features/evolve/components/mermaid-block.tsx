import { useEffect, useId, useRef, useState } from "react";

/** 实际渲染器：code 变化时由外层 key 重挂载，状态天然重置，effect 内只在异步回调里更新状态。 */
function MermaidRenderer({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"pending" | "ok" | "fail">("pending");
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        const { svg } = await mermaid.render(`mermaid-${idBase}`, code.trim());
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setState("ok");
      } catch {
        if (!cancelled) setState("fail");
      }
    })();
    return () => { cancelled = true; };
  }, [code, idBase]);

  if (state === "fail") {
    return <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-1 text-[10px] font-semibold text-amber-700">图表语法无法渲染，已展示源码</div>
      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-600">{code}</pre>
    </div>;
  }
  return <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-3">
    <div ref={hostRef} className={state === "pending" ? "min-h-10" : ""} />
    {state === "pending" && <div className="text-[10px] text-slate-400">图表渲染中…</div>}
  </div>;
}

/** mermaid 代码块 → SVG 图；渲染失败回退源码，图块不空窗。 */
export function MermaidBlock({ code, className }: { code: string; className?: string }) {
  return <div className={className}><MermaidRenderer key={code} code={code} /></div>;
}
