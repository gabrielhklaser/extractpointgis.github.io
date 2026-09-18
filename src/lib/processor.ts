import { PALEOZONAS } from "./paleozonas";
import type { BBox, ClassStat, Dataset, GridOptions, GridPoint, GridResult, Ring, SimplePolygon } from "./types";

/** Limite de candidatos para manter a UI fluida (~ alguns milhões). */
export const MAX_CANDIDATES = 6_000_000;

const EPS = 1e-9;

/** Arredonda ruído de ponto flutuante proveniente dos múltiplos do passo. */
function snap(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}

/** Ray casting: ponto dentro de anel? Inclui teste de borda com tolerância. */
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    // Teste de pertencimento à borda (evita perder pontos sobre o limite)
    const cross = (xj - xi) * (lat - yi) - (yj - yi) * (lon - xi);
    if (Math.abs(cross) < EPS) {
      const within =
        lon >= Math.min(xi, xj) - EPS && lon <= Math.max(xi, xj) + EPS &&
        lat >= Math.min(yi, yj) - EPS && lat <= Math.max(yi, yj) + EPS;
      if (within) return true;
    }
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ponto dentro de polígono simples (anel externo, desconsiderando furos). */
function pointInPolygon(lon: number, lat: number, poly: SimplePolygon): boolean {
  if (!pointInRing(lon, lat, poly.shell)) return false;
  for (const hole of poly.holes) {
    if (pointInRing(lon, lat, hole)) return false;
  }
  return true;
}

/** Ponto dentro da feature (qualquer um de seus polígonos)? */
function pointInFeature(lon: number, lat: number, feature: Dataset["features"][number]): boolean {
  const [minX, minY, maxX, maxY] = feature.bbox;
  if (lon < minX || lon > maxX || lat < minY || lat > maxY) return false;
  for (const poly of feature.polygons) {
    if (pointInPolygon(lon, lat, poly)) return true;
  }
  return false;
}

interface SpatialIndex {
  cellSize: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  cells: Int32Array;   // índice de início
  counts: Int32Array;  // quantidade
  items: Int32Array;   // índices de features achatados
  global: number[];    // features com bbox muito extenso (testadas sempre)
}

/**
 * Índice espacial do tipo "grid uniforme" sobre os bounding boxes das features.
 * Complexidade esperada do ponto-em-polígono: O(1) amortizado por ponto.
 */
