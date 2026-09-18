import { useEffect, useMemo, useRef, useState } from "react";
import { classColor } from "@/lib/processor";
import { displayLabel, paleozonaMeta } from "@/lib/paleozonas";
import type { BBox, GridPoint, VectorFeature } from "@/lib/types";
import { Badge, Icons } from "./ui";
import { cn } from "@/utils/cn";

const BASE_W = 1000;

interface Props {
  features: VectorFeature[];
  points: GridPoint[];
  bbox: BBox | null;
  step: number;
  classList: number[];
  empty?: boolean;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** Passo "bonito" para o graticulo, evitando desenhar centenas de linhas. */
function niceStep(target: number): number {
  const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90];
  return steps.find((s) => s >= target) ?? 90;
}

export default function MapView({ features, points, bbox, step, classList, empty }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const [layers, setLayers] = useState({ grid: true, points: true, polys: true, labels: true });

  const span = useMemo<BBox>(() => {
    if (!bbox) return { minX: -80, minY: -60, maxX: 80, maxY: 60 };
    const padX = Math.max((bbox.maxX - bbox.minX) * 0.04, step * 0.5, 0.25);
    const padY = Math.max((bbox.maxY - bbox.minY) * 0.04, step * 0.5, 0.25);
    return { minX: bbox.minX - padX, minY: bbox.minY - padY, maxX: bbox.maxX + padX, maxY: bbox.maxY + padY };
  }, [bbox, step]);

  const geo = useMemo(() => {
    const lonSpan = Math.max(span.maxX - span.minX, 1e-6);
    const latSpan = Math.max(span.maxY - span.minY, 1e-6);
    const latMid = (span.minY + span.maxY) / 2;
    const kx = Math.max(Math.cos((latMid * Math.PI) / 180), 0.15);
    const projLon = (lon: number) => ((lon - span.minX) / lonSpan) * BASE_W * kx;
    const projLat = (lat: number) => BASE_W * kx * (latSpan / lonSpan) * (1 - (lat - span.minY) / latSpan);
    const baseH = BASE_W * kx * (latSpan / lonSpan);
    return { projLon, projLat, baseH, kx, lonSpan, latSpan };
  }, [span]);

  // Redimensiona o SVG conforme o container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const vb = useMemo(() => {
    const aspect = size.w / Math.max(size.h, 1);
    const baseAspect = BASE_W / Math.max(geo.baseH, 1);
    let vw = BASE_W;
    let vh = geo.baseH;
    if (baseAspect > aspect) vh = BASE_W / aspect;
    else vw = geo.baseH * aspect;
    const cx = BASE_W / 2;
    const cy = geo.baseH / 2;
    return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
  }, [size, geo]);

  const paths = useMemo(
    () =>
      features.map((f) => {
        const d =
          f.polygons
            .map((poly) => {
              const ring = (r: number[][]) =>
                r
                  .map((c, i) => `${i === 0 ? "M" : "L"}${geo.projLon(c[0]).toFixed(2)},${geo.projLat(c[1]).toFixed(2)}`)
                  .join(" ") + " Z";
              return [ring(poly.shell), ...poly.holes.map(ring)].join(" ");
            })
            .join(" ");
        return { id: f.id, d, classe: f.classe, label: f.classeLabel, bbox: f.bbox };
      }),
    [features, geo],
  );

  const graticule = useMemo(() => {
    const target = (span.maxX - span.minX) / 14;
    const gs = Math.max(niceStep(target), Math.min(step, niceStep(target)));
    const lines: { x1: number; y1: number; x2: number; y2: number; label: string; vertical: boolean; value: number }[] = [];
    const startLon = Math.ceil(span.minX / gs) * gs;
    for (let v = startLon; v <= span.maxX + 1e-9; v += gs) {
      const x = geo.projLon(v);
      lines.push({ x1: x, y1: 0, x2: x, y2: geo.baseH, label: `${v.toFixed(2)}°`, vertical: true, value: v });
    }
    const startLat = Math.ceil(span.minY / gs) * gs;
    for (let v = startLat; v <= span.maxY + 1e-9; v += gs) {
      const y = geo.projLat(v);
      lines.push({ x1: 0, y1: y, x2: BASE_W, y2: y, label: `${v.toFixed(2)}°`, vertical: false, value: v });
    }
    return lines;
  }, [span, geo, step]);

  const bboxRect = useMemo(() => {
    if (!bbox) return null;
    return {
      x: geo.projLon(bbox.minX),
      y: geo.projLat(bbox.maxY),
      w: geo.projLon(bbox.maxX) - geo.projLon(bbox.minX),
      h: geo.projLat(bbox.minY) - geo.projLat(bbox.maxY),
    };
  }, [bbox, geo]);

  // Zoom com roda do mouse (listener nativo não-passivo: precisamos de preventDefault)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x;
      const sy = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const scale = Math.max(0.5, Math.min(400, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [vb]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const kx = vb.w / rect.width;
    const ky = vb.h / rect.height;
    setView((v) => ({ ...v, tx: drag.tx + (e.clientX - drag.x) * kx, ty: drag.ty + (e.clientY - drag.y) * ky }));
  };
  const onPointerUp = () => setDrag(null);

  const reset = () => setView({ scale: 1, tx: 0, ty: 0 });

  const layerBtn = (key: keyof typeof layers, label: string) => (
    <button
      key={key}
      onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
      className={cn(
        "rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
        layers[key] ? "bg-cyan-400/15 text-cyan-200 ring-1 ring-inset ring-cyan-400/30" : "bg-white/5 text-slate-500",
      )}
    >
      {label}
    </button>
  );

  const maxDots = 12000;
  const shown = points.length > maxDots ? points.slice(0, maxDots) : points;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070d1b]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-900/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Visualização espacial</span>
          <Badge tone="info">{step}° de passo</Badge>
          {points.length > maxDots && <Badge tone="warn">exibindo {maxDots} de {points.length} pts</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {layerBtn("polys", "Polígonos")}
          {layerBtn("grid", "Graticulo")}
          {layerBtn("points", "Pontos")}
          {layerBtn("labels", "Rótulos")}
          <button
            onClick={reset}
            title="Redefinir zoom"
            className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
          >
            <span className="flex items-center gap-1">{Icons.reset} Reset</span>
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative h-[420px] w-full select-none sm:h-[520px]">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          className={cn("touch-none", drag ? "cursor-grabbing" : "cursor-grab")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setDrag(null);
            setHover(null);
          }}
        >
          <defs>
            <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="#1e293b" />
            </pattern>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#070d1b" />
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#dots)" />

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {layers.grid &&
              graticule.map((l, i) => (
                <g key={i}>
                  <line
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                    stroke="#1e3a5f"
                    strokeWidth={0.6 / view.scale}
                    vectorEffect="non-scaling-stroke"
                  />
                  {layers.labels && (
                    <text
                      x={l.vertical ? l.x1 + 3 : l.x1 + 4}
                      y={l.vertical ? l.y1 + 11 : l.y1 - 3}
                      fill="#3f6a94"
                      fontSize={9}
                      fontFamily="ui-monospace, monospace"
                    >
                      {l.label}
                    </text>
                  )}
                </g>
              ))}

            {bboxRect && (
              <rect
                x={bboxRect.x}
                y={bboxRect.y}
                width={bboxRect.w}
                height={bboxRect.h}
                fill="none"
                stroke="#f59e0b"
                strokeDasharray="6 4"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                opacity={0.7}
              />
            )}

            {layers.polys &&
              paths.map((p) => (
                <path
                  key={p.id}
                  d={p.d}
                  fill={classColor(p.classe)}
                  fillOpacity={0.22}
                  stroke={classColor(p.classe)}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                  onMouseEnter={(e) =>
                    setHover({
                      x: e.clientX,
                      y: e.clientY,
                      title: `Classe ${p.classe}${p.label !== String(p.classe) ? ` · ${p.label}` : ""}`,
                      lines: [
                        `bbox: ${p.bbox.map((v) => v.toFixed(2)).join(", ")}`,
                        `${features.length} feição(ões) carregadas`,
                      ],
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                />
              ))}

            {layers.points &&
              shown.map((p, i) => {
                const cx = geo.projLon(p.lon);
                const cy = geo.projLat(p.lat);
                const r = 3.4 / view.scale;
                if (p.classe === null) {
                  return <circle key={`o${i}`} cx={cx} cy={cy} r={r * 0.8} fill="#64748b" fillOpacity={0.55} />;
                }
                return (
                  <g key={`i${i}`}>
                    <circle cx={cx} cy={cy} r={r * 2.2} fill="url(#glow)" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={classColor(p.classe)}
                      stroke="#020617"
                      strokeWidth={0.8 / view.scale}
                      onMouseEnter={(e) =>
                        setHover({
                          x: e.clientX,
                          y: e.clientY,
                          title: `Ponto · paleozona ${displayLabel(p.classe, p.classeLabel)}`,
                          lines: [`Latitude: ${p.lat.toFixed(4)}°`, `Longitude: ${p.lon.toFixed(4)}°`],
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  </g>
                );
              })}
          </g>
        </svg>

        {/* Legenda */}
        {classList.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 backdrop-blur">
            {classList.map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(c) }} />
                {paleozonaMeta(c).label}
              </span>
            ))}
          </div>
        )}

        {empty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 text-center backdrop-blur-sm">
            <div className="h-10 w-10 text-cyan-400/70">{Icons.globe}</div>
            <p className="max-w-xs text-sm text-slate-400">
              Carregue um GeoJSON para visualizar os polígonos, o bounding box e a malha de varredura.
            </p>
          </div>
        )}

        {hover && (
          <div
            className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-white/15 bg-slate-950/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="font-semibold text-slate-100">{hover.title}</div>
            {hover.lines.map((l, i) => (
              <div key={i} className="font-mono text-[10px] text-slate-400">
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
