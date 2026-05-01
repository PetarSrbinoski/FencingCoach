"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  Card as ShadCard,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

/**
 * Application-level Card wrapper — minimal editorial styling.
 * Content separated by thin borders, generous space.
 */
export function Card({
  title,
  action,
  children,
  className,
  icon,
  bordered = true,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <ShadCard className={cn(!bordered && "border-transparent hover:border-transparent", className)}>
      {title && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              {icon && <span className="text-accent">{icon}</span>}
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
      ? "border-emerald-500 text-emerald-400"
      : band === "amber"
        ? "border-amber-500 text-amber-400"
        : band === "red"
          ? "border-accent text-accent"
          : "border-muted-foreground text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest", colorClass)}>
      {band}
    </span>
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
    <div className="flex items-baseline justify-between text-sm py-2.5 border-b border-border last:border-0">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{label}</span>
      <span className="font-mono text-foreground font-medium text-sm">
        {value}
        {hint && <span className="text-muted-foreground text-xs ml-1.5">{hint}</span>}
      </span>
    </div>
  );
}
