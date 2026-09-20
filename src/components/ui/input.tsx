import * as React from "react";
import { cn } from "@/lib/utils";
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("studio-input focus-ring h-10 w-full rounded-xl border border-transparent bg-slate-100/80 px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-indigo-200", className)} {...props} />; }
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn("studio-input focus-ring min-h-24 w-full resize-y rounded-xl border border-transparent bg-slate-100/80 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-indigo-200", className)} {...props} />; }
