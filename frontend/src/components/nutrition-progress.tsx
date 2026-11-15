export function NutritionProgress({
  label,
  actual,
  target,
  unit,
}: {
  label: string;
  actual: number;
  target: number;
  unit: string;
  color: string;
}) {
  const progress = target > 0 ? Math.min(1, Math.max(0, actual / target)) : 0;

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-normal tracking-tight tabular-nums">
        {Math.round(actual).toLocaleString()}{" "}
        <span className="text-xs font-normal text-muted-foreground">{unit}</span>
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target > 0 ? target : 100}
        aria-valuenow={target > 0 ? Math.min(target, Math.max(0, actual)) : 0}
        aria-valuetext={target > 0 ? `${actual} of ${target} ${unit}` : `${actual} ${unit}; no target set`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${unit === "kcal" ? "bg-accent" : "bg-foreground/40"}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {target > 0 ? `of ${Math.round(target).toLocaleString()} ${unit}` : "No target set"}
      </p>
    </div>
  );
}
