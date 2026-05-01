"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  Card as ShadCard,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Application-level Card wrapper — adds title, action, icon props
 * on top of the base shadcn Card (which now uses Bauhaus hard shadows + thick borders).
 */
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
    <ShadCard className={cn("relative animate-fade-in", className)}>
      {/* Geometric corner decoration */}
      {title && (
        <div className="absolute top-2 right-2 w-3 h-3 bg-bauhaus-red" />
      )}
      {title && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {icon && <span className="text-foreground">{icon}</span>}
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
      ? "bg-bauhaus-blue text-white border-foreground"
      : band === "amber"
        ? "bg-bauhaus-yellow text-foreground border-foreground"
        : band === "red"
          ? "bg-bauhaus-red text-white border-foreground"
          : "bg-muted text-foreground border-foreground";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-bold", colorClass)}>
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
    <div className="flex items-baseline justify-between text-sm py-2 border-b-2 border-foreground/10 last:border-0">
      <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider">{label}</span>
      <span className="font-mono text-foreground font-bold text-sm">
        {value}
        {hint && <span className="text-muted-foreground/60 text-xs ml-1.5 font-medium">{hint}</span>}
      </span>
    </div>
  );
}
