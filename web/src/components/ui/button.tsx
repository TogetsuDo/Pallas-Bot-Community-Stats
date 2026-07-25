import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-[background,border-color,box-shadow,transform,color] duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:pointer-events-none disabled:opacity-45 rounded-[var(--radius-control,8px)] active:scale-[0.97]",
  {
    variants: {
      variant: {
        default:
          "border border-[color-mix(in_srgb,var(--accent)_38%,transparent)] bg-[var(--accent)] text-[var(--accent-contrast,#fff)] shadow-[0_1px_2px_color-mix(in_srgb,var(--accent)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_90%,#000_10%)]",
        outline:
          "border border-[color-mix(in_srgb,var(--text)_12%,transparent)] bg-transparent text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]",
        ghost:
          "border border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]",
      },
      size: {
        default: "h-9 px-3 py-1.5",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
