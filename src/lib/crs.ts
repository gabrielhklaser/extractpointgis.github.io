import proj4 from "proj4";
import type { CrsReport } from "./types";

/**
 * Módulo de validação / reprojeção de CRS.
 * ------------------------------------------------------------------
 * GeoJSON (RFC 7946) define WGS84 / EPSG:4326 como CRS obrigatório,
 * porém muitos arquivos saem de softwares GIS (ArcGIS, QGIS, GDAL)
 * com o membro "crs" apontando para outro sistema (ex.: UTM SIRGAS 2000).
 * Aqui detectamos o CRS declarado e reprojetamos para EPSG:4326.
 */

export const TARGET_CRS = "EPSG:4326";

/** Registra as definições de UTM (WGS84 e SIRGAS 2000) para todas as zonas. */
function registerUtmDefs() {
  for (let zone = 1; zone <= 60; zone++) {
    const zz = String(zone).padStart(2, "0");
    const hemis = [
      { code: `EPSG:326${zz}`, proj: `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs` },
      { code: `EPSG:327${zz}`, proj: `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs` },
      // SIRGAS 2000 / UTM (faixa 31901..31960 norte, 31961..32000 sul - mapeada abaixo)
      { code: `EPSG:319${String(zone + 60).padStart(2, "0")}`, proj: `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs` },
      { code: `EPSG:5880`, proj: `+proj=utm +zone=24 +south +ellps=GRS80 +units=m +no_defs` },
    ];
    hemis.forEach((h) => {
      if (!proj4.defs(h.code)) proj4.defs(h.code, h.proj);
    });
    // SIRGAS 2000 zona norte
    const north = `EPSG:319${zz}`;
    if (!proj4.defs(north)) proj4.defs(north, `+proj=utm +zone=${zone} +ellps=GRS80 +units=m +no_defs`);
  }
  // Datum brasileiros clássicos (SAD69 / Corrego Alegre) por zona sul
  for (let zone = 18; zone <= 25; zone++) {
    const zz = String(zone).padStart(2, "0");
    const candidates: Record<string, string> = {
      [`EPSG:291${zz}`]: `+proj=utm +zone=${zone} +south +ellps=aust_SA +units=m +no_defs`,
      [`EPSG:55${zz}`]: `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`,
      [`EPSG:225${zz}`]: `+proj=utm +zone=${zone} +south +ellps=GRS67 +units=m +no_defs`,
    };
    Object.entries(candidates).forEach(([code, def]) => {
      if (!proj4.defs(code)) proj4.defs(code, def);
    });
  }
  // Projeções equirretangulares / mercator comuns
  if (!proj4.defs("EPSG:3857")) proj4.defs("EPSG:3857", "EPSG:3857");
}
registerUtmDefs();

/** Extrai, de qualquer forma de declaração, um identificador utilizável. */
export function normalizeCrs(raw: unknown): { code: string | null; display: string | null } {
  if (raw === null || raw === undefined) return { code: null, display: null };

  // {"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::31983"}}
  if (typeof raw === "object") {
    const obj = raw as Record<string, any>;
    const name =
      obj?.properties?.name ??
      obj?.properties?.code ??
      obj?.name ??
      obj?.id?.code ??
      (typeof obj?.code === "string" || typeof obj?.code === "number" ? obj.code : undefined);
    if (name !== undefined && name !== null) return normalizeCrs(name);
    if (typeof obj?.wkt === "string") return { code: null, display: "WKT (não suportado para reprojeção automática)" };
    return { code: null, display: JSON.stringify(raw).slice(0, 120) };
  }

  if (typeof raw === "number") {
    return { code: `EPSG:${raw}`, display: `EPSG:${raw}` };
  }

  const str = String(raw).trim();
  if (!str) return { code: null, display: null };
  if (str.startsWith("+proj") || str.startsWith("+init")) return { code: str, display: str };

  // urn:ogc:def:crs:EPSG::31983  |  EPSG:31983 | http://www.opengis.net/def/crs/EPSG/0/31983
  const epsgMatch = str.match(/EPSG[:/\s]*(\d{3,5})/i);
  if (epsgMatch) return { code: `EPSG:${epsgMatch[1]}`, display: str };

  if (/crs84|ogc:crs84|wgs\s*84/i.test(str)) return { code: "EPSG:4326", display: str };
  return { code: str, display: str };
}

export function isKnownCrs(code: string | null): boolean {
  if (!code) return false;
  if (code.startsWith("+proj") || code.startsWith("+init")) return true;
  return Boolean(proj4.defs(code));
}

/** Nomes amigáveis dos CRS mais usados. */
const CRS_LABELS: Record<string, string> = {
  "EPSG:4326": "WGS 84 (graus decimais) — padrão GeoJSON",
  "EPSG:3857": "WGS 84 / Pseudo-Mercator (Web Mercator)",
  "EPSG:4674": "SIRGAS 2000 (geográfico)",
  "EPSG:4326-AXIS": "WGS 84 com ordem de eixo lat/lon",
};

export function crsLabel(code: string | null): string {
  if (!code) return "—";
  return CRS_LABELS[code] ?? code;
}

/**
 * Detecta se os eixos estão invertidos (lat, lon) comparando com a faixa válida.
 * Retorna true se for necessário inverter.
 */
export function needsAxisSwap(range: { minLon: number; maxLon: number; minLat: number; maxLat: number }): boolean {
  const lonOk = range.minLon >= -180.5 && range.maxLon <= 180.5;
  const latOk = range.minLat >= -90.5 && range.maxLat <= 90.5;
  if (lonOk && latOk) {
    // Ambos válidos: se X parecer latitude (|x|<=90) e Y estourar 90 -> swap.
    return false;
  }
  if (!latOk && range.minLon >= -90.5 && range.maxLon <= 90.5) return true;
  return false;
}

