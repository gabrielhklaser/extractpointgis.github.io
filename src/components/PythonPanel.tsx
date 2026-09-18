import { useMemo, useState } from "react";
import { INSTRUCTIONS, REQUIREMENTS, STREAMLIT_APP } from "@/lib/pythonCode";
import { copyToClipboard, downloadFile } from "@/lib/csv";
import { Badge, Button, Card, Icons } from "./ui";
import { cn } from "@/utils/cn";

type Tab = "app" | "req" | "how";

interface Tok {
  t: string;
  c?: string;
}

const KEYWORDS =
  "def|class|import|from|return|if|elif|else|for|while|in|not|and|or|with|as|try|except|finally|raise|lambda|None|True|False|pass|break|continue|yield|global|assert|await|async|del|is";

const LINE_TOKEN = new RegExp(
  `(#[^\\n]*)|("""|''')|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(@[\\w.]+)|\\b(${KEYWORDS})\\b|\\b(\\d+\\.?\\d*)\\b`,
  "g",
);

/** Destaque de sintaxe leve (sem dependências) para Python / Bash. */
function highlightLine(line: string, inDocstring: boolean): Tok[] {
  if (inDocstring) return [{ t: line, c: "text-emerald-300/70" }];
  if (/^\s*#/.test(line)) return [{ t: line, c: "text-slate-500 italic" }];
  const out: Tok[] = [];
  let last = 0;
  for (const m of line.matchAll(LINE_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ t: line.slice(last, idx) });
    const [full, comment, doc, str, decorator, kw, num] = m;
    if (comment) out.push({ t: full, c: "text-slate-500 italic" });
    else if (doc) out.push({ t: full, c: "text-emerald-300/70" });
    else if (str) out.push({ t: full, c: "text-emerald-300" });
    else if (decorator) out.push({ t: full, c: "text-fuchsia-300" });
    else if (kw) out.push({ t: full, c: "text-pink-400" });
    else if (num) out.push({ t: full, c: "text-amber-300" });
    last = idx + full.length;
  }
  if (last < line.length) out.push({ t: line.slice(last) });
  return out;
}

/** Marca as linhas dentro de docstrings triplas. */
function docstringLines(text: string): Set<number> {
  const set = new Set<number>();
  const lines = text.split("\n");
  let inside = false;
  lines.forEach((l, i) => {
    const count = (l.match(/"""/g) ?? []).length;
    if (inside) set.add(i);
    if (count > 0) {
      // abre/fecha no mesmo conjunto de aspas
      for (let k = 0; k < count; k++) {
        inside = !inside;
        if (inside) set.add(i);
      }
    }
  });
  return set;
}

function CodeView({ code }: { code: string }) {
  const lines = useMemo(() => code.split("\n"), [code]);
  const docs = useMemo(() => docstringLines(code), [code]);
  return (
    <div className="max-h-[620px] overflow-auto rounded-xl border border-white/10 bg-[#060b16]">
      <table className="w-full border-collapse font-mono text-[11px] leading-[1.55]">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-white/[0.03]">
              <td className="w-12 select-none border-r border-white/5 px-2 text-right align-top text-slate-600">{i + 1}</td>
              <td className="whitespace-pre px-3 align-top text-slate-300">
                {line ? highlightLine(line, docs.has(i)).map((tk, j) => <span key={j} className={tk.c}>{tk.t}</span>) : " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PythonPanel() {
  const [tab, setTab] = useState<Tab>("app");
  const [copied, setCopied] = useState(false);

  const files: Record<Tab, { name: string; code: string; lang: string }> = {
    app: { name: "app.py", code: STREAMLIT_APP, lang: "python" },
    req: { name: "requirements.txt", code: REQUIREMENTS, lang: "text" },
    how: { name: "COMO_EXECUTAR.md", code: INSTRUCTIONS, lang: "bash" },
  };
  const current = files[tab];

  return (
    <Card
      title="Implementação de referência em Python"
      subtitle="Streamlit + GeoPandas + Shapely + pyproj — mesmo pipeline, executável localmente"
      right={
        <div className="flex items-center gap-2">
          <Badge tone="info">python 3.10+</Badge>
          <Badge tone="muted">{STREAMLIT_APP.split("\n").length} linhas</Badge>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["app", "app.py"],
              ["req", "requirements.txt"],
              ["how", "como executar"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-medium transition",
                tab === key ? "bg-cyan-400/15 text-cyan-200 ring-1 ring-inset ring-cyan-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              const ok = await copyToClipboard(current.code);
              setCopied(ok);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? Icons.check : Icons.copy} {copied ? "Copiado" : "Copiar código"}
          </Button>
          <Button variant="outline" onClick={() => downloadFile(current.code, current.name, "text/plain;charset=utf-8")}>
            {Icons.download} {current.name}
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <CodeView code={current.code} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {[
          {
            t: "Validação de CRS",
            d: "gdf.crs.is_geographic + checagem de total_bounds; reprojeta com to_crs(EPSG:4326) quando o dado vem de UTM/projeção.",
          },
          {
            t: "Varredura vetorizada",
            d: "np.arange + np.meshgrid geram a malha sem loop Python; trava de segurança de 6 milhões de candidatos.",
          },
          {
            t: "Interseção rápida",
            d: "gpd.sjoin(predicate='within') usa STRtree (O(n log m)) — dezenas de milhares de pontos por segundo.",
          },
        ].map((b) => (
          <div key={b.t} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs font-semibold text-cyan-200">{b.t}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{b.d}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
