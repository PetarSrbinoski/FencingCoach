"use client";

import { ErrorNotice } from "@/components/mobile-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type NutritionLog, type SavedFood } from "@/lib/api";
import { randomUUID } from "@/lib/uuid";
import { Plus, Search } from "lucide-react";
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
  const [foods, setFoods] = useState<SavedFood[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"grams" | "servings">("grams");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const repeatRequests = useRef(new Map<string, string>());
  const [receipts, setReceipts] = useState<NutritionLog[]>([]);

  useEffect(() => {
    let current = true;
    setLoadError(null);
    void Promise.allSettled([api.nutrition.list(30), api.foods.list()]).then(
      ([logs, saved]) => {
        if (!current) return;
        if (logs.status === "fulfilled") {
          const seen = new Set<string>();
          setRecent(
            [...logs.value]
              .sort(
                (a, b) => b.logged_at.localeCompare(a.logged_at) || b.id - a.id,
              )
              .filter((entry) => {
                const key = entry.raw_text.trim().toLocaleLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }),
          );
        }
        if (saved.status === "fulfilled") setFoods(saved.value);
        if (logs.status === "rejected" || saved.status === "rejected") {
          setLoadError(
            "Some foods could not be loaded. You can still describe a meal above.",
          );
        }
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [revision, retry]);

  async function log(
    source: NutritionLog | SavedFood,
    kind: "recent" | "saved",
    quantity = 1,
  ) {
    if (writing.current || !day) return;
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      (kind === "recent" && quantity > 20)
    ) {
      setError(
        kind === "recent"
          ? "Use a portion above 0 and no greater than 20."
          : "Enter an amount greater than zero.",
      );
      return;
    }
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      let entry: NutritionLog;
      if (kind === "recent") {
        const key = JSON.stringify([source.id, day, meal, quantity]);
        // An uncertain retry must use the same server request ID.
        const requestId = repeatRequests.current.get(key) ?? randomUUID();
        repeatRequests.current.set(key, requestId);
        entry = await api.nutrition.repeat(source.id, {
          day,
          meal: meal || null,
          multiplier: quantity,
          request_id: requestId,
        });
        repeatRequests.current.delete(key);
      } else {
        const food = source as SavedFood;
        entry = await api.foods.log(
          [
            {
              food_id: food.id,
              ...(unit === "servings" && food.serving_size_g
                ? { servings: quantity }
                : { grams: quantity }),
            },
          ],
          meal || undefined,
          day,
        );
      }
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
  const visibleFoods = foods.filter((food) =>
    food.name.toLocaleLowerCase().includes(search),
  );

  function portionEditor(
    source: NutritionLog | SavedFood,
    kind: "recent" | "saved",
  ) {
    const food = kind === "saved" ? (source as SavedFood) : null;
    const factor = food
      ? ((unit === "servings" ? food.serving_size_g || 1 : 1) *
          Number(amount)) /
        100
      : Number(amount);
    const incomplete = [
      source.kcal,
      source.protein_g,
      source.carbs_g,
      source.fat_g,
    ].some((value) => value === null);
    return (
      <form
        className="mb-3 space-y-3 rounded-xl bg-muted/50 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void log(source, kind, Number(amount));
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            {food ? "Amount" : "× last recorded portion"}
            <Input
              aria-label="Portion amount"
              type="number"
              inputMode="decimal"
              min="0.001"
              max={food ? undefined : 20}
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          {food && (
            <label className="min-w-0 flex-1 text-sm">
              Measure
              <select
                aria-label="Portion measure"
                className="h-12 w-full rounded-xl border border-input bg-background px-2 text-base"
                value={unit}
                onChange={(event) => {
                  const next = event.target.value as "grams" | "servings";
                  if (food.serving_size_g && Number(amount) > 0) {
                    setAmount(
                      String(
                        Number(
                          (
                            Number(amount) *
                            (next === "grams"
                              ? food.serving_size_g
                              : 1 / food.serving_size_g)
                          ).toFixed(3),
                        ),
                      ),
                    );
                  }
                  setUnit(next);
                }}
              >
                <option value="grams">Grams</option>
                {food.serving_size_g && (
                  <option value="servings">
                    {food.serving_name || "Serving"} ({food.serving_size_g} g)
                  </option>
                )}
              </select>
            </label>
          )}
          <Button
            className={food ? "w-full" : undefined}
            disabled={busy || !day || (kind === "saved" && incomplete)}
            type="submit"
          >
            Log food
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {source.kcal === null
            ? "Calories unknown"
            : `${Math.round(source.kcal * (Number.isFinite(factor) ? factor : 0))} kcal`}
          {kind === "recent" && " · Uses the recorded nutrition values"}
        </p>
        {kind === "saved" && incomplete && (
          <p className="text-sm text-warning">
            Add the missing calories and macros in Foods before logging this
            food.
          </p>
        )}
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
          aria-label="Search recent and saved foods"
          placeholder="Search recent & saved foods"
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
                Tap + for the same portion. Tap the name to adjust.
              </p>
              <ul className="mt-1 divide-y divide-border">
                {visibleRecent.map((entry) => (
                  <li key={entry.id}>
                    <div className="flex items-center gap-2 py-1">
                      <button
                        type="button"
                        className="min-h-12 min-w-0 flex-1 py-2 text-left"
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
                        <span className="block break-words text-sm font-medium">
                          {entry.raw_text}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Last recorded portion ·{" "}
                          {entry.kcal === null
                            ? "Calories unknown"
                            : `${Math.round(entry.kcal)} kcal`}
                        </span>
                      </button>
                      <Button
                        size="icon"
                        variant="outline"
                        disabled={busy || !day}
                        aria-label={`Log ${entry.raw_text} again`}
                        onClick={() => void log(entry, "recent")}
                      >
                        <Plus />
                      </Button>
                    </div>
                    {active === `recent-${entry.id}` &&
                      portionEditor(entry, "recent")}
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
          {(search || showAll || !recent.length) && visibleFoods.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Saved foods</h3>
              <ul className="divide-y divide-border">
                {visibleFoods.slice(0, showAll ? undefined : 8).map((food) => (
                  <li key={food.id}>
                    <button
                      type="button"
                      className="min-h-12 w-full py-3 text-left"
                      aria-expanded={active === `saved-${food.id}`}
                      onClick={() => {
                        setActive(
                          active === `saved-${food.id}`
                            ? null
                            : `saved-${food.id}`,
                        );
                        setAmount(food.serving_size_g ? "1" : "100");
                        setUnit(food.serving_size_g ? "servings" : "grams");
                      }}
                    >
                      <span className="block text-sm font-medium">
                        {food.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {food.serving_size_g
                          ? `${food.serving_name || "Serving"} · ${food.serving_size_g} g`
                          : "Choose amount in grams"}
                      </span>
                    </button>
                    {active === `saved-${food.id}` &&
                      portionEditor(food, "saved")}
                  </li>
                ))}
              </ul>
              {!showAll && visibleFoods.length > 8 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll(true)}
                >
                  Show all matches
                </Button>
              )}
            </div>
          )}
          {!search && recent.length > 0 && !showAll && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Browse saved foods
            </Button>
          )}
          {!recent.length && !foods.length && (
            <p className="text-sm text-muted-foreground">
              Your recent foods will appear here after you log a meal. Start
              with a description above.
            </p>
          )}
          {search && !matches.length && !visibleFoods.length && (
            <p className="text-sm text-muted-foreground">
              No matching foods. Describe what you ate above.
            </p>
          )}
        </>
      )}
    </section>
  );
}
