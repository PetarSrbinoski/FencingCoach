"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** URL-backed local navigation also understands existing resource deep links. */
export function useView<T extends string>(
  allowed: readonly T[],
  fallback: T,
  infer?: (query: URLSearchParams) => T | undefined,
  key = "view",
) {
  const [view, setView] = useState<T>(fallback);
  const allowedKey = allowed.join(",");
  const inferRef = useRef(infer);
  inferRef.current = infer;
  useEffect(() => {
    const read = () => {
      const query = new URLSearchParams(window.location.search);
      const requested = query.get(key) as T;
      setView(
        allowedKey.split(",").includes(requested)
          ? requested
          : (inferRef.current?.(query) ?? fallback),
      );
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [allowedKey, fallback, key]);
  function choose(next: T) {
    const url = new URL(window.location.href);
    url.searchParams.set(key, next);
    if (url.href !== window.location.href)
      window.history.pushState({}, "", url);
    setView(next);
  }
  return [view, choose] as const;
}

export function ViewTabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 gap-1 rounded-2xl bg-muted p-1"
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-current={value === item.value ? "page" : undefined}
          onClick={() => onChange(item.value)}
          className={cn(
            "min-h-12 min-w-0 flex-1 rounded-xl px-2 py-2 text-sm font-medium",
            value === item.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function Editor({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
        className="flex h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)] flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[calc(var(--app-height,100dvh)*0.9)] sm:max-w-2xl sm:rounded-2xl sm:p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border p-4 pr-14 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Review your changes before saving."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReadMore({
  children,
  label = "Read full note",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <div className={open ? undefined : "line-clamp-3"}>{children}</div>
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : label}
      </Button>
    </div>
  );
}

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="break-words">{message}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Protect an unsaved form on reload and ordinary in-app link navigation. */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.getAttribute("href")?.startsWith("#")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(link.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  return (
    <Dialog
      open={destination !== null}
      onOpenChange={(open) => {
        if (!open) setDestination(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            Your edits are saved as a draft on this device. You can return to
            finish them.
          </DialogDescription>
        </DialogHeader>
        <Button onClick={() => setDestination(null)}>Keep editing</Button>
        <Button
          variant="outline"
          onClick={() => {
            const url = new URL(destination!);
            setDestination(null);
            router.push(url.pathname + url.search + url.hash);
          }}
        >
          Leave and keep draft
        </Button>
      </DialogContent>
    </Dialog>
  );
}
