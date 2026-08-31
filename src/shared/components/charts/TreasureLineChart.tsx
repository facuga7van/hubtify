import React, { useId, useMemo } from 'react';
import './charts.css';

export interface PointDatum {
  x: number;
  y: number;
  label?: string;
}

export interface TreasureLineChartProps {
  data: PointDatum[];
  goalLine?: number;
  height?: number;
  xLabels?: string[];
  themed?: boolean;
  showArea?: boolean;
  todayIndex?: number;
}

export const TreasureLineChart: React.FC<TreasureLineChartProps> = ({
  data,
  goalLine,
  height = 180,
  xLabels,
  themed = true,
  showArea = true,
  todayIndex,
}) => {
  const uid = useId();
  const stippleId = `${uid}-stipple`;
  const areaGradientId = `${uid}-areaGrad`;

  // Was 460 while the host card is ~286px wide: everything, text included,
  // was scaled by 0.62 on top of its own size (fontSize 7 -> 4.3px).
  // Decorative coordinates below were rescaled by the same factor.
  const viewBoxWidth = 300;
  const padding = { top: 20, right: 20, bottom: 25, left: 30 };
  const chartW = viewBoxWidth - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Auto-scale: compute domain from data + goalLine
  const { minY, maxY, scaledPoints } = useMemo(() => {
    if (data.length === 0)
      return { minY: 0, maxY: 100, scaledPoints: [] };

    const yVals = data.map((d) => d.y);
    if (goalLine != null) yVals.push(goalLine);

    let mn = Math.min(...yVals);
    let mx = Math.max(...yVals);
    const range = mx - mn || 1;
    mn -= range * 0.1;
    mx += range * 0.1;

    const xVals = data.map((d) => d.x);
    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const xRange = xMax - xMin || 1;

    const pts = data.map((d) => ({
      sx: padding.left + ((d.x - xMin) / xRange) * chartW,
      sy: padding.top + ((mx - d.y) / (mx - mn)) * chartH,
      orig: d,
    }));

    return { minY: mn, maxY: mx, scaledPoints: pts };
  }, [data, goalLine, chartW, chartH, padding.left, padding.top]);

  const linePath = useMemo(
    () =>
      scaledPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx},${p.sy}`)
        .join(' '),
    [scaledPoints]
  );

  const areaPath = useMemo(() => {
    if (scaledPoints.length < 2) return '';
    const last = scaledPoints[scaledPoints.length - 1];
    const first = scaledPoints[0];
    const bottom = padding.top + chartH;
    return `${linePath} L${last.sx},${bottom} L${first.sx},${bottom} Z`;
  }, [linePath, scaledPoints, padding.top, chartH]);

  const goalY = useMemo(() => {
    if (goalLine == null) return null;
    const range = maxY - minY || 1;
    return padding.top + ((maxY - goalLine) / range) * chartH;
  }, [goalLine, minY, maxY, padding.top, chartH]);

  const todayPoint =
    todayIndex != null && todayIndex >= 0 && todayIndex < scaledPoints.length
      ? scaledPoints[todayIndex]
      : null;

  // At 30 points the x labels overlap into a smear; show one every `labelStep`.
  const labelStep = useMemo(() => {
    if (!xLabels || xLabels.length < 2) return 1;
    const longest = xLabels.reduce((m, l) => Math.max(m, l.length), 1);
    const needed = longest * 6 + 6;             // approx. label width, viewBox units
    const spacing = chartW / (xLabels.length - 1);
    return Math.max(1, Math.ceil(needed / Math.max(1, spacing)));
  }, [xLabels, chartW]);

  if (!themed) {
    return (
      <div className="treasure-chart treasure-chart--simple chart-container">
        <svg
          className="treasure-chart-svg"
          viewBox={`0 0 ${viewBoxWidth} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Goal line */}
          {goalY != null && (
            <line
              x1={padding.left}
              y1={goalY}
              x2={viewBoxWidth - padding.right}
              y2={goalY}
              stroke="#2D5A27"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          )}

          {/* Area fill */}
          {showArea && areaPath && (
            <>
              <defs>
                <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(224,192,104,0.4)" />
                  <stop offset="100%" stopColor="rgba(224,192,104,0.05)" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${areaGradientId})`} className="treasure-area" />
            </>
          )}

          {/* Line */}
          {linePath && (
            <path d={linePath} className="treasure-line" />
          )}

          {/* Data points */}
          {scaledPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.sx}
              cy={p.sy}
              r="3"
              fill="#E0C068"
              stroke="#3B2314"
              strokeWidth="1"
            />
          ))}

          {/* Today marker */}
          {todayPoint && (
            <g>
              <circle
                cx={todayPoint.sx}
                cy={todayPoint.sy}
                r="5"
                fill="#8B2020"
                stroke="#3B2314"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* X labels */}
          {xLabels &&
            xLabels.map((lbl, i) => {
              const xPos =
                scaledPoints.length > 0 && i < scaledPoints.length
                  ? scaledPoints[i].sx
                  : padding.left + (i / Math.max(1, (xLabels?.length ?? 1) - 1)) * chartW;
              if (i % labelStep !== 0 && i !== xLabels.length - 1) return null;
              return (
                <text
                  key={i}
                  x={xPos}
                  y={height - 4}
                  textAnchor="middle"
                  className="treasure-x-label"
                >
                  {lbl}
                </text>
              );
            })}
        </svg>
      </div>
    );
  }

  // ── Themed: Treasure map style ──
  return (
    <div className="treasure-chart treasure-chart--themed chart-container">
      <div className="treasure-chart-wrap">
        {/* Burnt corner overlays */}
        <span className="treasure-corner treasure-corner--tl" />
        <span className="treasure-corner treasure-corner--tr" />
        <span className="treasure-corner treasure-corner--bl" />
        <span className="treasure-corner treasure-corner--br" />

        <svg
          className="treasure-chart-svg"
          viewBox={`0 0 ${viewBoxWidth} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Stipple pattern for parchment texture */}
            <pattern
              id={stippleId}
              x="0"
              y="0"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="3" r="0.5" fill="rgba(74,45,26,0.2)" />
              <circle cx="7" cy="8" r="0.4" fill="rgba(74,45,26,0.15)" />
            </pattern>

            {/* Area gradient */}
            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(166,138,62,0.45)" />
              <stop offset="100%" stopColor="rgba(166,138,62,0.05)" />
            </linearGradient>
          </defs>

          {/* Parchment stipple background */}
          <rect width={viewBoxWidth} height={height} fill={`url(#${stippleId})`} />

          {/* Compass rose — top-left corner */}
          <g className="treasure-compass" transform="translate(26,28)">
            <circle r="14" fill="none" stroke="#6B3A2A" strokeWidth="0.8" />
            <circle r="7" fill="none" stroke="#6B3A2A" strokeWidth="0.6" />
            <polygon
              points="0,-13 2,0 0,13 -2,0"
              fill="#8B2020"
              stroke="#3B2314"
              strokeWidth="0.5"
            />
            <polygon
              points="-13,0 0,2 13,0 0,-2"
              fill="#3B2314"
              stroke="#3B2314"
              strokeWidth="0.5"
            />
            <text
              y="-17"
              textAnchor="middle"
              fontFamily="IM Fell English SC"
              fontSize="10"
              fill="#3B2314"
              fontWeight="700"
            >
              N
            </text>
          </g>

          {/* Decorative mountains in background */}
          <g opacity="0.5">
            <polygon
              points="52,150 68,120 85,150"
              fill="none"
              stroke="#6B3A2A"
              strokeWidth="0.8"
            />
            <polygon
              points="62,150 75,130 88,150"
              fill="none"
              stroke="#6B3A2A"
              strokeWidth="0.6"
            />
            <polygon
              points="170,145 183,115 196,145"
              fill="none"
              stroke="#6B3A2A"
              strokeWidth="0.7"
            />
          </g>

          {/* Goal line — river style */}
          {goalY != null && (
            <g>
              <line
                className="treasure-goal-line"
                x1={padding.left}
                y1={goalY}
                x2={viewBoxWidth - padding.right}
                y2={goalY}
              />
            </g>
          )}

          {/* Area fill */}
          {showArea && areaPath && (
            <path d={areaPath} fill={`url(#${areaGradientId})`} />
          )}

          {/* Line path — dashed trail */}
          {linePath && (
            <path d={linePath} className="treasure-line" />
          )}

          {/* Data points — X marks */}
          {scaledPoints.map((p, i) => {
            const isToday = todayIndex != null && i === todayIndex;
            return (
              <g key={i} className="treasure-marker">
                {/* X cross */}
                <g transform={`translate(${p.sx},${p.sy})`}>
                  <line x1="-4" y1="-4" x2="4" y2="4" stroke="#3B2314" strokeWidth="1.5" />
                  <line x1="-4" y1="4" x2="4" y2="-4" stroke="#3B2314" strokeWidth="1.5" />
                  <circle r="2.5" fill="#E0C068" stroke="#3B2314" strokeWidth="1" />
                </g>

                {/* Today flag */}
                {isToday && (
                  <g className="treasure-flag">
                    <line
                      x1={p.sx}
                      y1={p.sy}
                      x2={p.sx}
                      y2={p.sy - 26}
                      stroke="#3B2314"
                      strokeWidth="1.2"
                    />
                    <polygon
                      points={`${p.sx},${p.sy - 26} ${p.sx + 20},${p.sy - 22} ${p.sx + 17},${p.sy - 18} ${p.sx + 20},${p.sy - 14} ${p.sx},${p.sy - 10}`}
                      fill="#8B2020"
                      stroke="#3B2314"
                      strokeWidth="0.8"
                    />
                    <text
                      x={p.sx + 10}
                      y={p.sy - 18}
                      textAnchor="middle"
                      fontFamily="IM Fell English SC"
                      fontSize="9"
                      fontWeight="700"
                      fill="#fff6df"
                      letterSpacing="0.5"
                    >
                      HOY
                    </text>
                  </g>
                )}

                {/* Label for today point */}
                {isToday && p.orig.label && (
                  <g>
                    <rect
                      x={p.sx - 28}
                      y={p.sy + 6}
                      width="50"
                      height="14"
                      fill="#4A2D1A"
                      stroke="#C9A84C"
                      rx="1"
                    />
                    <text
                      x={p.sx - 3}
                      y={p.sy + 16}
                      textAnchor="middle"
                      fontFamily="Fira Code"
                      fontSize="11"
                      fontWeight="700"
                      fill="#e0c068"
                    >
                      {p.orig.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* X-axis labels */}
          {xLabels &&
            xLabels.map((lbl, i) => {
              const xPos =
                scaledPoints.length > 0 && i < scaledPoints.length
                  ? scaledPoints[i].sx
                  : padding.left + (i / Math.max(1, (xLabels?.length ?? 1) - 1)) * chartW;
              if (i % labelStep !== 0 && i !== xLabels.length - 1) return null;
              return (
                <text
                  key={i}
                  x={xPos}
                  y={height - 4}
                  textAnchor="middle"
                  className="treasure-x-label"
                >
                  {lbl}
                </text>
              );
            })}
        </svg>
      </div>
    </div>
  );
};
