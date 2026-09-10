import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] min-w-0 w-full rounded-xl border border-border bg-input px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 resize-y",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
