/**
 * Tipos compartilhados do pipeline SIG.
 */

export type CrsStatus = "ok" | "reprojected" | "assumed" | "error";

export interface CrsReport {
  status: CrsStatus;
  /** CRS declarado no arquivo (bruto, como encontrado no membro "crs") */
  declared: string | null;
  /** CRS normalizado (ex.: "EPSG:4326") */
  source: string | null;
  target: string;
  message: string;
  details: string[];
  /** True quando houve necessidade de trocar eixo (lat,lon) -> (lon,lat) */
  swappedAxis: boolean;
}

/** Anel: lista fechada de coordenadas [lon, lat] */
export type Ring = number[][];

/** Polígono simples = anel externo + furos */
export interface SimplePolygon {
  shell: Ring;
  holes: Ring[];
}

/** Feature simplificada e já reprojetada para EPSG:4326 */
export interface VectorFeature {
  id: string;
  index: number;
  /** Código numérico interno da paleozona (humid=1, dry=2, semi-arid=3) */
  classe: number;
  /** Rótulo original da coluna "paleozonas" (ex.: "humid") */
  classeLabel: string;
  /** False quando o valor veio fora do domínio {humid, dry, semi-arid} */
  classeKnown: boolean;
  polygons: SimplePolygon[];
  bbox: [number, number, number, number]; // minX, minY, maxX, maxY
  areaKm2: number;
  properties: Record<string, unknown>;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GridOptions {
  /** Passo da malha em graus decimais (padrão 5) */
  step: number;
  /** Origem da malha: múltiplos absolutos do passo ou canto do bounding box */
  anchor: "origin" | "bbox";
  /** Manter pontos fora dos polígonos (marcados como classe nula) */
  keepOutside: boolean;
  /** Usar centro da célula em vez do vértice da malha */
  useCentroid: boolean;
}

export interface GridPoint {
  lon: number;
  lat: number;
  classe: number | null;
  classeLabel: string;
  featureIndex: number | null;
}

export interface GridResult {
  points: GridPoint[];
  inside: number;
  outside: number;
  candidates: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface ClassStat {
  /** Código interno da paleozona */
  classe: number;
  /** Rótulo da paleozona: humid | dry | semi-arid */
  label: string;
  /** False para valores fora do domínio esperado */
  known: boolean;
  points: number;
  features: number;
  areaKm2: number;
}

export interface LogEntry {
  level: "info" | "success" | "warn" | "error";
  time: string;
  message: string;
}

export interface Dataset {
  fileName: string;
  featureCount: number;
  features: VectorFeature[];
  bbox: BBox;
  rawCrsMember: unknown;
  coordRange: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  crs: CrsReport;
  unmappedLabels: string[];
  warnings: string[];
  rawCoords: number; // nº de vértices lidos (diagnóstico de performance)
}
