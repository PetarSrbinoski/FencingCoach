"use client";

import {
  CardContent,
  CardHeader,
  CardTitle,
  Card as ShadCard,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import React from "react";

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
    <ShadCard
      className={cn(
        !bordered && "border-transparent hover:border-transparent",
        className,
      )}
    >
      {title && (
        <CardHeader className="pb-3">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
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

export function BandPill({
  band,
}: {
  band: "red" | "amber" | "green" | string;
}) {
  const colorClass =
    band === "green"
      ? "border-emerald-500 text-success"
      : band === "amber"
        ? "border-amber-500 text-warning"
        : band === "red"
          ? "border-accent text-accent"
          : "border-muted-foreground text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 text-sm font-medium",
        colorClass,
      )}
    >
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
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm py-2.5 border-b border-border last:border-0">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span className="font-sans text-foreground font-medium text-sm">
        {value}
        {hint && (
          <span className="text-muted-foreground text-xs ml-1.5">{hint}</span>
        )}
      </span>
    </div>
  );
}
