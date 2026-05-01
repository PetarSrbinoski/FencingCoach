"use client";

import { cn } from "@/lib/utils";
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
    <div className="rounded-lg border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 text-xs shadow-elevated">
      <p className="text-muted-foreground text-[11px]">{d.day}</p>
      <p className="font-semibold font-mono mt-0.5">
        {d.value.toLocaleString()}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

export function Sparkline({
  points,
  color = "#6366f1",
  height = 64,
  unit,
}: SparklineProps) {
  const id = `spark-grad-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
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
          strokeWidth={1.5}
          fill={`url(#${id})`}
          connectNulls
          dot={false}
          activeDot={{ r: 3, strokeWidth: 2, stroke: color, fill: "hsl(var(--card))" }}
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
    <div className="rounded-lg border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 text-xs shadow-elevated">
      <p className="font-semibold font-mono">
        {payload[0].value.toLocaleString()}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

export function BarChartComponent({
  values,
  color = "#6366f1",
  height = 120,
  unit,
}: BarChartComponentProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={values} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          className="text-xs fill-muted-foreground"
          tick={{ fontSize: 11 }}
        />
        <YAxis hide />
        <Tooltip
          content={({ active, payload }) => (
            <BarTooltip active={active} payload={payload as any} unit={unit} />
          )}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
        />
        <Bar
          dataKey="value"
          fill={color}
          radius={[5, 5, 0, 0]}
          opacity={0.85}
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
  const strokeWidth = size * 0.09;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius; // half-circle

  const offset = circumference - (clamped / 100) * circumference;

  const arcColor =
    clamped < 40 ? "#ef4444" : clamped <= 65 ? "#f59e0b" : "#10b981";

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg
        width={size}
        height={size * 0.6}
        viewBox={`0 0 ${size} ${size * 0.6}`}
        className="overflow-visible"
      >
        <defs>
          <filter id="gauge-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* background track */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size * 0.55}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.5}
        />

        {/* foreground arc */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size * 0.55}`}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          filter="url(#gauge-glow)"
          className="transition-all duration-1000 ease-out"
        />

        {/* score text */}
        <text
          x={size / 2}
          y={size * 0.42}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-bold"
          style={{ fontSize: size * 0.3, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
        >
          {Math.round(clamped)}
        </text>
      </svg>

      <span className="-mt-1 text-[10px] uppercase tracking-[0.15em] font-medium text-muted-foreground">
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
      ? "bg-amber-500"
      : pct <= 115
        ? "bg-emerald-500"
        : "bg-red-500");

  const isCustom = color != null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[13px]">{label}</span>
        <span className="text-muted-foreground font-mono text-[12px]">
          {actual} / {target} {unit}{" "}
          <span className="tabular-nums text-muted-foreground/60">({Math.round(pct)}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            !isCustom && barColor,
          )}
          style={{
            width: `${clampedWidth}%`,
            ...(isCustom ? { backgroundColor: color } : {}),
          }}
        />
      </div>
    </div>
  );
}
