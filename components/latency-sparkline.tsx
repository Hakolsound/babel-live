"use client";

interface LatencySparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export function LatencySparkline({ data, width = 120, height = 32 }: LatencySparklineProps) {
  if (data.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[9px] text-white/20"
      >
        no data
      </div>
    );
  }

  const avg = data.reduce((s, v) => s + v, 0) / data.length;
  const color = avg < 2000 ? "#34d399" : avg < 4000 ? "#fbbf24" : "#f87171";

  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * innerW;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const avgLabel = avg >= 1000 ? `${(avg / 1000).toFixed(1)}s` : `${Math.round(avg)}ms`;

  return (
    <div className="flex items-center gap-1.5">
      <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span style={{ color, fontSize: 9, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
        {avgLabel}
      </span>
    </div>
  );
}
