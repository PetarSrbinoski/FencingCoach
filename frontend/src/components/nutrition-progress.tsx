export function NutritionProgress({
  label,
  actual,
  target,
  unit,
  color,
}: {
  label: string;
  actual: number;
  target: number;
  unit: string;
  color: string;
}) {
  const progress = target > 0 ? Math.min(1, Math.max(0, actual / target)) : 0;
  const circumference = 2 * Math.PI * 42;

  return (
    <div className="min-w-0 text-center">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target > 0 ? target : 100}
        aria-valuenow={target > 0 ? Math.min(target, Math.max(0, actual)) : 0}
        aria-valuetext={
          target > 0
            ? `${actual} of ${target} ${unit}`
            : `${actual} ${unit}; no target set`
        }
        className={`relative mx-auto aspect-square w-full max-w-32 sm:max-w-36 ${color}`}
      >
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            opacity={progress > 0 ? 1 : 0}
            className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-foreground">
          <span className="text-base font-semibold leading-tight tabular-nums min-[375px]:text-xl sm:text-3xl">
            {Math.round(actual)}
          </span>
          <span className="text-[10px] text-muted-foreground sm:text-xs">
            {unit}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold sm:text-sm">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
        {target > 0 ? `of ${Math.round(target)} ${unit}` : "No target set"}
      </p>
    </div>
  );
}
