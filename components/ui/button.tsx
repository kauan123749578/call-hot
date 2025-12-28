import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-500/50 hover:from-red-700 hover:to-red-800 hover:shadow-red-500/70 hover:scale-[1.02] active:scale-[0.98]",
        secondary:
          "border border-white/20 bg-black/40 backdrop-blur-sm text-white hover:bg-white/10 hover:border-red-500/50",
        ghost:
          "text-white/70 hover:bg-red-500/10 hover:text-red-300",
        outline:
          "border-2 border-red-500/50 bg-transparent text-red-300 hover:bg-red-500/10 hover:border-red-500",
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
