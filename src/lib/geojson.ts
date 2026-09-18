import { needsAxisSwap, reprojectPoint, validateCrs } from "./crs";
import { PALEOZONA_BY_CODE, PALEOZONA_COLUMN_CANDIDATES, PALEOZONAS, resolvePaleozona } from "./paleozonas";
import type { BBox, Dataset, Ring, SimplePolygon, VectorFeature } from "./types";

/** Limite de segurança de vértices para não travar o navegador. */
export const MAX_VERTICES = 600_000;

export interface ParsedGeoJson {
  features: any[];
  crsMember: unknown;
  name: string | null;
}

/** Faz o parse do texto e normaliza FeatureCollection / Feature / geometria solta. */
export function parseGeoJsonText(text: string): ParsedGeoJson {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error("Arquivo não é um JSON válido. Verifique a sintaxe (vírgulas, chaves, aspas).");
  }
  if (Array.isArray(json)) return { features: json, crsMember: null, name: null };

  if (json.type === "FeatureCollection") {
    return { features: json.features ?? [], crsMember: json.crs ?? null, name: json.name ?? null };
  }
  if (json.type === "Feature") return { features: [json], crsMember: json.crs ?? null, name: null };
  if (json.type && /geometry|polygon/i.test(String(json.type))) {
    return { features: [{ type: "Feature", properties: {}, geometry: json }], crsMember: json.crs ?? null, name: null };
  }
  throw new Error(`Tipo GeoJSON não suportado: "${json.type ?? "desconhecido"}".`);
}

/** Achata GeometryCollection / MultiPolygon em polígonos simples (anel externo + furos). */
function collectPolygons(geometry: any, out: SimplePolygon[], counter: { n: number }): void {
  if (!geometry) return;
  const type = String(geometry.type);
  switch (type) {
    case "Polygon": {
      const rings: Ring[] = (geometry.coordinates ?? []).filter((r: any) => Array.isArray(r) && r.length > 2);
      if (rings.length) {
        out.push({ shell: rings[0], holes: rings.slice(1) });
        counter.n += rings.reduce((acc, r) => acc + r.length, 0);
      }
      break;
    }
    case "MultiPolygon": {
      for (const poly of geometry.coordinates ?? []) {
        const rings: Ring[] = (poly ?? []).filter((r: any) => Array.isArray(r) && r.length > 2);
        if (rings.length) {
          out.push({ shell: rings[0], holes: rings.slice(1) });
          counter.n += rings.reduce((acc, r) => acc + r.length, 0);
        }
      }
      break;
    }
    case "GeometryCollection":
      for (const g of geometry.geometries ?? []) collectPolygons(g, out, counter);
      break;
    default:
      break;
  }
}

/**
 * Localiza a coluna de classificação. A coluna esperada é "paleozonas"
 * (valores: humid | dry | semi-arid); outras grafias são aceitas como fallback.
 */
function findClassKey(props: Record<string, unknown>): string | null {
  const normalized = Object.keys(props).map(
    (k) => [k, k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()] as const,
  );
  // 1) Correspondência exata com os nomes esperados (paleozonas tem prioridade)
  for (const expected of PALEOZONA_COLUMN_CANDIDATES) {
    const exact = normalized.find(([, low]) => low === expected);
    if (exact) return exact[0];
  }
  // 2) Correspondência flexível
  const patterns = [/paleo?zonas?/, /paleo/, /zonas?/, /classe/, /class/];
  for (const rx of patterns) {
    const hit = normalized.find(([, low]) => rx.test(low));
    if (hit) return hit[0];
  }
  return null;
}

/** Área aproximada (km²) via fórmula do excesso esférico simplificado. */
export function polygonAreaKm2(poly: SimplePolygon): number {
  const R = 6371.0088;
  const ringArea = (ring: Ring) => {
    if (ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      sum += ((lon2 - lon1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
    }
    return (sum * R * R) / 2;
  };
  const raw = Math.abs(ringArea(poly.shell)) - poly.holes.reduce((acc, h) => acc + Math.abs(ringArea(h)), 0);
  return raw;
}

function ringBBox(ring: Ring): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of ring) {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
  }
  return [minX, minY, maxX, maxY];
}

export interface BuildOptions {
  fileName: string;
  /** CRS informado manualmente pelo usuário (sobrepõe o declarado no arquivo) */
  forcedCrs?: string | null;
}

/**
 * Pipeline de ingestão: parse → bbox em CRS origem → validação de CRS →
 * reprojeção dos vértices para EPSG:4326 → construção das features.
 */
