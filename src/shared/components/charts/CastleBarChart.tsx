import React, { useId, useMemo } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth';
import './charts.css';

export interface BarDatum {
  label: string;
  value: number;
  status?: 'ok' | 'under' | 'over';
}

export interface CastleBarChartProps {
  data: BarDatum[];
  maxValue?: number;
  goalLine?: number;
  goalLabel?: string;
  height?: number;
  themed?: boolean;
  legend?: { ok?: string; under?: string; over?: string };
  valueFormatter?: (value: number) => string;
}

const STATUS_COLORS = {
  ok: { start: '#E0C068', end: '#8a6f2a', flag: '#E0C068', solid: '#c8a96e' },
  under: { start: '#4a8a3f', end: '#26521f', flag: '#3D8B34', solid: '#6b8f3c' },
  over: { start: '#C0392B', end: '#7a1818', flag: '#C0392B', solid: '#8b2500' },
};

export const CastleBarChart: React.FC<CastleBarChartProps> = ({
  data,
  maxValue,
  goalLine,
  goalLabel,
  height = 200,
  themed = true,
  legend,
  valueFormatter,
}) => {
  const formatValue = useMemo(
    () => valueFormatter ?? ((v: number) => v.toLocaleString()),
    [valueFormatter],
  );
  const uid = useId();

  const computedMax = useMemo(
    () => maxValue ?? Math.max(...data.map((d) => d.value), goalLine ?? 0) * 1.15,
    [data, maxValue, goalLine]
  );

  const barCount = data.length;
  /*
   * El viewBox sigue al contenedor en lugar de ser fijo.
   *
   * Con `viewBox="0 0 345 220"`, `width: 100%` y `preserveAspectRatio`, el alto
   * dibujado es ancho × (220/345): en una tarjeta de 1640 px el gráfico se
   * dibujaba de 1046 px de alto, con las cifras a 52 px y pisándose entre
   * ellas. Midiendo el ancho real, el dibujo va 1:1 — el `height` que pide
   * quien lo usa es por fin el alto que se ve, en cualquier ventana.
   */
  const [hostRef, hostWidth] = useElementWidth<HTMLDivElement>(345);
  const viewBoxWidth = Math.max(280, hostWidth);
  const chartTop = 40;
  const chartBottom = height - 20;
  const chartHeight = chartBottom - chartTop;
  const barSpacing = viewBoxWidth / barCount;
  const barWidth = Math.min(64, Math.max(14, barSpacing * 0.55));

  // At 30 bars the x labels overlap into a smear; show one every `labelStep`.
  const labelStep = useMemo(() => {
    const longest = data.reduce((m, d) => Math.max(m, d.label.length), 1);
    const needed = longest * 7 + 6; // approx. label width in viewBox units
    return Math.max(1, Math.ceil(needed / Math.max(1, barSpacing)));
  }, [data, barSpacing]);

  /** ¿Entran todas las cifras sin pisarse? Si no, se rotula selectivamente. */
  const showAllValues = useMemo(() => {
    const longest = data.reduce((m, d) => Math.max(m, formatValue(d.value).length), 1);
    return longest * 7 + 12 <= barSpacing;
  }, [data, barSpacing, formatValue]);

  const tallestIdx = useMemo(() => {
    let maxIdx = 0;
    data.forEach((d, i) => {
      if (d.value > data[maxIdx].value) maxIdx = i;
    });
    return maxIdx;
  }, [data]);

  if (!themed) {
    return (
      <div className="castle-chart castle-chart--simple chart-container" ref={hostRef}>
        <svg
          className="castle-chart-svg"
          viewBox={`0 0 ${viewBoxWidth} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ height }}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1="0"
              y1={chartBottom - chartHeight * frac}
              x2={viewBoxWidth}
              y2={chartBottom - chartHeight * frac}
              stroke="rgba(74,45,26,0.12)"
              strokeDasharray="2 4"
            />
          ))}

          {/* Goal line */}
          {goalLine != null && computedMax > 0 && (
            <g>
              <line
                x1="0"
                y1={chartBottom - (goalLine / computedMax) * chartHeight}
                x2={viewBoxWidth}
                y2={chartBottom - (goalLine / computedMax) * chartHeight}
                stroke="#8B2020"
                strokeWidth="1.5"
                strokeDasharray="6 3"
              />
              {goalLabel && (
                <text
                  x={viewBoxWidth - 4}
                  y={chartBottom - (goalLine / computedMax) * chartHeight - 4}
                  textAnchor="end"
                  fontFamily="IM Fell English SC"
                  fontSize="11"
                  fontWeight="700"
                  fill="#8B2020"
                >
                  {goalLabel}
                </text>
              )}
            </g>
          )}

          {/* Bars */}
          {data.map((d, i) => {
            const status = d.status ?? 'ok';
            const barH = computedMax > 0 ? Math.max(0, (d.value / computedMax) * chartHeight) : 0;
            const x = barSpacing * i + (barSpacing - barWidth) / 2;
            const y = chartBottom - barH;

            return (
              <g key={i}>
                <rect
                  className="simple-bar"
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barH}
                  fill={STATUS_COLORS[status].solid}
                  rx={4}
                  ry={4}
                />
                {/* Value label */}
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontFamily="Fira Code"
                  fontSize="11"
                  fontWeight="700"
                  fill="#3B2314"
                >
                  {formatValue(d.value)}
                </text>
                {/* X label — thinned so labels never overlap */}
                {i % labelStep === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={height - 2}
                    textAnchor="middle"
                    fontFamily="IM Fell English SC"
                    fontSize="12"
                    fontWeight="700"
                    fill="#3B2314"
                    letterSpacing="1"
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Floor line */}
          <line
            x1="0"
            y1={chartBottom}
            x2={viewBoxWidth}
            y2={chartBottom}
            stroke="#3B2314"
            strokeWidth="1"
          />
        </svg>

        {legend && <SimpleLegend legend={legend} />}
      </div>
    );
  }

  // ── Themed: Castle towers with merlons ──
  return (
    <div className="castle-chart chart-container" ref={hostRef}>
      <svg
        className="castle-chart-svg"
        viewBox={`0 0 ${viewBoxWidth} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
      >
        <defs>
          {/* Stone gradient fills per status */}
          <linearGradient id={`${uid}-stoneGold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STATUS_COLORS.ok.start} />
            <stop offset="100%" stopColor={STATUS_COLORS.ok.end} />
          </linearGradient>
          <linearGradient id={`${uid}-stoneGreen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STATUS_COLORS.under.start} />
            <stop offset="100%" stopColor={STATUS_COLORS.under.end} />
          </linearGradient>
          <linearGradient id={`${uid}-stoneRed`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STATUS_COLORS.over.start} />
            <stop offset="100%" stopColor={STATUS_COLORS.over.end} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1="0"
            y1={chartBottom - chartHeight * frac}
            x2={viewBoxWidth}
            y2={chartBottom - chartHeight * frac}
            stroke="rgba(74,45,26,0.12)"
          />
        ))}

        {/* Goal line — banner style */}
        {goalLine != null && computedMax > 0 && (
          <GoalBanner
            uid={uid}
            y={chartBottom - (goalLine / computedMax) * chartHeight}
            width={viewBoxWidth}
            label={goalLabel}
          />
        )}

        {/* Castle towers */}
        {data.map((d, i) => {
          const status = d.status ?? 'ok';
          const barH = computedMax > 0 ? Math.max(0, (d.value / computedMax) * chartHeight) : 0;
          const tx = barSpacing * i + (barSpacing - barWidth) / 2;
          const ty = chartBottom - barH;
          const gradientRef = `url(#${uid}-stone${status === 'ok' ? 'Gold' : status === 'under' ? 'Green' : 'Red'})`;
          const flagColor = STATUS_COLORS[status].flag;
          const isTallest = i === tallestIdx;
          const merlonW = 7;
          const merlonH = 8;
          const merlonCount = Math.max(2, Math.floor(barWidth / 10));
          const merlonGap = (barWidth + 4) / (merlonCount + 1);

          return (
            <g key={i} className="castle-bar">
              {/* Shadow ellipse */}
              <ellipse
                cx={tx + barWidth / 2}
                cy={chartBottom + 3}
                rx={barWidth / 2 + 2}
                ry="3"
                fill="rgba(44,24,16,0.3)"
              />

              {/* Base plinth */}
              <rect
                x={tx - 3}
                y={ty + 4}
                width={barWidth + 6}
                height="6"
                fill="#3B2314"
                stroke="#1a0d05"
                strokeWidth="0.5"
              />

              {/* Tower body */}
              <rect
                x={tx}
                y={ty + 8}
                width={barWidth}
                height={Math.max(0, chartBottom - (ty + 8))}
                fill={gradientRef}
                stroke="#3B2314"
                strokeWidth="0.8"
              />

              {/* Stone courses (horizontal lines) */}
              {Array.from({ length: Math.floor(barH / 10) }).map((_, k) => (
                <line
                  key={`h-${k}`}
                  x1={tx}
                  y1={ty + 18 + k * 10}
                  x2={tx + barWidth}
                  y2={ty + 18 + k * 10}
                  stroke="rgba(44,24,16,0.25)"
                  strokeWidth="0.5"
                />
              ))}

              {/* Alternating vertical stone joints */}
              {Array.from({ length: Math.max(0, Math.floor(barH / 10) - 1) }).map((_, k) => (
                <line
                  key={`v-${k}`}
                  x1={tx + (k % 2 === 0 ? barWidth / 2 : barWidth / 4)}
                  y1={ty + 18 + k * 10}
                  x2={tx + (k % 2 === 0 ? barWidth / 2 : barWidth / 4)}
                  y2={ty + 28 + k * 10}
                  stroke="rgba(44,24,16,0.22)"
                  strokeWidth="0.5"
                />
              ))}

              {/* Windows */}
              {barH > 40 && (
                <rect
                  className="castle-window"
                  x={tx + barWidth / 2 - 2}
                  y={ty + 24}
                  width="4"
                  height="7"
                  rx="1"
                />
              )}
              {barH > 70 && (
                <rect
                  className="castle-window"
                  x={tx + barWidth / 2 - 2}
                  y={ty + 45}
                  width="4"
                  height="7"
                  rx="1"
                />
              )}

              {/* Merlons (crenellations) */}
              <g className="castle-merlon">
                {Array.from({ length: merlonCount }).map((_, m) => (
                  <rect
                    key={m}
                    x={tx - 2 + merlonGap * (m + 1) - merlonW / 2}
                    y={ty}
                    width={merlonW}
                    height={merlonH}
                    fill={gradientRef}
                    stroke="#3B2314"
                    strokeWidth="0.8"
                  />
                ))}
              </g>

              {/* Flag pole + pennant (on tallest tower, or all) */}
              {isTallest && (
                <g className="castle-flag">
                  <line
                    x1={tx + barWidth / 2}
                    y1={ty - 18}
                    x2={tx + barWidth / 2}
                    y2={ty}
                    stroke="#3B2314"
                    strokeWidth="1.2"
                  />
                  <polygon
                    points={`${tx + barWidth / 2},${ty - 18} ${tx + barWidth / 2 + 14},${ty - 15} ${tx + barWidth / 2 + 11},${ty - 11} ${tx + barWidth / 2 + 14},${ty - 7} ${tx + barWidth / 2},${ty - 4}`}
                    fill={flagColor}
                  />
                </g>
              )}

              {/* Value badge — selectivo: una cifra sobre cada barra es ruido
                  que nadie lee, y con doce columnas las cajas se pisaban entre
                  sí. Cuando no entran, se rotula sólo la más alta y los dos
                  extremos; el resto lo cuenta el eje. */}
              {(showAllValues || isTallest || i === 0 || i === barCount - 1) && (() => {
                const label = formatValue(d.value);
                const badgeW = Math.max(barWidth + 4, label.length * 7 + 8);
                const badgeX = tx + barWidth / 2 - badgeW / 2;
                return (
                  <>
                    <rect
                      x={badgeX}
                      y={ty - 38}
                      width={badgeW}
                      height="14"
                      fill="rgba(44,24,16,0.85)"
                      stroke="#C9A84C"
                      rx="1"
                    />
                    <text
                      className="castle-value-label"
                      x={tx + barWidth / 2}
                      y={ty - 27}
                      textAnchor="middle"
                      fontSize="11"
                    >
                      {label}
                    </text>
                  </>
                );
              })()}

              {/* X-axis label — thinned so labels never overlap */}
              {i % labelStep === 0 && (
                <text
                  className="castle-label"
                  x={tx + barWidth / 2}
                  y={height - 2}
                  textAnchor="middle"
                  fontSize="12"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Floor line */}
        <line
          x1="0"
          y1={chartBottom}
          x2={viewBoxWidth}
          y2={chartBottom}
          stroke="#3B2314"
          strokeWidth="1.5"
        />
        <line
          x1="0"
          y1={chartBottom + 2}
          x2={viewBoxWidth}
          y2={chartBottom + 2}
          stroke="rgba(74,45,26,0.3)"
          strokeWidth="0.5"
        />
      </svg>

      {legend && (
        <div className="castle-legend">
          {legend.under && (
            <span className="castle-legend-item">
              <span className="castle-legend-swatch" style={{ background: STATUS_COLORS.under.flag }} />
              {legend.under}
            </span>
          )}
          {legend.ok && (
            <span className="castle-legend-item">
              <span className="castle-legend-swatch" style={{ background: STATUS_COLORS.ok.start }} />
              {legend.ok}
            </span>
          )}
          {legend.over && (
            <span className="castle-legend-item">
              <span className="castle-legend-swatch" style={{ background: STATUS_COLORS.over.flag }} />
              {legend.over}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Goal banner sub-component ─── */
const GoalBanner: React.FC<{
  uid: string;
  y: number;
  width: number;
  label?: string;
}> = ({ y, width, label }) => (
  <g>
    <line
      className="castle-goal-line"
      x1="0"
      y1={y}
      x2={width}
      y2={y}
    />
    {/* Left pennant */}
    <polygon
      points={`0,${y - 6} 0,${y + 6} 6,${y}`}
      fill="#8B2020"
    />
    {label && (
      <>
        {/* Banner ribbon for label */}
        <rect
          x={width - 65}
          y={y - 14}
          width="62"
          height="14"
          fill="#8B2020"
          stroke="#3B2314"
        />
        <polygon
          points={`${width - 65},${y - 14} ${width - 72},${y - 7} ${width - 65},${y}`}
          fill="#8B2020"
          stroke="#3B2314"
        />
        <polygon
          points={`${width - 3},${y - 14} ${width + 4},${y - 7} ${width - 3},${y}`}
          fill="#8B2020"
          stroke="#3B2314"
        />
        <text
          x={width - 34}
          y={y - 3}
          textAnchor="middle"
          fontFamily="IM Fell English SC"
          fontSize="11"
          fontWeight="700"
          fill="#fff6df"
          letterSpacing="1"
        >
          {label}
        </text>
      </>
    )}
  </g>
);

/* ── Simple legend (non-themed) ─── */
const SimpleLegend: React.FC<{ legend: { ok?: string; under?: string; over?: string } }> = ({
  legend,
}) => (
  <div className="castle-legend">
    {legend.under && (
      <span className="castle-legend-item">
        <span
          className="castle-legend-swatch"
          style={{ background: STATUS_COLORS.under.solid, clipPath: 'none', borderRadius: 2 }}
        />
        {legend.under}
      </span>
    )}
    {legend.ok && (
      <span className="castle-legend-item">
        <span
          className="castle-legend-swatch"
          style={{ background: STATUS_COLORS.ok.solid, clipPath: 'none', borderRadius: 2 }}
        />
        {legend.ok}
      </span>
    )}
    {legend.over && (
      <span className="castle-legend-item">
        <span
          className="castle-legend-swatch"
          style={{ background: STATUS_COLORS.over.solid, clipPath: 'none', borderRadius: 2 }}
        />
        {legend.over}
      </span>
    )}
  </div>
);
