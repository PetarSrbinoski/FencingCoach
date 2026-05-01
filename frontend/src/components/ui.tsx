"use client";

// Legacy re-exports for backward compatibility.
// New code should import from @/components/ui/* directly.
import React from "react";
import { cn } from "@/lib/utils";
import {
  Card as ShadCard,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function Card({
  title,
  action,
  children,
  className,
  icon,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <ShadCard className={cn("animate-fade-in", className)}>
      {title && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium tracking-tight">
              {icon && <span className="text-muted-foreground">{icon}</span>}
              {title}
            </CardTitle>
            {action}
          </div>
        </CardHeader>
      )}
      {!title && action && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-end">{action}</div>
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </ShadCard>
  );
}

export function BandPill({ band }: { band: "red" | "amber" | "green" | string }) {
  const colorClass =
    band === "green"
      ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/20"
      : band === "amber"
        ? "bg-amber-500/12 text-amber-400 border-amber-500/20"
        : band === "red"
          ? "bg-red-500/12 text-red-400 border-red-500/20"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cn("uppercase tracking-wider text-[10px] font-semibold", colorClass)}>
      {band}
    </Badge>
  );
}

export function StatRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm py-2 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span className="font-mono text-foreground font-medium text-[13px]">
        {value}
        {hint && <span className="text-muted-foreground/50 text-xs ml-1.5">{hint}</span>}
      </span>
    </div>
  );
}
