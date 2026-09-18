/**
 * Código da implementação de referência em Python (Streamlit + GeoPandas + Shapely).
 * É exposto na aba "Python / Streamlit" do dashboard para consulta e download.
 */

export const REQUIREMENTS = `# requirements.txt  ---------------------------------------------------------
streamlit>=1.36
geopandas>=0.14
shapely>=2.0
pyproj>=3.6
pandas>=2.0
numpy>=1.26
folium>=0.16          # opcional: mapa interativo
streamlit-folium>=0.20 # opcional: renderiza o mapa folium no Streamlit
`;

export const INSTRUCTIONS = `# Como executar -------------------------------------------------------------

# 1. Crie (e ative) um ambiente virtual
python -m venv .venv
source .venv/bin/activate          # Linux / macOS
.venv\\Scripts\\activate            # Windows

# 2. Instale as dependências
pip install -r requirements.txt

# 3. Execute o dashboard
streamlit run app.py

# 4. Abra o navegador em http://localhost:8501 e faça o upload do GeoJSON.
#    - Aba "Malha & Opções": ajuste o passo (padrão 5 graus) e a origem da malha.
#    - Aba "Tabela & CSV": baixe o resultado em CSV (UTF-8 BOM, sep=';', decimal=',').

# Dica: para arquivos grandes use a varredura vetorizada (já implementada com
# numpy + gpd.sjoin/STRtree) e evite .explode() desnecessários no GeoDataFrame.
`;