function buildIndex(features: Dataset["features"], bbox: BBox, step: number): SpatialIndex {
  const spanX = Math.max(bbox.maxX - bbox.minX, 1e-6);
  const spanY = Math.max(bbox.maxY - bbox.minY, 1e-6);
  const target = Math.max(8, Math.min(256, Math.round(Math.sqrt(features.length) * 4)));
  const cellSize = Math.max(step, spanX / target, spanY / target);
  const cols = Math.ceil(spanX / cellSize) + 1;
  const rows = Math.ceil(spanY / cellSize) + 1;
  const size = cols * rows;

  const buckets: number[][] = Array.from({ length: size }, () => []);
  const global: number[] = [];

  features.forEach((f, i) => {
    const [fx0, fy0, fx1, fy1] = f.bbox;
    const c0 = Math.max(0, Math.floor((fx0 - bbox.minX) / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((fx1 - bbox.minX) / cellSize));
    const r0 = Math.max(0, Math.floor((fy0 - bbox.minY) / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((fy1 - bbox.minY) / cellSize));
    // Um feature que cobre muitas células inteiras vai para a lista global
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > size * 0.35) {
      global.push(i);
      return;
    }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(i);
    }
  });

  const cells = new Int32Array(size);
  const counts = new Int32Array(size);
  let total = 0;
  for (let i = 0; i < size; i++) {
    cells[i] = total;
    counts[i] = buckets[i].length;
    total += buckets[i].length;
  }
  const items = new Int32Array(total);
  let ptr = 0;
  for (let i = 0; i < size; i++) {
    for (const f of buckets[i]) items[ptr++] = f;
  }

  return { cellSize, originX: bbox.minX, originY: bbox.minY, cols, rows, cells, counts, items, global: Array.from(new Set(global)) };
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface ProcessCallbacks {
  onProgress?: (percent: number, stage: string) => void;
  shouldCancel?: () => boolean;
}

/**
 * Varredura do bounding box + interseção espacial (point in polygon).
 * Processa em lotes assíncronos com índice espacial para não travar o navegador.
 */
export async function processGrid(
  dataset: Dataset,
  options: GridOptions,
  callbacks: ProcessCallbacks = {},
): Promise<GridResult> {
  const started = performance.now();
  const step = options.step;
  if (!isFinite(step) || step <= 0) throw new Error("O passo da malha deve ser um número maior que zero.");
  if (step > 180) throw new Error("O passo da malha não pode exceder 180°.");

  const { bbox, features } = dataset;

  // Número de vértices da malha (alinhados a múltiplos do passo)
  const startX = options.anchor === "bbox" ? bbox.minX : Math.ceil(snap(bbox.minX / step - 1e-9)) * step;
  const startY = options.anchor === "bbox" ? bbox.minY : Math.ceil(snap(bbox.minY / step - 1e-9)) * step;
  const nx = Math.floor(snap((bbox.maxX - startX) / step + 1e-9)) + 1;
  const ny = Math.floor(snap((bbox.maxY - startY) / step + 1e-9)) + 1;
  const candidates = nx * ny;
  if (candidates > MAX_CANDIDATES) {
    throw new Error(
      `Malha muito densa: ${candidates.toLocaleString("pt-BR")} pontos candidatos ` +
        `(${nx} × ${ny}). Aumente o passo ou reduza a extensão dos dados.`,
    );
  }

  callbacks.onProgress?.(2, `Índice espacial para ${features.length} feature(s)...`);
  await yieldToUi();
  const index = buildIndex(features, bbox, step);

  const points: GridPoint[] = [];
  let inside = 0;
  let outside = 0;
  const offset = options.useCentroid ? step / 2 : 0;
  const keepOutside = options.keepOutside;

  const rowsPerChunk = Math.max(1, Math.min(ny, Math.ceil(40_000 / Math.max(nx, 1))));
  let processed = 0;

  for (let row = 0; row < ny; row++) {
    const lat = snap(startY + row * step + offset);
    for (let col = 0; col < nx; col++) {
      const lon = snap(startX + col * step + offset);

      // Consulta espacial: apenas features cujo bbox cobre a célula
      const c = Math.min(index.cols - 1, Math.max(0, Math.floor((lon - index.originX) / index.cellSize)));
      const r = Math.min(index.rows - 1, Math.max(0, Math.floor((lat - index.originY) / index.cellSize)));
      const cell = r * index.cols + c;
      const start = index.cells[cell];
      const count = index.counts[cell];

      let hit: GridPoint | null = null;
      for (let k = 0; k < count; k++) {
        const fi = index.items[start + k];
        const f = features[fi];
        if (pointInFeature(lon, lat, f)) {
          hit = { lon, lat, classe: f.classe, classeLabel: f.classeLabel, featureIndex: fi };
          break;
        }
      }
      if (!hit && index.global.length) {
        for (const fi of index.global) {
          if (pointInFeature(lon, lat, features[fi])) {
            hit = { lon, lat, classe: features[fi].classe, classeLabel: features[fi].classeLabel, featureIndex: fi };
            break;
          }
        }
      }

      if (hit) {
        points.push(hit);
        inside++;
      } else if (keepOutside) {
        points.push({ lon, lat, classe: null, classeLabel: "fora", featureIndex: null });
        outside++;
      } else {
        outside++;
      }
    }

    processed += nx;
    if (row % rowsPerChunk === 0 || row === ny - 1) {
      callbacks.onProgress?.(5 + Math.round((processed / candidates) * 95), `Varrendo linha ${row + 1}/${ny}...`);
      await yieldToUi();
      if (callbacks.shouldCancel?.()) {
        throw new Error("Processamento cancelado pelo usuário.");
      }
    }
  }

  return {
    points,
    inside,
    outside,
    candidates,
    elapsedMs: performance.now() - started,
    truncated: false,
  };
}

/**
 * Estatísticas por paleozona (humid, dry, semi-arid) a partir dos pontos classificados.
 * Sempre na ordem canônica de código; classes fora do domínio aparecem ao final.
 */
export function computeClassStats(dataset: Dataset, points: GridPoint[]): ClassStat[] {
  const map = new Map<number, ClassStat>();
  const meta = new Map<number, { label: string; known: boolean }>();
  for (const f of dataset.features) {
    if (!meta.has(f.classe)) meta.set(f.classe, { label: f.classeLabel, known: f.classeKnown });
  }
  for (const [code, m] of meta) {
    map.set(code, { classe: code, label: m.label, known: m.known, points: 0, features: 0, areaKm2: 0 });
  }
  for (const f of dataset.features) {
    const cur = map.get(f.classe);
    if (!cur) continue;
    cur.features++;
    cur.areaKm2 += f.areaKm2;
  }
  for (const p of points) {
    if (p.classe === null) continue;
    const cur = map.get(p.classe);
    if (cur) cur.points++;
  }
  const knownCodes = PALEOZONAS.map((p) => p.code);
  return Array.from(map.values()).sort((a, b) => {
    const ia = knownCodes.indexOf(a.classe);
    const ib = knownCodes.indexOf(b.classe);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.classe - b.classe;
  });
}

export { classColor } from "./paleozonas";
