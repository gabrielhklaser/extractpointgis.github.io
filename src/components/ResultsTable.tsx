import { useMemo, useState } from "react";
import { classColor } from "@/lib/processor";
import { PALEOZONAS, displayLabel, paleozonaMeta } from "@/lib/paleozonas";
import { copyToClipboard, downloadFile, pointsToCsv, pointsToGeoJson, stamp } from "@/lib/csv";
import type { GridPoint } from "@/lib/types";
import { Badge, Button, Card, Icons, Toggle } from "./ui";
import { cn } from "@/utils/cn";

type SortKey = "lat" | "lon" | "classe";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

export default function ResultsTable({
  points,
  step,
  crsNote,
  classFilter,
  onClassFilter,
}: {
  points: GridPoint[];
  step: number;
  crsNote: string;
  classFilter: number | null;
  onClassFilter: (c: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("classe");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [delimiter, setDelimiter] = useState<";" | ",">(";");
  const [decimals, setDecimals] = useState(6);
  const [includeNulls, setIncludeNulls] = useState(false);
  const [includeCode, setIncludeCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = points;
    if (classFilter !== null) list = list.filter((p) => p.classe === classFilter);
    if (q) {
      list = list.filter(
        (p) =>
          p.lat.toFixed(4).includes(q) ||
          p.lon.toFixed(4).includes(q) ||
          displayLabel(p.classe, p.classeLabel).toLowerCase().includes(q),
      );
    }
    const order = PALEOZONAS.map((p) => p.code);
    const rank = (code: number | null) => {
      if (code === null) return 99;
      const i = order.indexOf(code);
      return i === -1 ? 98 : i;
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "classe") return (rank(a.classe) - rank(b.classe)) * dir || a.lat - b.lat;
      return sortKey === "lat" ? (a.lat - b.lat) * dir : (a.lon - b.lon) * dir;
    });
  }, [points, query, sortKey, sortDir, classFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const csv = () => pointsToCsv(filtered, { delimiter, decimals, includeNulls });
  const geojson = () => pointsToGeoJson(filtered, step, crsNote);
  const baseName = `malha_${String(step).replace(".", "_")}graus_${stamp()}`;

  const header = (key: SortKey, label: string) => (
    <th
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
          setSortKey(key);
          setSortDir("asc");
        }
      }}
      className={cn("cursor-pointer select-none pb-2 pr-3 text-[10px] uppercase tracking-wider text-slate-500 hover:text-cyan-300")}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key && <span className="text-cyan-400">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );

  return (
    <Card
      title="5 · Tabela resultante"
      subtitle="Latitude, Longitude e Classe — pronta para exportação"
      right={<Badge tone="ok">{filtered.length.toLocaleString("pt-BR")} registros</Badge>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Filtrar por coordenada ou classe..."
          className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
        />
        {classFilter !== null && (
          <button
            onClick={() => onClassFilter(null)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] text-cyan-200"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: classColor(classFilter) }} />
            {paleozonaMeta(classFilter).label} ✕
          </button>
        )}
        <Button variant="outline" onClick={() => setDelimiter((d) => (d === ";" ? "," : ";"))} title="Alternar separador">
          Separador: <span className="font-mono text-cyan-300">{delimiter}</span>
        </Button>
        <Button variant="outline" onClick={() => setDecimals((d) => (d === 6 ? 4 : 6))} title="Alternar casas decimais">
          Decimais: <span className="font-mono text-cyan-300">{decimals}</span>
        </Button>
        <Button
          variant={includeCode ? "primary" : "outline"}
          onClick={() => setIncludeCode((v) => !v)}
          title="Inclui a coluna Paleozona_codigo (1=humid, 2=dry, 3=semi-arid)"
        >
          Código numérico
        </Button>
        <Button
          variant="primary"
          onClick={() => downloadFile(csv(), `${baseName}.csv`)}
          disabled={!filtered.length}
        >
          {Icons.download} Baixar CSV
        </Button>
        <Button variant="outline" onClick={() => downloadFile(geojson(), `${baseName}.geojson`, "application/geo+json")} disabled={!filtered.length}>
          GeoJSON
        </Button>
        <Button
          variant="ghost"
          disabled={!filtered.length}
          onClick={async () => {
            const ok = await copyToClipboard(csv().replace(/^\uFEFF/, "").replace(/;/g, "\t"));
            setCopied(ok);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? Icons.check : Icons.copy} {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.03]">
            <tr>
              <th className="pb-2 pr-3 pt-2 text-[10px] uppercase tracking-wider text-slate-500">#</th>
              {header("lat", "Latitude")}
              {header("lon", "Longitude")}
              {header("classe", "Classe")}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-mono text-[11px]">
            {slice.map((p, i) => (
              <tr key={`${p.lon}-${p.lat}-${i}`} className="text-slate-300 hover:bg-white/[0.03]">
                <td className="py-1.5 pr-3 text-slate-600">{current * PAGE_SIZE + i + 1}</td>
                <td className="py-1.5 pr-3 text-slate-200">{p.lat.toFixed(decimals)}</td>
                <td className="py-1.5 pr-3 text-slate-200">{p.lon.toFixed(decimals)}</td>
                <td className="py-1.5 pr-3">
                  {p.classe === null ? (
                    <span className="text-slate-600">fora</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: classColor(p.classe) }} />
                      <span className="text-slate-100">{displayLabel(p.classe, p.classeLabel)}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  Nenhum ponto para exibir. Processe a varredura para gerar a malha.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" onClick={() => setPage(0)} disabled={current === 0}>
            «
          </Button>
          <Button variant="outline" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0}>
            ‹
          </Button>
          <span className="px-2 font-mono text-[11px] text-slate-400">
            {current + 1} / {pages}
          </span>
          <Button variant="outline" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1}>
            ›
          </Button>
          <Button variant="outline" onClick={() => setPage(pages - 1)} disabled={current >= pages - 1}>
            »
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <span>
            UTF-8 com BOM · cabeçalho{" "}
            <code className="text-cyan-300">
              Latitude{delimiter}Longitude{delimiter}Paleozona{includeCode ? `${delimiter}Paleozona_codigo` : ""}
            </code>
          </span>
        </div>
      </div>

      <div className="mt-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            checked={includeNulls}
            onChange={setIncludeNulls}
            label="Incluir pontos fora dos polígonos"
            description="Registros com paleozona vazia (classe nula) também são exportados."
          />
          <Toggle
            checked={includeCode}
            onChange={setIncludeCode}
            label="Incluir código numérico da paleozona"
            description="1 = humid · 2 = dry · 3 = semi-arid"
          />
        </div>
      </div>
    </Card>
  );
}
