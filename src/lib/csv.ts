import type { GridPoint } from "./types";
import { displayLabel } from "./paleozonas";

export interface CsvOptions {
  delimiter: ";" | ",";
  decimals: number;
  includeNulls: boolean;
  /** Inclui a coluna numérica de código da paleozona (1=humid, 2=dry, 3=semi-arid) */
  includeCode?: boolean;
  /** Usa cabeçalho "Classe" em vez de "Paleozona" */
  headerAlias?: "Paleozona" | "Classe";
}

const fmt = (v: number, decimals: number) => v.toFixed(decimals);

/**
 * Gera a tabela final: Latitude, Longitude e Paleozona.
 * BOM (\uFEFF) é incluído para o Excel PT-BR reconhecer o UTF-8.
 */
export function pointsToCsv(points: GridPoint[], opts: CsvOptions): string {
  const classHeader = opts.headerAlias ?? "Paleozona";
  const cols = ["Latitude", "Longitude", classHeader];
  if (opts.includeCode) cols.push(`${classHeader}_codigo`);
  const lines: string[] = [cols.join(opts.delimiter)];
  for (const p of points) {
    if (p.classe === null && !opts.includeNulls) continue;
    const row = [fmt(p.lat, opts.decimals), fmt(p.lon, opts.decimals), displayLabel(p.classe, p.classeLabel)];
    if (opts.includeCode) row.push(p.classe === null ? "" : String(p.classe));
    lines.push(row.join(opts.delimiter));
  }
  return "\uFEFF" + lines.join("\r\n");
}

/** Exporta também como GeoJSON (FeatureCollection de pontos) para SIG. */
export function pointsToGeoJson(points: GridPoint[], step: number, crsNote: string): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: `malha_paleozonas_${step}graus`,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      metadata: {
        step_degrees: step,
        source_crs: crsNote,
        class_column: "paleozonas",
        classes: ["humid", "dry", "semi-arid"],
        generated: new Date().toISOString(),
      },
      features: points.map((p, i) => ({
        type: "Feature",
        id: i + 1,
        properties: {
          Latitude: Number(p.lat.toFixed(6)),
          Longitude: Number(p.lon.toFixed(6)),
          Paleozona: p.classe === null ? null : displayLabel(p.classe, p.classeLabel),
          PaleozonaCodigo: p.classe,
        },
        geometry: { type: "Point", coordinates: [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))] },
      })),
    },
    null,
    2,
  );
}

/** Dispara o download de um arquivo texto no navegador. */
export function downloadFile(content: string, fileName: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
