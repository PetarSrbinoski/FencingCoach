"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

/* -------------------------------------------------------------------------- */
/*  Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

interface SparklineProps {
  points: { day: string; value: number | null }[];
  color?: string;
  height?: number;
  unit?: string;
}

function SparklineTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: { payload: { day: string; value: number | null } }[];
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.value == null) return null;
  return (
    <div className="border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground font-mono text-[11px]">{d.day}</p>
      <p className="font-semibold font-mono mt-0.5 text-foreground">
        {d.value.toLocaleString()}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

export function Sparkline({
  points,
  color = "hsl(var(--foreground))",
  height = 64,
  unit,
}: SparklineProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.15} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" hide />
        <YAxis hide />
        <Tooltip
          content={({ active, payload }) => (
            <SparklineTooltip active={active} payload={payload as any} unit={unit} />
          )}
          cursor={false}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#spark-fill)"
          connectNulls
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: color, fill: "hsl(var(--card))" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  BarChartComponent                                                          */
/* -------------------------------------------------------------------------- */

interface BarChartComponentProps {
  values: { label: string; value: number }[];
  color?: string;
  height?: number;
  unit?: string;
}

function BarTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: { value: number }[];
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold font-mono text-foreground">
        {payload[0].value.toLocaleString()}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

export function BarChartComponent({
  values,
  color = "hsl(var(--accent))",
  height = 120,
  unit,
}: BarChartComponentProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={values} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          className="text-xs"
          tick={{ fontSize: 11, fontWeight: 500, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis hide />
        <Tooltip
          content={({ active, payload }) => (
            <BarTooltip active={active} payload={payload as any} unit={unit} />
          )}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }}
        />
        <Bar
          dataKey="value"
          fill={color}
          radius={0}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Gauge                                                                      */
/* -------------------------------------------------------------------------- */

interface GaugeProps {
  score: number;
  size?: number;
  label?: string;
}

export function Gauge({ score, size = 120, label = "readiness" }: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const arcColor =
    clamped < 40 ? "hsl(var(--accent))" : clamped <= 65 ? "#F59E0B" : "#10B981";

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg
        width={size}
        height={size * 0.6}
        viewBox={`0 0 ${size} ${size * 0.6}`}
        className="overflow-visible"
      >
        {/* background track */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size * 0.55}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
        />

        {/* foreground arc */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size * 0.55}`}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-300 ease-out"
        />

        {/* score text */}
        <text
          x={size / 2}
          y={size * 0.42}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-sans"
          style={{ fontSize: size * 0.32, fontWeight: 700 }}
        >
          {Math.round(clamped)}
        </text>
      </svg>

      <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  MacroProgress                                                              */
/* -------------------------------------------------------------------------- */

interface MacroProgressProps {
  label: string;
  actual: number;
  target: number;
  unit?: string;
  color?: string;
}

export function MacroProgress({
  label,
  actual,
  target,
  unit = "g",
  color,
}: MacroProgressProps) {
  const pct = target > 0 ? (actual / target) * 100 : 0;
  const clampedWidth = Math.min(pct, 100);

  const barColor =
    color ??
    (pct < 70
      ? "#F59E0B"
      : pct <= 115
        ? "#10B981"
        : "hsl(var(--accent))");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-foreground font-mono font-medium">
          {actual} / {target} {unit}{" "}
          <span className="text-muted-foreground">({Math.round(pct)}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${clampedWidth}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
    </div>
  );
}
