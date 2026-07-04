"use client";

import { useEffect, useState } from "react";
import { Cloud, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Provider = "local" | "cloud";

/** Manual toggle between the local (e.g. llama.cpp/vLLM on your own
 * machine) and cloud LLM provider pools — see backend `services
 * /llm_provider.py`. Persisted server-side and takes effect immediately
 * for every agent, no backend restart needed. */
export function LlmProviderToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings
      .getLlmProvider()
      .then((r) => setProvider(r.provider as Provider))
      .catch(() => {});
  }, []);

  async function choose(next: Provider) {
    if (busy || provider === next || provider === null) return;
    const prev = provider;
    setBusy(true);
    setProvider(next); // optimistic
    try {
      await api.settings.setLlmProvider(next);
    } catch {
      setProvider(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => provider && choose(provider === "local" ? "cloud" : "local")}
        disabled={busy || provider === null}
        title={provider ? `LLM provider: ${provider} (click to switch)` : "LLM provider"}
        aria-label="Toggle LLM provider (local/cloud)"
        className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
      <span className="block text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
        LLM provider
      </span>
      <div className="flex border border-border text-[10px] font-semibold uppercase tracking-wider">
        <button
          onClick={() => choose("local")}
          disabled={busy || provider === null}
          aria-pressed={provider === "local"}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            provider === "local"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
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
            "flex flex-1 items-center justify-center gap-1.5 border-l border-border px-2 py-1.5 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            provider === "cloud"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Cloud className="h-3 w-3" strokeWidth={1.5} />
          Cloud
        </button>
      </div>
    </div>
  );
}
