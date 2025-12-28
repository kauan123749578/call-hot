import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-lg border border-white/20 bg-black/40 px-4 py-2 text-sm text-white placeholder:text-white/40 backdrop-blur-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:border-red-500 hover:border-red-500/30",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