export function buildDataset(text: string, opts: BuildOptions): Dataset {
  const parsed = parseGeoJsonText(text);
  if (!parsed.features.length) throw new Error("O GeoJSON não possui features (features: []).");

  // 1) Coleta dos anéis ainda no CRS de origem
  const counter = { n: 0 };
  const collected: { polygons: SimplePolygon[]; properties: Record<string, unknown> }[] = [];
  let skipped = 0;
  for (const f of parsed.features) {
    const geometry = f?.geometry ?? f;
    const polygons: SimplePolygon[] = [];
    collectPolygons(geometry, polygons, counter);
    if (!polygons.length) {
      skipped++;
      continue;
    }
    collected.push({ polygons, properties: (f?.properties ?? {}) as Record<string, unknown> });
  }
  if (!collected.length) throw new Error("Nenhuma geometria do tipo Polygon/MultiPolygon foi encontrada no arquivo.");
  if (counter.n > MAX_VERTICES) {
    throw new Error(
      `Arquivo muito denso: ${counter.n.toLocaleString("pt-BR")} vértices (limite ${MAX_VERTICES.toLocaleString("pt-BR")}). ` +
        "Simplifique/generalize a geometria antes de carregar.",
    );
  }

  // 2) BBox em CRS de origem + validação de CRS
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const c of collected) {
    for (const p of c.polygons) {
      for (const ring of [p.shell, ...p.holes]) {
        for (const coord of ring) {
          const x = coord?.[0], y = coord?.[1];
          if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  // A heurística de eixos considera ambos os formatos (x=lon ou x=lat)
  minLon = minX; maxLon = maxX; minLat = minY; maxLat = maxY;
  let crs = validateCrs({ rawCrsMember: parsed.crsMember, range: { minLon, maxLon, minLat, maxLat } });
  const warnings: string[] = [];

  if (opts.forcedCrs) {
    warnings.push(`CRS informado manualmente pelo operador: ${opts.forcedCrs} (sobrepôs a detecção automática).`);
    crs = { ...crs, status: "reprojected", source: opts.forcedCrs, declared: opts.forcedCrs, message: `Reprojeção forçada de ${opts.forcedCrs} para EPSG:4326.` };
  }

  const swap = needsAxisSwap({ minLon, maxLon, minLat, maxLat });
  const source = crs.source;
  const reproject = (x: number, y: number): [number, number] => {
    const a = swap ? [y, x] : [x, y];
    const p = reprojectPoint(a[0], a[1], source ?? "EPSG:4326");
    return [p[0], p[1]];
  };

  // 3) Reprojeta anéis + calcula bbox final em graus decimais
  const features: VectorFeature[] = [];
  const unmappedLabels: string[] = [];
  /** Coluna de classificação esperada no arquivo de entrada */
  const expectedColumn = "paleozonas";

  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

  collected.forEach((item, idx) => {
    const polygons: SimplePolygon[] = item.polygons.map((poly) => ({
      shell: poly.shell.map((c) => reproject(c[0], c[1])),
      holes: poly.holes.map((r) => r.map((c) => reproject(c[0], c[1]))),
    }));

    let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
    let area = 0;
    for (const poly of polygons) {
      const bb = ringBBox(poly.shell);
      fMinX = Math.min(fMinX, bb[0]); fMinY = Math.min(fMinY, bb[1]);
      fMaxX = Math.max(fMaxX, bb[2]); fMaxY = Math.max(fMaxY, bb[3]);
      area += polygonAreaKm2(poly);
    }
    minX = Math.min(minX, fMinX); minY = Math.min(minY, fMinY);
    maxX = Math.max(maxX, fMaxX); maxY = Math.max(maxY, fMaxY);

    // 4) Atributo "paleozonas" → {humid, dry, semi-arid}
    const key = findClassKey(item.properties);
    const rawValue = key ? item.properties[key] : undefined;
    let classe: number;
    let classeLabel: string;
    let classeKnown: boolean;

    if (rawValue === undefined || rawValue === null || rawValue === "") {
      // Sem classe: recebe código 0 (não colide com as 3 paleozonas)
      classe = 0;
      classeLabel = "sem classe";
      classeKnown = false;
      if (!warnings.some((w) => w.includes(`"${expectedColumn}"`))) {
        warnings.push(
          `Coluna "${expectedColumn}" não encontrada nos atributos. Colunas disponíveis: ${Object.keys(item.properties).slice(0, 8).join(", ") || "nenhuma"}.`,
        );
      }
    } else {
      const resolved = resolvePaleozona(rawValue);
      classe = resolved.code;
      classeLabel = resolved.label;
      classeKnown = resolved.known;
      if (!resolved.known && !unmappedLabels.includes(resolved.label)) unmappedLabels.push(resolved.label);
    }

    features.push({
      id: `f${idx}`,
      index: idx,
      classe,
      classeLabel,
      classeKnown,
      polygons,
      bbox: [fMinX, fMinY, fMaxX, fMaxY],
      areaKm2: area,
      properties: item.properties,
    });
  });

  if (skipped) warnings.push(`${skipped} feature(s) sem geometria poligonal foram ignoradas.`);
  if (unmappedLabels.length) {
    warnings.push(
      `Valores fora do domínio esperado {humid, dry, semi-arid} na coluna "${expectedColumn}": ${unmappedLabels.join(", ")}.`,
    );
  }
  // Relatório das três paleozonas encontradas
  const counts = new Map<number, number>();
  features.forEach((f) => counts.set(f.classe, (counts.get(f.classe) ?? 0) + 1));
  const resumo = PALEOZONAS.map((p) => `${p.label}: ${counts.get(p.code) ?? 0}`).join(" · ");
  const extra = Array.from(counts.keys()).filter((c) => !PALEOZONA_BY_CODE.has(c)).length;
  warnings.push(`Feições por paleozona → ${resumo}${extra ? ` · ${extra} classe(s) fora do domínio` : ""}.`);
  if (counter.n > 120_000) {
    warnings.push(`${counter.n.toLocaleString("pt-BR")} vértices carregados — o desenho pode ficar mais lento no mapa.`);
  }

  const bbox: BBox = { minX, minY, maxX, maxY };
  return {
    fileName: opts.fileName,
    featureCount: features.length,
    features,
    bbox,
    rawCrsMember: parsed.crsMember,
    coordRange: { minLon: minX, maxLon: maxX, minLat: minY, maxLat: maxY },
    crs,
    unmappedLabels,
    warnings,
    rawCoords: counter.n,
  };
}