export const STREAMLIT_APP = `"""
===============================================================================
 GEO GRID EXTRACTOR  -  Dashboard SIG (Streamlit + GeoPandas + Shapely)
-------------------------------------------------------------------------------
 Fluxo: upload GeoJSON -> validação de CRS -> reprojeção p/ EPSG:4326 ->
        varredura do bounding box (malha N graus) -> interseção espacial ->
        tabela (Latitude, Longitude, Paleozona) -> download CSV.

 Domínio: coluna "paleozonas" com os valores humid | dry | semi-arid.
===============================================================================
"""

import io
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import streamlit as st
from shapely.geometry import box

TARGET_CRS = "EPSG:4326"
DEFAULT_STEP = 5.0
MAX_CANDIDATES = 6_000_000  # trava de segurança para não estourar a memória

# --- Domínio da classificação -------------------------------------------------
CLASS_COLUMN = "paleozonas"                      # coluna de entrada
CLASS_HEADER = "Paleozona"                       # cabeçalho da tabela de saída
PALEOZONAS = ["humid", "dry", "semi-arid"]       # ordem canônica das classes
# Normalização de grafias alternativas (PT/EN) para o rótulo canônico
PALEOZONA_ALIASES = {
    "humid": "humid", "umido": "humid", "umida": "humid", "wet": "humid",
    "dry": "dry", "seco": "dry", "seca": "dry", "arid": "dry", "arido": "dry",
    "semi-arid": "semi-arid", "semiarid": "semi-arid", "semi-arido": "semi-arid",
    "semi-arida": "semi-arid", "semi umido": "semi-arid",
}


def normalizar_paleozona(valor) -> str:
    """Normaliza o valor bruto para um dos rótulos canônicos."""
    texto = str(valor).strip().lower()
    texto = (texto.replace("á", "a").replace("ã", "a").replace("â", "a")
                  .replace("é", "e").replace("ê", "e").replace("í", "i")
                  .replace("ó", "o").replace("õ", "o").replace("ú", "u").replace("ç", "c"))
    texto = " ".join(texto.split()).replace(" ", "-").replace("_", "-")
    return PALEOZONA_ALIASES.get(texto, texto)

st.set_page_config(page_title="Geo Grid Extractor", page_icon="🗺️", layout="wide")


# -----------------------------------------------------------------------------
# 1) CARGA, CACHE E VALIDAÇÃO
# -----------------------------------------------------------------------------
@st.cache_data(show_spinner=False)
def load_geojson(raw_bytes: bytes) -> gpd.GeoDataFrame:
    """Lê o GeoJSON preservando o CRS declarado no membro 'crs'."""
    gdf = gpd.read_file(io.BytesIO(raw_bytes))
    if gdf.empty:
        raise ValueError("O arquivo não contém feições.")
    if not gdf.geometry.isin(["Polygon", "MultiPolygon"]).all():
        gdf = gdf[gdf.geom_type.isin(["Polygon", "MultiPolygon"])]
    if gdf.empty:
        raise ValueError("Nenhuma geometria do tipo Polygon/MultiPolygon encontrada.")
    return gdf


def ensure_paleozona_column(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Garante a existência da coluna de paleozonas e normaliza os rótulos
    para o domínio {humid, dry, semi-arid}. Valores fora do domínio viram NaN
    e são reportados ao operador.
    """
    gdf = gdf.copy()
    alvo = CLASS_COLUMN.lower().strip()
    for col in gdf.columns:
        if str(col).lower().strip() in {"paleozonas", "paleozona", "paleozone", "classe", "class"}:
            gdf = gdf.rename(columns={col: CLASS_COLUMN})
            break
    if CLASS_COLUMN not in gdf.columns:
        st.warning(
            f"Coluna **{CLASS_COLUMN}** ausente nos atributos "
            f"(colunas encontradas: {', '.join(map(str, gdf.columns))}). "
            "Todos os polígonos receberão o rótulo 'humid'."
        )
        gdf[CLASS_COLUMN] = PALEOZONAS[0]
    # Normaliza e valida contra o domínio
    gdf[CLASS_COLUMN] = gdf[CLASS_COLUMN].apply(normalizar_paleozona)
    invalidos = sorted(set(gdf.loc[~gdf[CLASS_COLUMN].isin(PALEOZONAS), CLASS_COLUMN].astype(str)))
    if invalidos:
        st.warning(
            f"Valores fora do domínio esperado em **{CLASS_COLUMN}**: {', '.join(invalidos)}. "
            f"Domínio válido: {', '.join(PALEOZONAS)}."
        )
    gdf[f"{CLASS_COLUMN}_codigo"] = gdf[CLASS_COLUMN].apply(
        lambda v: PALEOZONAS.index(v) + 1 if v in PALEOZONAS else np.nan
    )
    return gdf


def validate_and_reproject(gdf: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, str]:
    """
    Valida o georreferenciamento. Retorna (geoDataFrame em EPSG:4326, mensagem).
    Regras:
      * sem CRS      -> assume EPSG:4326 (padrão RFC 7946) e alerta;
      * CRS projetado-> reprojeta automaticamente para EPSG:4326;
      * fora da faixa de graus decimais -> erro explícito.
    """
    if gdf.crs is None:
        gdf = gdf.set_crs(TARGET_CRS, allow_override=True)
        msg = "⚠️ Arquivo sem CRS declarado. Assumido EPSG:4326 (coordenadas em graus decimais)."
    else:
        epsg = gdf.crs.to_epsg()
        if gdf.crs.is_geographic and epsg in (4326, 4618, 4674):
            msg = f"✅ CRS geográfico válido: {gdf.crs.to_string()} (graus decimais)."
        else:
            origem = gdf.crs.to_string()
            gdf = gdf.to_crs(TARGET_CRS)
            msg = f"🔁 CRS projetado detectado ({origem}). Dados reprojetados automaticamente para {TARGET_CRS}."

    minx, miny, maxx, maxy = gdf.total_bounds
    if not (-180.5 <= minx <= 180.5 and -180.5 <= maxx <= 180.5
            and -90.5 <= miny <= 90.5 and -90.5 <= maxy <= 90.5):
        raise ValueError(
            f"Coordenadas fora da faixa geográfica ({minx:.2f}, {miny:.2f}, {maxx:.2f}, {maxy:.2f}). "
            "Verifique o CRS do arquivo — provavelmente está em metros sem metadado."
        )
    return gdf, msg


# -----------------------------------------------------------------------------
# 2) VARREDURA DO BOUNDING BOX (malha regular)
# -----------------------------------------------------------------------------
def build_grid(minx, miny, maxx, maxy, step, anchor="origin", centroid=False):
    """Gera as coordenadas da malha de forma vetorizada (sem loop em Python)."""
    if anchor == "origin":  # alinhada a múltiplos do passo (0, 5, 10, ...)
        x0 = np.ceil(minx / step - 1e-9) * step
        y0 = np.ceil(miny / step - 1e-9) * step
    else:                   # ancorada no canto mínimo do bounding box
        x0, y0 = minx, miny

    nx = int(np.floor((maxx - x0) / step + 1e-9)) + 1
    ny = int(np.floor((maxy - y0) / step + 1e-9)) + 1
    if nx * ny > MAX_CANDIDATES:
        raise ValueError(f"Malha muito densa ({nx * ny:,} pontos). Aumente o passo da grade.")

    offset = step / 2 if centroid else 0.0
    lons = np.round(x0 + np.arange(nx) * step + offset, 9)
    lats = np.round(y0 + np.arange(ny) * step + offset, 9)
    LON, LAT = np.meshgrid(lons, lats)          # linhas = latitudes, colunas = longitudes
    return LON.ravel(), LAT.ravel(), nx, ny


# -----------------------------------------------------------------------------
# 3) INTERSEÇÃO ESPAÇAL (point in polygon, vetorizada via STRtree)
# -----------------------------------------------------------------------------
def intersect_points(gdf, lons, lats, keep_outside=False):
    """
    Cruza cada ponto da malha com os polígonos: o ponto herda a paleozona
    do polígono que o contém (point in polygon).
    """
    pts = gpd.GeoDataFrame(
        {"Longitude": lons, "Latitude": lats},
        geometry=gpd.points_from_xy(lons, lats),
        crs=TARGET_CRS,
    )
    # gpd.sjoin usa uma árvore STRtree: complexidade ~O(n log m), muito mais
    # rápido do que testar ponto a ponto contra todas as geometrias.
    joined = gpd.sjoin(
        pts,
        gdf[[CLASS_COLUMN, f"{CLASS_COLUMN}_codigo", "geometry"]],
        how="left",
        predicate="within",
    )
    joined = joined[~joined.index.duplicated(keep="first")]     # resolve sobreposições
    joined[CLASS_HEADER] = joined[CLASS_COLUMN].astype("string")  # NaN quando fora
    tabela = joined[["Latitude", "Longitude", CLASS_HEADER, f"{CLASS_COLUMN}_codigo"]].reset_index(drop=True)
    tabela = tabela.rename(columns={f"{CLASS_COLUMN}_codigo": f"{CLASS_HEADER}_codigo"})
    if not keep_outside:
        tabela = tabela.dropna(subset=[CLASS_HEADER]).reset_index(drop=True)
    # Ordena a saída pela ordem canônica das paleozonas
    tabela["__ord"] = tabela[CLASS_HEADER].map({v: i for i, v in enumerate(PALEOZONAS)}).fillna(99)
    tabela = tabela.sort_values(["__ord", "Latitude", "Longitude"]).drop(columns="__ord")
    return tabela.reset_index(drop=True)


# -----------------------------------------------------------------------------
# INTERFACE
# -----------------------------------------------------------------------------
st.title("🗺️ Geo Grid Extractor — paleozonas")
st.caption(
    "Upload GeoJSON (coluna **paleozonas**: humid · dry · semi-arid) → validação CRS (EPSG:4326) "
    "→ malha regular → point-in-polygon → CSV"
)

with st.sidebar:
    st.header("1. Entrada de dados")
    upload = st.file_uploader(
        "GeoJSON (polígonos com a coluna 'paleozonas')", type=["geojson", "json"],
        help="Domínio aceito na coluna paleozonas: humid, dry, semi-arid.",
    )

    st.header("2. Malha de varredura")
    step = st.number_input("Passo da malha (graus decimais)", min_value=0.01, max_value=45.0,
                           value=DEFAULT_STEP, step=0.5, format="%.2f",
                           help="Padrão 5° em 5°. Reduza (ex.: 0.25) para malha mais fina.")
    anchor = st.select_slider("Ancoragem da malha", options=["origin", "bbox"],
                              help="origin = múltiplos absolutos do passo; bbox = canto mínimo do dado.")
    centroid = st.checkbox("Usar centro da célula", value=False)
    keep_outside = st.checkbox("Manter pontos fora dos polígonos (paleozona vazia)", value=False)

    run = st.button("🚀 Processar varredura", type="primary", use_container_width=True)

if upload is None:
    st.info("Faça o upload de um arquivo GeoJSON para iniciar, ou carregue o exemplo abaixo.")
    if st.button("Carregar exemplo de demonstração"):
        # Exemplo embutido: 3 polígonos, um para cada paleozona do domínio
        exemplo = {
            "type": "FeatureCollection",
            "name": "paleozonas_exemplo",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": [
                {"type": "Feature", "properties": {"paleozonas": "humid"},
                 "geometry": {"type": "Polygon", "coordinates": [[[-72, -8], [-60, -8], [-60, 2], [-72, 2], [-72, -8]]]}},
                {"type": "Feature", "properties": {"paleozonas": "dry"},
                 "geometry": {"type": "Polygon", "coordinates": [[[-62, -20], [-50, -20], [-50, -12], [-62, -12], [-62, -20]]]}},
                {"type": "Feature", "properties": {"paleozonas": "semi-arid"},
                 "geometry": {"type": "Polygon", "coordinates": [[[-48, -25], [-40, -25], [-40, -18], [-48, -18], [-48, -25]]]}},
            ],
        }
        st.session_state["exemplo"] = json.dumps(exemplo).encode()
        st.rerun()
    # Permite usar o exemplo carregado em uma execução anterior
    if "exemplo" in st.session_state:
        upload = st.session_state["exemplo"]
    else:
        st.stop()

# Aceita tanto o UploadedFile do Streamlit quanto bytes do exemplo embutido
raw = upload.getvalue() if hasattr(upload, "getvalue") else upload
try:
    gdf = load_geojson(raw)
    gdf = ensure_paleozona_column(gdf)
    gdf, crs_msg = validate_and_reproject(gdf)
    st.success(crs_msg)
except Exception as exc:  # noqa: BLE001
    st.error(f"Falha ao carregar/validar o arquivo: {exc}")
    st.stop()

minx, miny, maxx, maxy = gdf.total_bounds
c1, c2, c3, c4 = st.columns(4)
c1.metric("Feições", len(gdf))
c2.metric("Vértices", count_vertices(gdf))
c3.metric("CRS", gdf.crs.to_epsg() or "assumido 4326")
c4.metric("Extensão (lon × lat)", f"{maxx - minx:.1f}° × {maxy - miny:.1f}°")

if not run:
    st.warning("Ajuste os parâmetros na barra lateral e clique em **Processar varredura**.")
    st.stop()

with st.spinner("Varrendo bounding box e cruzando pontos..."):
    lons, lats, nx, ny = build_grid(minx, miny, maxx, maxy, step, anchor, centroid)
    tabela = intersect_points(gdf, lons, lats, keep_outside)

st.success(f"Malha {nx} × {ny} = {nx * ny:,} candidatos · {len(tabela):,} pontos classificados.")

tab_map, tab_table, tab_diag = st.tabs(["📍 Mapa", "🧾 Tabela & CSV", "🛠️ Diagnóstico"])

with tab_map:
    plot_df = tabela.dropna(subset=["Longitude", "Latitude"])
    if not plot_df.empty:
        st.map(plot_df[["Latitude", "Longitude"]])
    st.caption("Pré-visualização nativa (st.map). Para camadas/customização, use folium + streamlit-folium.")

with tab_table:
    st.dataframe(tabela, use_container_width=True, height=420)
    buffer = io.BytesIO()
    buffer.write(tabela.to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"))
    st.download_button(
        label="⬇️ Baixar CSV (Latitude; Longitude; Classe)",
        data=buffer.getvalue(),
        file_name=f"malha_{str(step).replace('.', '_')}graus.csv",
        mime="text/csv",
        use_container_width=True,
    )
    st.download_button(
        label="⬇️ Baixar resumo por classe",
        data=tabela.groupby("Classe", dropna=False).size().to_csv(sep=";", header=["qtde"]).encode("utf-8-sig"),
        file_name="resumo_por_classe.csv",
        mime="text/csv",
    )

with tab_diag:
    st.write("**Bounding box (EPSG:4326)**")
    st.json({"min_lon": round(minx, 6), "min_lat": round(miny, 6),
             "max_lon": round(maxx, 6), "max_lat": round(maxy, 6)})
    st.write(f"**{CLASS_HEADER}s encontradas**")
    contagem = (
        gdf.groupby(CLASS_COLUMN).size().rename("feições").to_frame()
        .reindex(PALEOZONAS, fill_value=0)
    )
    st.dataframe(contagem, use_container_width=True)
    st.caption(f"Domínio esperado na coluna {CLASS_COLUMN}: {', '.join(PALEOZONAS)}")
    st.write("**Memória do GeoDataFrame**")
    st.text(f"{gdf.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB")
`;

export const STREAMLIT_APP_LINES = STREAMLIT_APP.split("\n");
