"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "destructive";

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastRecord extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DISMISS_AFTER_MS = 4500;

const VARIANT_ICON: Record<ToastVariant, React.ElementType> = {
  default: Info,
  success: CheckCircle2,
  destructive: AlertCircle,
};

const VARIANT_BORDER: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-emerald-500/30",
  destructive: "border-accent/30",
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-400",
  destructive: "text-accent",
};

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = "default" }: ToastInput) => {
      const id = ++idCounter;
      setToasts((current) => [...current, { id, title, description, variant }]);
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4"
      >
        {toasts.map((t) => {
          const Icon = VARIANT_ICON[t.variant ?? "default"];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 border bg-card px-4 py-3 shadow-md animate-in fade-in-0 slide-in-from-bottom-2",
                VARIANT_BORDER[t.variant ?? "default"]
              )}
            >
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", VARIANT_ICON_COLOR[t.variant ?? "default"])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
