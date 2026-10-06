"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-[13px] font-medium transition-[background,color,border,box-shadow,transform] duration-150 select-none disabled:pointer-events-none disabled:opacity-45 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.3)] hover:brightness-110",
        secondary: "bg-surface-2 text-fg border border-border hover:bg-surface-3 hover:border-border-strong",
        outline: "border border-border text-fg hover:bg-hover hover:border-border-strong",
        ghost: "text-fg-2 hover:text-fg hover:bg-hover",
        danger: "bg-danger/90 text-white hover:bg-danger shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]",
        "danger-ghost": "text-danger hover:bg-danger-bg",
        link: "text-accent hover:underline underline-offset-4 px-0 h-auto",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-sm",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