export interface ValidateArgs {
  rawCrsMember: unknown;
  range: { minLon: number; maxLon: number; minLat: number; maxLat: number };
}

/**
 * Valida o CRS do arquivo. Retorna um relatório com status e o CRS de origem
 * (normalizado) a ser usado na reprojeção.
 */
export function validateCrs({ rawCrsMember, range }: ValidateArgs): CrsReport {
  const target = TARGET_CRS;
  const details: string[] = [];
  const { code, display } = normalizeCrs(rawCrsMember);

  // --- Caso 1: CRS declarado e compatível com 4326 ---------------------
  if (code && /4326|CRS84/i.test(code)) {
    const swapped = needsAxisSwap(range);
    details.push("Membro \"crs\" declara WGS 84 / EPSG:4326 (graus decimais).");
    if (!swapped) {
      details.push(`Faixa de coordenadas: lon ${range.minLon.toFixed(4)}..${range.maxLon.toFixed(4)}, lat ${range.minLat.toFixed(4)}..${range.maxLat.toFixed(4)}.`);
      return {
        status: "ok",
        declared: display,
        source: "EPSG:4326",
        target,
        message: "Georreferenciamento válido — dados já em EPSG:4326.",
        details,
        swappedAxis: false,
      };
    }
    details.push("Coordenadas parecem estar em ordem (lat, lon): eixos foram invertidos automaticamente.");
    return {
      status: "reprojected",
      declared: display,
      source: "EPSG:4326",
      target,
      message: "Ordem de eixos corrigida (lat, lon) → (lon, lat).",
      details,
      swappedAxis: true,
    };
  }

  // --- Caso 2: CRS declarado diferente de 4326 -------------------------
  if (code) {
    if (isKnownCrs(code)) {
      details.push(`CRS declarado: ${crsLabel(code)}.`);
      details.push(`Reprojeção automática ${code} → ${target} aplicada a todos os vértices.`);
      return {
        status: "reprojected",
        declared: display,
        source: code,
        target,
        message: `CRS projetado detectado (${crsLabel(code)}). Dados reprojetados para EPSG:4326.`,
        details,
        swappedAxis: false,
      };
    }
    details.push(`CRS declarado (${display}) não foi reconhecido pela biblioteca de projeções.`);
    return {
      status: "error",
      declared: display,
      source: null,
      target,
      message: "CRS declarado é desconhecido — reprojeção automática indisponível.",
      details,
      swappedAxis: false,
    };
  }

  // --- Caso 3: sem CRS declarado ---------------------------------------
  const lonOk = range.minLon >= -180.5 && range.maxLon <= 180.5;
  const latOk = range.minLat >= -90.5 && range.maxLat <= 90.5;
  details.push("Arquivo sem membro \"crs\" declarado.");
  if (lonOk && latOk) {
    details.push("Coordenadas dentro da faixa válida de graus decimais (±180 lon, ±90 lat).");
    details.push("Assumido EPSG:4326 conforme RFC 7946. Confirme no metadado de origem.");
    return {
      status: "assumed",
      declared: null,
      source: "EPSG:4326",
      target,
      message: "Sem CRS declarado — assumido EPSG:4326 (coordenadas consistentes com graus decimais).",
      details,
      swappedAxis: false,
    };
  }
  details.push(
    `Coordenadas fora da faixa geográfica (lon ${range.minLon.toFixed(2)}..${range.maxLon.toFixed(2)}, lat ${range.minLat.toFixed(2)}..${range.maxLat.toFixed(2)}).`,
  );
  const looksMercator =
    Math.abs(range.maxLon) <= 20_037_509 && Math.abs(range.minLon) <= 20_037_509 && Math.abs(range.maxLat) <= 20_037_509;
  if (looksMercator) {
    details.push("Os valores lembram Web Mercator (EPSG:3857). Use o seletor “Sobrescrever CRS” para reprojetar agora.");
  } else {
    details.push("Provável CRS projetado em metros (UTM) sem metadado. Defina o CRS correto antes de prosseguir.");
  }
  return {
    status: "error",
    declared: null,
    source: null,
    target,
    message: "Sem CRS definido e coordenadas incompatíveis com graus decimais.",
    details,
    swappedAxis: false,
  };
}

/** Reprojeta um par [x, y] do CRS de origem para EPSG:4326. */
export function reprojectPoint(x: number, y: number, source: string): [number, number] {
  if (!source || source === TARGET_CRS) return [x, y];
  const out = proj4(source, TARGET_CRS, [x, y]);
  return [out[0], out[1]];
}

/** Lista de CRS oferecidos no seletor manual (fallback do usuário). */
export const COMMON_CRS: { code: string; label: string }[] = [
  { code: "EPSG:4326", label: "EPSG:4326 — WGS 84 (graus decimais)" },
  { code: "EPSG:3857", label: "EPSG:3857 — Web Mercator" },
  { code: "EPSG:4674", label: "EPSG:4674 — SIRGAS 2000 geográfico" },
  { code: "EPSG:31983", label: "EPSG:31983 — SIRGAS 2000 / UTM 23S" },
  { code: "EPSG:31978", label: "EPSG:31978 — SIRGAS 2000 / UTM 18S" },
  { code: "EPSG:32723", label: "EPSG:32723 — WGS 84 / UTM 23S" },
  { code: "EPSG:32623", label: "EPSG:32623 — WGS 84 / UTM 23N" },
];
