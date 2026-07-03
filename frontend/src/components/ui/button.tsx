import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap font-semibold uppercase tracking-wider transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background border border-foreground gap-2 px-6 shadow-sm hover:bg-foreground/85 hover:shadow",
        outline:
          "border border-border text-foreground gap-2 px-6 hover:border-foreground hover:bg-muted",
        secondary:
          "bg-muted text-foreground border border-border gap-2 px-6 hover:bg-muted/60",
        ghost:
          "text-muted-foreground gap-2 px-4 hover:text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive gap-2 px-6 shadow-sm hover:bg-destructive/90",
        link:
          "text-foreground underline underline-offset-4 px-0 gap-2 hover:text-accent",
      },
      size: {
        default: "h-10 text-sm [&_svg]:size-4",
        sm: "h-8 text-xs [&_svg]:size-3.5",
        lg: "h-12 text-base [&_svg]:size-5",
        icon: "h-10 w-10 px-0 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
