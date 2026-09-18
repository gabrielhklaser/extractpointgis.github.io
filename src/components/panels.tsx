import { useRef, useState } from "react";
import { COMMON_CRS, crsLabel } from "@/lib/crs";
import { PALEOZONAS } from "@/lib/paleozonas";
import { classColor } from "@/lib/processor";
import type { ClassStat, Dataset, GridOptions, LogEntry } from "@/lib/types";
import { Badge, Button, Card, Field, Icons, Progress, Stat, Toggle } from "./ui";
import { cn } from "@/utils/cn";

/* ------------------------------------------------------------------ Upload */

export function Uploader({
  onFile,
  onSample,
  loading,
  fileName,
  featureCount,
}: {
  onFile: (file: File) => void;
  onSample: (kind: "4326" | "utm") => void;
  loading: boolean;
  fileName: string | null;
  featureCount: number;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Card
      title="1 · Entrada de dados"
      subtitle="GeoJSON com polígonos e atributo “classe” (numérico)"
      right={<Badge tone="info">GeoJSON</Badge>}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition",
          over ? "border-cyan-400/70 bg-cyan-400/10" : "border-white/15 bg-white/[0.02] hover:border-cyan-400/40 hover:bg-white/[0.05]",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/30">
          {Icons.upload}
        </div>
        <p className="text-sm font-medium text-slate-200">
          {loading ? "Lendo arquivo..." : "Arraste o .geojson aqui ou clique para selecionar"}
        </p>
        <p className="text-[11px] text-slate-500">
          Polígono / MultiPolygon · coluna <code className="text-cyan-300">paleozonas</code> · limite de ~600 mil vértices
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onSample("4326")} className="flex-1">
          Exemplo EPSG:4326
        </Button>
        <Button variant="outline" onClick={() => onSample("utm")} className="flex-1">
          Exemplo UTM 23S
        </Button>
      </div>

      {fileName && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <span className="text-emerald-400">{Icons.check}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{fileName}</span>
          <span className="font-mono text-emerald-300/80">{featureCount} feições</span>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------------- CRS */

const TONE: Record<string, string> = { ok: "ok", assumed: "warn", reprojected: "info", error: "error" };

export function CrsPanel({
  dataset,
  forcedCrs,
  onForced,
}: {
  dataset: Dataset | null;
  forcedCrs: string | null;
  onForced: (code: string | null) => void;
}) {
  if (!dataset) {
    return (
      <Card title="2 · Validação de georreferenciamento (CRS)" subtitle="Aguardando arquivo para validar o CRS">
        <p className="text-xs leading-relaxed text-slate-500">
          O pipeline verifica o membro <code className="text-cyan-300">crs</code>, confere se as coordenadas estão em
          graus decimais (EPSG:4326) e reprojeta automaticamente quando necessário.
        </p>
      </Card>
    );
  }
  const crs = dataset.crs;
  return (
    <Card
      title="2 · Validação de georreferenciamento (CRS)"
      subtitle={crsLabel(crs.source ?? crs.declared)}
      right={<Badge tone={TONE[crs.status]}>{crs.status === "ok" ? "EPSG:4326 OK" : crs.status === "error" ? "CRS inválido" : crs.status === "assumed" ? "Assumido 4326" : "Reprojetado"}</Badge>}
    >
      <p className={cn("text-xs font-medium", crs.status === "error" ? "text-rose-300" : "text-slate-200")}>{crs.message}</p>
      <ul className="mt-2 space-y-1">
        {crs.details.map((d, i) => (
          <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-slate-400">
            <span className="text-cyan-400/70">▸</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-400">
        <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
          lon: {dataset.coordRange.minLon.toFixed(3)} → {dataset.coordRange.maxLon.toFixed(3)}
        </div>
        <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
          lat: {dataset.coordRange.minLat.toFixed(3)} → {dataset.coordRange.maxLat.toFixed(3)}
        </div>
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <Field label="Sobrescrever CRS manualmente" hint="fallback operacional">
          <select
            value={forcedCrs ?? ""}
            onChange={(e) => onForced(e.target.value || null)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/60"
          >
            <option value="">Usar detecção automática do arquivo</option>
            {COMMON_CRS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- Controles */

const PRESETS = [0.25, 0.5, 1, 2.5, 5, 10];

export function ControlsPanel({
  options,
  onChange,
  onRun,
  onCancel,
  busy,
  progress,
  estimate,
  disabled,
}: {
  options: GridOptions;
  onChange: (o: GridOptions) => void;
  onRun: () => void;
  onCancel: () => void;
  busy: boolean;
  progress: { value: number; label: string } | null;
  estimate: { candidates: number; nx: number; ny: number } | null;
  disabled: boolean;
}) {
  return (
    <Card title="3 · Malha de varredura" subtitle="Passo da grade em graus decimais (padrão 5° × 5°)">
      <div className="space-y-3">
        <Field label="Passo (graus)" hint={options.step === 5 ? "padrão" : "personalizado"}>
          <div className="flex items-stretch gap-2">
            <input
              type="number"
              min={0.01}
              max={45}
              step={0.5}
              value={options.step}
              onChange={(e) => onChange({ ...options, step: Number(e.target.value) })}
              className="w-24 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 font-mono text-sm text-cyan-200 outline-none focus:border-cyan-400/60"
            />
            <input
              type="range"
              min={0.1}
              max={15}
              step={0.1}
              value={Math.min(options.step, 15)}
              onChange={(e) => onChange({ ...options, step: Number(e.target.value) })}
              className="h-9 flex-1 accent-cyan-400"
            />
          </div>
        </Field>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => onChange({ ...options, step: p })}
              className={cn(
                "rounded-lg px-2.5 py-1 font-mono text-[11px] transition",
                options.step === p ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-inset ring-cyan-400/40" : "bg-white/5 text-slate-400 hover:bg-white/10",
              )}
            >
              {p}°
            </button>
          ))}
        </div>

        <Field label="Ancoragem da malha">
          <select
            value={options.anchor}
            onChange={(e) => onChange({ ...options, anchor: e.target.value as GridOptions["anchor"] })}
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/60"
          >
            <option value="origin">Múltiplos absolutos do passo (…, -5, 0, 5, 10, …)</option>
            <option value="bbox">Canto mínimo do bounding box dos dados</option>
          </select>
        </Field>

        <Toggle
          checked={options.useCentroid}
          onChange={(v) => onChange({ ...options, useCentroid: v })}
          label="Usar centro da célula"
          description="Desloca o ponto meio passo em X e Y (útil para malhas finas)."
        />
        <Toggle
          checked={options.keepOutside}
          onChange={(v) => onChange({ ...options, keepOutside: v })}
          label="Manter pontos fora dos polígonos"
          description="Caso contrário os pontos externos são descartados (classe nula)."
        />

        {estimate && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
            Matriz estimada:{" "}
            <span className="font-mono text-cyan-300">
              {estimate.nx} × {estimate.ny} = {estimate.candidates.toLocaleString("pt-BR")}
            </span>{" "}
            candidatos
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={onRun} disabled={disabled || busy} className="flex-1">
            {Icons.play} {busy ? "Processando..." : "Processar varredura"}
          </Button>
          {busy && (
            <Button variant="danger" onClick={onCancel}>
              Parar
            </Button>
          )}
        </div>
        {progress && <Progress value={progress.value} label={progress.label} />}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- Estatísticas */

export function StatsRow({
  dataset,
  stats,
  candidates,
  inside,
  outside,
  elapsedMs,
}: {
  dataset: Dataset | null;
  stats: ClassStat[];
  candidates: number;
  inside: number;
  outside: number;
  elapsedMs: number;
}) {
  const rate = candidates ? (inside / candidates) * 100 : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Feições" value={dataset ? dataset.featureCount.toLocaleString("pt-BR") : "—"} hint={dataset ? `${dataset.rawCoords.toLocaleString("pt-BR")} vértices` : undefined} />
      <Stat label="Candidatos" value={candidates.toLocaleString("pt-BR")} hint="pontos da malha" tone="text-slate-200" />
      <Stat label="Dentro" value={inside.toLocaleString("pt-BR")} hint={`${rate.toFixed(1)}% de aproveitamento`} tone="text-emerald-300" />
      <Stat label="Descartados" value={outside.toLocaleString("pt-BR")} hint="fora dos polígonos" tone="text-amber-300" />
      <Stat label="Classes" value={stats.length} hint="valores distintos" tone="text-cyan-300" />
      <Stat label="Tempo" value={`${elapsedMs.toFixed(0)} ms`} hint="processamento espacial" tone="text-slate-200" />
    </div>
  );
}

export function ClassTable({ stats, onFilter }: { stats: ClassStat[]; onFilter: (c: number | null) => void }) {
  if (!stats.length) return null;
  return (
    <Card title="Resumo por paleozona" subtitle="Pontos herdados de cada polígono, feições e área aproximada">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-2 pr-3">Paleozona</th>
              <th className="pb-2 pr-3 text-right">Pontos</th>
              <th className="pb-2 pr-3 text-right">Feições</th>
              <th className="pb-2 pr-3 text-right">Área (km²)</th>
              <th className="pb-2 text-right">Filtro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {stats.map((s) => (
              <tr key={s.classe} className="text-slate-300">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: classColor(s.classe) }} />
                    <span className="font-mono text-slate-100">{s.label}</span>
                    <span className="text-[10px] text-slate-600">#{s.classe}</span>
                    {!s.known && <Badge tone="warn">fora do domínio</Badge>}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right font-mono">{s.points.toLocaleString("pt-BR")}</td>
                <td className="py-2 pr-3 text-right font-mono">{s.features.toLocaleString("pt-BR")}</td>
                <td className="py-2 pr-3 text-right font-mono">{Math.round(s.areaKm2).toLocaleString("pt-BR")}</td>
                <td className="py-2 text-right">
                  <button onClick={() => onFilter(s.classe)} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-white/10">
                    filtrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------- Domínio de classes */

/** Cartão informativo com as três paleozonas aceitas na coluna "paleozonas". */
export function PaleozonaLegend({ counts }: { counts: Map<string, number> }) {
  return (
    <Card title="Domínio de classificação" subtitle='Coluna "paleozonas" — 3 classes aceitas'>
      <ul className="space-y-2">
        {PALEOZONAS.map((p) => (
          <li key={p.code} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-inset ring-white/20" style={{ background: p.color }} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-xs font-semibold text-slate-100">{p.label}</span>
              <span className="block text-[10px] leading-snug text-slate-500">{p.description}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-xs text-cyan-300">{counts.get(p.label)?.toLocaleString("pt-BR") ?? 0}</span>
              <span className="block text-[9px] uppercase tracking-wider text-slate-600">pontos</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
        Grafias alternativas são aceitas (ex.: <code>Semi-Arid</code>, <code>semi arid</code>, <code>úmido</code>,{" "}
        <code>seco</code>) e normalizadas automaticamente para o rótulo canônico.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------- Prévia das feições */

export function FeaturePreview({ dataset }: { dataset: Dataset | null }) {
  if (!dataset) return null;
  const cols = Array.from(
    dataset.features.slice(0, 20).reduce((set, f) => {
      Object.keys(f.properties).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  ).slice(0, 5);

  return (
    <Card title="Prévia dos dados" subtitle="Primeiras feições e atributos detectados">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-2 pr-3">id</th>
              <th className="pb-2 pr-3">classe</th>
              {cols.map((c) => (
                <th key={c} className="pb-2 pr-3">
                  {c}
                </th>
              ))}
              <th className="pb-2 text-right">área (km²)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-mono">
            {dataset.features.slice(0, 6).map((f) => (
              <tr key={f.id} className="text-slate-300">
                <td className="py-1.5 pr-3 text-slate-600">{f.index}</td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: classColor(f.classe) }} />
                    <span className={f.classeKnown ? "text-slate-100" : "text-amber-300"}>{f.classeLabel}</span>
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c} className="max-w-[120px] truncate py-1.5 pr-3 text-slate-400">
                    {String(f.properties[c] ?? "—")}
                  </td>
                ))}
                <td className="py-1.5 text-right">{Math.round(f.areaKm2).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dataset.unmappedLabels.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-300/90">
          Valores fora do domínio esperado em <code className="text-cyan-300">paleozonas</code>:{" "}
          {dataset.unmappedLabels.join(", ")} (esperado: humid · dry · semi-arid).
        </p>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------- Log */

const LOG_STYLE: Record<LogEntry["level"], string> = {
  info: "text-slate-400",
  success: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <Card title="Console de processamento" subtitle="Trilha de auditoria do pipeline SIG" bodyClassName="p-0">
      <div className="max-h-64 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 && <p className="text-slate-600">Nenhuma mensagem.</p>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-slate-600">{l.time}</span>
            <span className={LOG_STYLE[l.level]}>
              [{l.level.toUpperCase().padEnd(7)}] {l.message}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
