import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-muted border-2 border-border-light animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
