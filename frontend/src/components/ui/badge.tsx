import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider border-2 transition-colors duration-100",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background border-foreground",
        secondary: "bg-bauhaus-blue text-white border-foreground",
        destructive: "bg-bauhaus-red text-white border-foreground",
        outline: "bg-transparent text-foreground border-foreground",
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
