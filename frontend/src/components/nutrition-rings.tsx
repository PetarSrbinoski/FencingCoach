import type { CSSProperties } from "react";

type Nutrients = { kcal: number; carbs_g: number; protein_g: number; fat_g: number };

// Outside → inside is a deliberate, stable order, shared by the legend.
const macros = [
  { key: "carbs_g", label: "Carbs", color: "carbs", radius: 120, position: "Outer ring" },
  { key: "protein_g", label: "Protein", color: "protein", radius: 96, position: "Middle ring" },
  { key: "fat_g", label: "Fats", color: "fat", radius: 72, position: "Inner ring" },
] as const;

const format = (value: number) => Math.round(value).toLocaleString();
const progress = (actual: number, target: number) => target > 0 ? Math.max(0, Math.min(1, actual / target)) : 0;
const valueText = (actual: number, target: number, unit: string) => target > 0
  ? `${actual} of ${target} ${unit}`
  : `${actual} ${unit}; no target set`;

export function NutritionRings({ actual, target }: { actual: Nutrients; target: Nutrients }) {
  return (
    <div className="nutrition-rings" aria-label="Daily intake">
      <div className="macro-ring-visual">
        <svg viewBox="0 0 280 280" aria-label="Macro progress rings">
          {macros.map(({ key, label, color, radius }) => {
            const pct = progress(actual[key], target[key]);
            return (
              <g key={key} role="progressbar" aria-label={label} aria-valuemin={0}
                aria-valuemax={target[key] > 0 ? target[key] : 100}
                aria-valuenow={target[key] > 0 ? Math.min(target[key], Math.max(0, actual[key])) : 0}
                aria-valuetext={valueText(actual[key], target[key], "g")} data-macro={key}>
                <circle cx="140" cy="140" r={radius} fill="none" stroke={`hsl(var(--macro-${color}) / var(--macro-track-opacity))`} strokeWidth="16" />
                <circle className="macro-arc" cx="140" cy="140" r={radius} fill="none"
                  stroke={`hsl(var(--macro-${color}))`} strokeWidth="16" strokeLinecap="round"
                  pathLength="100" strokeDasharray={`${pct * 100} 100`} transform="rotate(-90 140 140)"
                  visibility={pct > 0 ? "visible" : "hidden"} />
              </g>
            );
          })}
        </svg>
        <div className="ring-calories" role="progressbar" aria-label="Calories" aria-valuemin={0}
          aria-valuemax={target.kcal > 0 ? target.kcal : 100}
          aria-valuenow={target.kcal > 0 ? Math.min(target.kcal, Math.max(0, actual.kcal)) : 0}
          aria-valuetext={valueText(actual.kcal, target.kcal, "kcal")}>
          <strong>{format(actual.kcal)}</strong>
          <span>kcal logged</span>
          <span>{target.kcal > 0 ? `of ${format(target.kcal)}` : "No target"}</span>
        </div>
      </div>
      <div className="macro-legend">
        {macros.map(({ key, label, color, position }) => (
          <div key={key} className="macro-legend-row" style={{ "--macro-color": `hsl(var(--macro-${color}))` } as CSSProperties}>
            <div>
              <span className="macro-label"><span className="macro-dot" aria-hidden="true" />{label}</span>
              <div className="macro-values"><strong>{format(actual[key])}</strong> <span className="macro-target text-xs text-muted-foreground">{target[key] > 0 ? `/ ${format(target[key])} g` : "g · No target set"}</span></div>
              <p className="macro-position">{position}</p>
            </div>
            <span className="macro-percentage">{target[key] > 0 ? `${Math.round(actual[key] / target[key] * 100)}%` : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
