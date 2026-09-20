import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

/** 轻量分段式 Tabs：项目内 UI 组件均为手写极简实现，这里保持同一风格。 */
export function Tabs({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex flex-wrap items-center gap-1 rounded-xl bg-slate-200/50 p-1", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "focus-ring inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition",
              active ? "bg-white text-indigo-700 soft-shadow" : "text-slate-500 hover:bg-white/70 hover:text-slate-700",
            )}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
