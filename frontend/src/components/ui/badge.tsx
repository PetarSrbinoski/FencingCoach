import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest border transition-colors duration-150",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground border-accent",
        secondary: "bg-muted text-foreground border-border",
        destructive: "bg-destructive/10 text-destructive border-destructive/30",
        outline: "bg-transparent text-muted-foreground border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
