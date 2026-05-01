import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex items-center justify-center whitespace-nowrap font-semibold uppercase tracking-wider transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "text-accent gap-2 px-0 py-2 group",
        outline:
          "border border-foreground text-foreground px-6 gap-2 hover:bg-foreground hover:text-background",
        ghost:
          "text-muted-foreground px-4 gap-2 hover:text-foreground group",
        secondary:
          "border border-foreground text-foreground px-6 gap-2 hover:bg-foreground hover:text-background",
        destructive:
          "text-destructive gap-2 px-0 py-2 group",
        link:
          "text-foreground underline underline-offset-4 px-0 gap-2",
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
    const hasUnderline = variant === "default" || variant === "destructive" || !variant

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
        {hasUnderline && (
          <span className="absolute bottom-1.5 left-0 right-0 h-0.5 bg-current origin-left scale-x-100 group-hover:scale-x-110 transition-transform duration-150" />
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
