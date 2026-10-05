"use client";

import { ErrorNotice } from "@/components/mobile-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type NutritionLog } from "@/lib/api";
import { randomUUID } from "@/lib/uuid";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function QuickFoods({
  day,
  meal,
  revision,
  onChanged,
}: {
  day: string;
  meal: string;
  revision: number;
  onChanged: () => void;
}) {
  const [recent, setRecent] = useState<NutritionLog[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const repeatRequests = useRef(new Map<string, string>());
  const [receipts, setReceipts] = useState<NutritionLog[]>([]);

  useEffect(() => {
    let current = true;
    setLoadError(null);
    void api.nutrition.list(30).then(
      (logs) => {
        if (!current) return;
        const seen = new Set<string>();
        setRecent(
          [...logs]
            .sort((a, b) => b.logged_at.localeCompare(a.logged_at) || b.id - a.id)
            .filter((entry) => {
              const key = entry.raw_text.trim().toLocaleLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }),
        );
        setLoading(false);
      },
      () => {
        if (!current) return;
        setLoadError(
          "Recent foods could not be loaded. You can still describe a meal above.",
        );
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [revision, retry]);

  async function log(source: NutritionLog, quantity = 1) {
    if (writing.current || !day) return;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 20) {
      setError("Use a portion above 0 and no greater than 20.");
      return;
    }
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const key = JSON.stringify([source.id, day, meal, quantity]);
      // An uncertain retry must use the same server request ID.
      const requestId = repeatRequests.current.get(key) ?? randomUUID();
      repeatRequests.current.set(key, requestId);
      const entry = await api.nutrition.repeat(source.id, {
        day,
        meal: meal || null,
        multiplier: quantity,
        request_id: requestId,
      });
      repeatRequests.current.delete(key);
      setReceipts([entry]);
      setActive(null);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function undo(entry: NutritionLog) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.nutrition.delete(entry.id);
      setReceipts((current) => current.filter((item) => item.id !== entry.id));
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const search = query.trim().toLocaleLowerCase();
  const matches = recent.filter((entry) =>
    entry.raw_text.toLocaleLowerCase().includes(search),
  );
  const visibleRecent = search || showAll ? matches : matches.slice(0, 3);

  function portionEditor(source: NutritionLog) {
    const factor = Number(amount);
    return (
      <form
        className="mb-3 space-y-3 rounded-xl bg-muted/50 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void log(source, Number(amount));
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            × last recorded portion
            <Input
              aria-label="Portion amount"
              type="number"
              inputMode="decimal"
              min="0.001"
              max={20}
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <Button disabled={busy || !day} type="submit">
            Log food
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {source.kcal === null
            ? "Calories unknown"
            : `${Math.round(source.kcal * (Number.isFinite(factor) ? factor : 0))} kcal`}
          {" · Uses the recorded nutrition values"}
        </p>
      </form>
    );
  }

  return (
    <section aria-label="Quick food logging" className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted-foreground"
        />
        <Input
          id="quick-food-search"
          type="search"
          aria-label="Search recent foods"
          placeholder="Search recent foods"
          className="pl-10"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(null);
          }}
        />
      </div>
      {loadError && (
        <ErrorNotice
          message={loadError}
          retry={() => setRetry((value) => value + 1)}
        />
      )}
      {error && <ErrorNotice message={error} />}
      {receipts.map((entry) => (
        <div
          key={entry.id}
          role="status"
          className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm"
        >
          <span className="min-w-0 flex-1 break-words">
            Logged {entry.raw_text} · {entry.day}
            {entry.meal ? ` · ${entry.meal}` : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void undo(entry)}
            aria-label={`Undo logging ${entry.raw_text}`}
          >
            Undo
          </Button>
        </div>
      ))}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading your foods…
        </p>
      ) : (
        <>
          {visibleRecent.length > 0 && (
            <div>
              {search && (
                <h3 className="text-sm font-semibold">Recent matches</h3>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Add the same portion again, or adjust the amount first.
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {visibleRecent.map((entry) => (
                  <li key={entry.id} className="min-w-0 rounded-xl border border-border p-3">
                    <div className="space-y-3">
                      <div>
                        <p className="break-words text-sm font-medium">{entry.raw_text}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.kcal === null ? "Calories unknown" : `${Math.round(entry.kcal)} kcal`} · Last portion
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy || !day}
                        aria-label={`Log ${entry.raw_text} again`}
                        onClick={() => void log(entry)}
                      >
                        Add again
                      </Button>
                      <button
                        type="button"
                        className="min-h-10 rounded-lg px-3 text-sm underline underline-offset-4"
                        aria-label={`Adjust portion of ${entry.raw_text}`}
                        aria-expanded={active === `recent-${entry.id}`}
                        onClick={() => {
                          setActive(
                            active === `recent-${entry.id}`
                              ? null
                              : `recent-${entry.id}`,
                          );
                          setAmount("1");
                        }}
                      >
                        {active === `recent-${entry.id}` ? "Close" : "Adjust portion"}
                      </button>
                      </div>
                    </div>
                    {active === `recent-${entry.id}` &&
                      portionEditor(entry)}
                  </li>
                ))}
              </ul>
              {!search && matches.length > 3 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show fewer" : "More recent foods"}
                </Button>
              )}
            </div>
          )}
          {!recent.length && (
            <p className="text-sm text-muted-foreground">
              Your recent foods will appear here after you log a meal. Start
              with a description above.
            </p>
          )}
          {search && recent.length > 0 && !matches.length && (
            <p className="text-sm text-muted-foreground">
              No matching foods. Describe what you ate above.
            </p>
          )}
        </>
      )}
    </section>
  );
}
