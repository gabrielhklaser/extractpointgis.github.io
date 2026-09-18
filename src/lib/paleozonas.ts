/**
 * Domínio: PALEOZONAS
 * ------------------------------------------------------------------
 * A coluna de classificação dos polígonos chama-se "paleozonas" e admite
 * três valores: humid, dry e semi-arid.
 *
 * Internamente cada paleozona recebe um código numérico estável (1, 2, 3)
 * para acelerar a interseção espacial e as estatísticas, mas o rótulo
 * original é sempre preservado e é ele que vai para o CSV final.
 */

export const PALEOZONA_COLUMN_CANDIDATES = [
  "paleozonas",
  "paleozona",
  "paleozone",
  "zona_paleo",
  "paleozone_class",
  "classe",
  "class",
];

export interface PaleozonaMeta {
  code: number;
  label: string;
  color: string;
  description: string;
}

/** Ordem canônica e cores fixas das três paleozonas. */
export const PALEOZONAS: PaleozonaMeta[] = [
  {
    code: 1,
    label: "humid",
    color: "#22c55e",
    description: "Zona úmida — alta disponibilidade de umidade",
  },
  {
    code: 2,
    label: "dry",
    color: "#eab308",
    description: "Zona seca — baixa disponibilidade hídrica",
  },
  {
    code: 3,
    label: "semi-arid",
    color: "#f97316",
    description: "Zona semiárida — transição entre úmido e seco",
  },
];

export const PALEOZONA_BY_CODE = new Map<number, PaleozonaMeta>(PALEOZONAS.map((p) => [p.code, p]));
export const PALEOZONA_BY_LABEL = new Map<string, PaleozonaMeta>(
  PALEOZONAS.map((p) => [p.label, p]),
);

/** Normaliza texto: minúsculo, sem acentos, hífen/espaço/underscore unificados. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Alias aceitos para cada paleozona (PT/EN e variações de escrita). */
const ALIASES: Record<string, string> = {
  humid: "humid",
  umido: "humid",
  umida: "humid",
  húmido: "humid",
  wet: "humid",
  moiste: "humid",
  dry: "dry",
  seco: "dry",
  seca: "dry",
  arid: "dry",
  arido: "dry",
  árido: "dry",
  "semi-arid": "semi-arid",
  semiarid: "semi-arid",
  "semi-arido": "semi-arid",
  "semiarido": "semi-arid",
  "semi-arida": "semi-arid",
  "semiumido": "semi-arid",
  "semi-umido": "semi-arid",
  "sub-humido": "semi-arid",
  "subhumid": "semi-arid",
};

/** Código padrão para valores desconhecidos (fora das 3 classes esperadas). */
export const UNKNOWN_BASE_CODE = 10;

/**
 * Resolve o valor bruto da coluna paleozonas para {code, label}.
 * Valores desconhecidos recebem código >= UNKNOWN_BASE_CODE (sem colidir com 1..3).
 */
export function resolvePaleozona(rawValue: unknown): { code: number; label: string; known: boolean } {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { code: 0, label: "sem classe", known: false };
  }
  const text = String(rawValue).trim();
  const key = normalizeLabel(text);
  const alias = ALIASES[key];
  if (alias) {
    const meta = PALEOZONA_BY_LABEL.get(alias)!;
    return { code: meta.code, label: meta.label, known: true };
  }
  // Valor já numérico (1/2/3) — respeita a ordem canônica
  const asNum = Number(text.replace(",", "."));
  if (Number.isInteger(asNum) && PALEOZONA_BY_CODE.has(asNum)) {
    return { code: asNum, label: PALEOZONA_BY_CODE.get(asNum)!.label, known: true };
  }
  // Desconhecido: código estável derivado do texto
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return { code: UNKNOWN_BASE_CODE + (hash % 50), label: text, known: false };
}

/** Metadados (cor/descrição) de um código de paleozona. */
export function paleozonaMeta(code: number, label?: string): PaleozonaMeta {
  const known = PALEOZONA_BY_CODE.get(code);
  if (known) return known;
  return {
    code,
    label: label ?? `classe ${code}`,
    color: "#a78bfa",
    description: "Valor fora das três paleozonas esperadas",
  };
}

/** Cor de uma paleozona (aceita código). */
export function classColor(code: number): string {
  return paleozonaMeta(code).color;
}

/** Rótulo de exibição de um ponto/feição. */
export function displayLabel(code: number | null, label: string): string {
  if (code === null) return "fora";
  return label || paleozonaMeta(code).label;
}
