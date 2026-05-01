import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full border border-border bg-input px-4 py-2 text-base text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 md:h-14",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
