"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Cloud, Cpu } from "lucide-react";
import { useEffect, useState } from "react";

type Provider = "local" | "cloud";

export function LlmProviderToggle({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setError(null);
    api.settings
      .getLlmProvider()
      .then((r) => setProvider(r.provider as Provider))
      .catch(() => setError("Could not load the coach provider."));
  }, [revision]);

  async function choose(next: Provider) {
    if (busy || provider === next || provider === null) return;
    const prev = provider;
    setBusy(true);
    setError(null);
    setProvider(next); // optimistic
    try {
      await api.settings.setLlmProvider(next);
    } catch {
      setProvider(prev); // revert on failure
      setError("Provider was not changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() =>
          error
            ? setRevision((value) => value + 1)
            : provider && choose(provider === "local" ? "cloud" : "local")
        }
        disabled={busy || (provider === null && !error)}
        title={
          error ||
          (provider
            ? `LLM provider: ${provider} (click to switch)`
            : "LLM provider")
        }
        aria-label={
          error
            ? `${error} Retry provider settings`
            : "Toggle LLM provider (local/cloud)"
        }
        className="h-11 w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {provider === "cloud" ? (
          <Cloud className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <Cpu className="h-4 w-4" strokeWidth={1.5} />
        )}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}
          <button
            className="min-h-11 px-2 underline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <span className="block text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Coach provider
      </span>
      <div className="flex border border-border text-sm font-semibold uppercase tracking-wider">
        <button
          onClick={() => choose("local")}
          disabled={busy || provider === null}
          aria-pressed={provider === "local"}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 py-1.5 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            provider === "local"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Cpu className="h-3 w-3" strokeWidth={1.5} />
          Local
        </button>
        <button
          onClick={() => choose("cloud")}
          disabled={busy || provider === null}
          aria-pressed={provider === "cloud"}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center gap-1.5 border-l border-border px-2 py-1.5 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            provider === "cloud"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Cloud className="h-3 w-3" strokeWidth={1.5} />
          Cloud
        </button>
      </div>
    </div>
  );
}
