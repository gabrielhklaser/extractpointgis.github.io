import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "@/components/MapView";
import PythonPanel from "@/components/PythonPanel";
import ResultsTable from "@/components/ResultsTable";
import {
  ClassTable,
  ControlsPanel,
  CrsPanel,
  FeaturePreview,
  LogPanel,
  PaleozonaLegend,
  StatsRow,
  Uploader,
} from "@/components/panels";
import { PALEOZONAS } from "@/lib/paleozonas";
import { Badge, Card, Icons } from "@/components/ui";
import { crsLabel } from "@/lib/crs";
import { buildDataset } from "@/lib/geojson";
import { computeClassStats, processGrid } from "@/lib/processor";
import { SAMPLE_4326, utmProjectedSample } from "@/lib/sample";
import type { BBox, Dataset, GridOptions, GridResult, LogEntry } from "@/lib/types";
import { cn } from "@/utils/cn";

const DEFAULT_OPTIONS: GridOptions = { step: 5, anchor: "origin", keepOutside: false, useCentroid: false };

const AUTO_RUN_LIMIT = 250_000; // acima disso exige clique manual

/** Ordem canônica dos códigos internos das paleozonas. */
const PALEOZONA_CODES = PALEOZONAS.map((p) => p.code);

function now() {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

/** Réplica da matemática da malha, usada para estimar a matriz antes de processar. */
function estimateGrid(bbox: BBox, step: number, anchor: GridOptions["anchor"]) {
  if (!isFinite(step) || step <= 0) return null;
  const snap = (v: number) => Math.round(v * 1e9) / 1e9;
  const startX = anchor === "bbox" ? bbox.minX : Math.ceil(snap(bbox.minX / step - 1e-9)) * step;
  const startY = anchor === "bbox" ? bbox.minY : Math.ceil(snap(bbox.minY / step - 1e-9)) * step;
  const nx = Math.floor(snap((bbox.maxX - startX) / step + 1e-9)) + 1;
  const ny = Math.floor(snap((bbox.maxY - startY) / step + 1e-9)) + 1;
  return { nx, ny, candidates: nx * ny };
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [options, setOptions] = useState<GridOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<GridResult | null>(null);
  const [forcedCrs, setForcedCrs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const rawRef = useRef<string | null>(null);
  const cancelRef = useRef(false);

  const log = (level: LogEntry["level"], message: string) =>
    setLogs((prev) => [...prev.slice(-300), { level, time: now(), message }]);

  /* ------------------------------------------------- ingestão de dados */
  const ingest = (text: string, fileName: string, forced: string | null = null) => {
    setError(null);
    setResult(null);
    setLoadingFile(true);
    setProgress({ value: 5, label: "Analisando geometrias..." });
    // Deixa o navegador pintar o estado de loading antes do parse síncrono
    setTimeout(() => {
      try {
        const ds = buildDataset(text, { fileName, forcedCrs: forced });
        rawRef.current = text;
        setDataset(ds);
        log("success", `Arquivo "${fileName}" carregado: ${ds.featureCount} feição(ões), ${ds.rawCoords.toLocaleString("pt-BR")} vértices.`);
        log("info", `CRS declarado: ${crsLabel(ds.crs.declared)} · status: ${ds.crs.status.toUpperCase()}`);
        ds.crs.details.forEach((d) => log("info", d));
        if (ds.crs.status === "error") log("error", ds.crs.message);
        ds.warnings.forEach((w) => log("warn", w));
        log("info", `Bounding box (EPSG:4326): lon ${ds.bbox.minX.toFixed(4)}..${ds.bbox.maxX.toFixed(4)}, lat ${ds.bbox.minY.toFixed(4)}..${ds.bbox.maxY.toFixed(4)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setDataset(null);
        log("error", msg);
      } finally {
        setLoadingFile(false);
        setProgress(null);
      }
    }, 30);
  };

  const onFile = (file: File) => {
    log("info", `Lendo arquivo "${file.name}" (${(file.size / 1024).toFixed(1)} kB)...`);
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ""), file.name, null);
    reader.onerror = () => {
      setError("Não foi possível ler o arquivo.");
      log("error", "Falha de leitura no FileReader.");
    };
    setForcedCrs(null);
    reader.readAsText(file);
  };

  const onSample = (kind: "4326" | "utm") => {
    const text = kind === "4326" ? SAMPLE_4326 : utmProjectedSample();
    setForcedCrs(null);
    log("info", kind === "4326" ? "Carregando exemplo em EPSG:4326 (biomas)..." : "Carregando exemplo em UTM 23S SIRGAS 2000 (demonstra reprojeção)...");
    ingest(text, kind === "4326" ? "biomas_exemplo_epsg4326.geojson" : "biomas_exemplo_utm23s.geojson");
  };

  /* --------------------------------------------------- processamento */
  const run = async () => {
    if (!dataset) return;
    setBusy(true);
    setError(null);
    cancelRef.current = false;
    log("info", `Iniciando varredura com passo de ${options.step}° (ancoragem: ${options.anchor}).`);
    try {
      const res = await processGrid(dataset, options, {
        onProgress: (value, label) => setProgress({ value, label }),
        shouldCancel: () => cancelRef.current,
      });
      setResult(res);
      log(
        "success",
        `${res.candidates.toLocaleString("pt-BR")} candidatos avaliados em ${res.elapsedMs.toFixed(0)} ms · ${res.inside.toLocaleString("pt-BR")} ponto(s) dentro dos polígonos, ${res.outside.toLocaleString("pt-BR")} descartado(s).`,
      );
      const stats = computeClassStats(dataset, res.points);
      stats.forEach((s) => log("info", `Classe ${s.classe}: ${s.points} ponto(s) em ${s.features} feição(ões).`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      log("error", msg);
      setResult(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;

  const estimate = useMemo(
    () => (dataset ? estimateGrid(dataset.bbox, options.step, options.anchor) : null),
    [dataset, options.step, options.anchor],
  );

  // Execução automática para malhas leves (feedback imediato ao usuário)
  useEffect(() => {
    if (!dataset || !estimate) return;
    if (estimate.candidates > AUTO_RUN_LIMIT) return;
    const t = setTimeout(() => void runRef.current(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, options]);

  const stats = useMemo(() => (dataset && result ? computeClassStats(dataset, result.points) : []), [dataset, result]);
  /** Códigos de paleozona presentes na malha, na ordem canônica humid → dry → semi-arid */
  const classList = useMemo(() => {
    const codes = new Set<number>();
    result?.points.forEach((p) => p.classe !== null && codes.add(p.classe));
    const order = PALEOZONA_CODES;
    return Array.from(codes).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a - b;
    });
  }, [result]);

  /** Contagem de pontos por rótulo de paleozona (para o cartão de domínio) */
  const countsByLabel = useMemo(() => {
    const map = new Map<string, number>();
    stats.forEach((s) => map.set(s.label, s.points));
    return map;
  }, [stats]);

  const steps = [
    { label: "Upload", done: Boolean(dataset) },
    { label: "CRS 4326", done: Boolean(dataset && dataset.crs.status !== "error") },
    { label: "Malha", done: Boolean(estimate && estimate.candidates > 0) },
    { label: "Interseção", done: Boolean(result) },
    { label: "Export CSV", done: Boolean(result && result.inside > 0) },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_-10%,#0e2545_0%,#050a15_45%,#03060d_100%)] text-slate-200">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-500 p-2 text-slate-950 shadow-lg shadow-cyan-500/25">
              {Icons.globe}
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white">
                GeoGrid Extractor <span className="text-cyan-300">SIG</span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Malha de pontos · validação CRS · interseção espacial · exportação CSV
              </p>
            </div>
          </div>

          <nav className="order-3 flex w-full flex-wrap items-center gap-1.5 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
            {steps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                    s.done ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-white/5 text-slate-500 ring-white/10",
                  )}
                >
                  {i + 1}. {s.label}
                </span>
                {i < steps.length - 1 && <span className="text-slate-700">→</span>}
              </div>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {dataset && (
              <Badge tone={dataset.crs.status === "ok" ? "ok" : dataset.crs.status === "error" ? "error" : "warn"}>
                CRS {crsLabel(dataset.crs.source ?? dataset.crs.declared)}
              </Badge>
            )}
            <Badge tone="muted">EPSG:4326 alvo</Badge>
            <Badge tone="info">paleozonas · 3 classes</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span className="mt-0.5 text-rose-400">{Icons.alert}</span>
            <div className="flex-1">
              <div className="font-semibold">Falha no pipeline</div>
              <p className="text-xs leading-relaxed text-rose-200/80">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="rounded-lg px-2 text-rose-300/70 hover:text-rose-200">
              ✕
            </button>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-12">
          {/* -------------------------------------------------- coluna esquerda */}
          <div className="space-y-4 xl:col-span-4 2xl:col-span-3">
            <Uploader onFile={onFile} onSample={onSample} loading={loadingFile} fileName={dataset?.fileName ?? null} featureCount={dataset?.featureCount ?? 0} />
            <CrsPanel
              dataset={dataset}
              forcedCrs={forcedCrs}
              onForced={(code) => {
                setForcedCrs(code);
                if (rawRef.current) ingest(rawRef.current, dataset?.fileName ?? "dados.geojson", code);
              }}
            />
            <ControlsPanel
              options={options}
              onChange={setOptions}
              onRun={run}
              onCancel={() => {
                cancelRef.current = true;
                log("warn", "Cancelamento solicitado pelo usuário.");
              }}
              busy={busy}
              progress={progress}
              estimate={estimate}
              disabled={!dataset}
            />
            <PaleozonaLegend counts={countsByLabel} />

            <Card title="Pipeline aplicado" subtitle="Mesma lógica disponível na aba Python/Streamlit">
              <ol className="space-y-2 text-[11px] leading-relaxed text-slate-400">
                {[
                  ["Ingestão", "parse do GeoJSON, achamento de Polygon/MultiPolygon e extração do atributo classe."],
                  ["Validação CRS", "leitura do membro crs, checagem de graus decimais e reprojeção para EPSG:4326."],
                  ["Varredura", "loop vetorizado sobre o bounding box gerando pontos a cada N graus."],
                  ["Interseção", "índice espacial por células + ray casting (point in polygon) respeitando furos."],
                  ["Exportação", "dataframe Latitude/Longitude/Classe com download em CSV (UTF-8 BOM)."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-cyan-400/15 font-mono text-[9px] text-cyan-300">
                      {i + 1}
                    </span>
                    <span>
                      <span className="font-semibold text-slate-200">{t}:</span> {d}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          {/* --------------------------------------------------- coluna direita */}
          <div className="space-y-4 xl:col-span-8 2xl:col-span-9">
            <MapView
              features={dataset?.features ?? []}
              points={result?.points ?? []}
              bbox={dataset?.bbox ?? null}
              step={options.step}
              classList={classList}
              empty={!dataset}
            />

            <StatsRow
              dataset={dataset}
              stats={stats}
              candidates={result?.candidates ?? estimate?.candidates ?? 0}
              inside={result?.inside ?? 0}
              outside={result?.outside ?? 0}
              elapsedMs={result?.elapsedMs ?? 0}
            />

            <ResultsTable
              points={result?.points ?? []}
              step={options.step}
              crsNote={dataset?.crs.source ?? "EPSG:4326"}
              classFilter={classFilter}
              onClassFilter={setClassFilter}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <ClassTable stats={stats} onFilter={setClassFilter} />
              <LogPanel logs={logs} />
            </div>

            <FeaturePreview dataset={dataset} />

            <PythonPanel />
          </div>
        </div>

        <footer className="pb-6 pt-2 text-center text-[11px] text-slate-600">
          Processamento 100% no navegador · reprojeção via proj4 · índice espacial em grade uniforme + ray casting ·
          malha padrão de 5° em 5° graus decimais.
        </footer>
      </main>
    </div>
  );
}
