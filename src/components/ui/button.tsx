import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
  { variants: {
    variant: {
      default: "bg-primary text-primary-foreground shadow-sm hover:bg-indigo-700",
      secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200/80",
      ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
      success: "bg-emerald-600 text-white hover:bg-emerald-700",
    },
    size: { sm: "h-8 px-3", default: "h-10 px-4", lg: "h-11 px-5" },
  }, defaultVariants: { variant: "default", size: "default" } }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
