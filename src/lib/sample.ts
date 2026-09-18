import proj4 from "proj4";

/**
 * Conjunto de dados de exemplo (paleozonas simplificadas da América do Sul).
 * A coluna de classificação é "paleozonas" com os valores humid | dry | semi-arid.
 */
const PALEOZONA_FEATURES: { classe: string; nome: string; ring: number[][] }[] = [
  {
    classe: "humid",
    nome: "Paleozona úmida (norte)",
    ring: [
      [-73, -8], [-73, -2], [-70, 2], [-66, 4], [-60, 5], [-55, 2], [-52, -1], [-50, -3],
      [-48, -5], [-52, -8], [-56, -11], [-60, -13], [-64, -12], [-68, -11], [-72, -10],
    ],
  },
  {
    classe: "dry",
    nome: "Paleozona seca (central)",
    ring: [
      [-60, -14], [-56, -12], [-52, -10], [-48, -8], [-46, -11], [-45, -15], [-47, -19],
      [-50, -21], [-53, -22], [-56, -21], [-58, -19], [-61, -17],
    ],
  },
  {
    classe: "semi-arid",
    nome: "Paleozona semiárida (leste)",
    ring: [
      [-45, -3], [-41, -4], [-38, -6], [-36, -9], [-37, -12], [-40, -13], [-43, -13],
      [-45, -11], [-47, -10], [-46, -6],
    ],
  },
  {
    classe: "humid",
    nome: "Paleozona úmida (costeira)",
    ring: [
      [-48, -26], [-44, -23], [-41, -19], [-39, -15], [-41, -22], [-44, -26], [-47, -28],
    ],
  },
  {
    classe: "dry",
    nome: "Paleozona seca (sul)",
    ring: [[-62, -30], [-57, -29], [-53, -32], [-56, -36], [-61, -35], [-63, -32]],
  },
  {
    classe: "semi-arid",
    nome: "Paleozona semiárida (sudeste)",
    ring: [[-56, -22], [-52, -23], [-50, -27], [-54, -29], [-57, -27], [-58, -24]],
  },
];

function closeRing(ring: number[][]): number[][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/** GeoJSON de exemplo em EPSG:4326 (graus decimais), com coluna "paleozonas". */
export const SAMPLE_4326 = JSON.stringify(
  {
    type: "FeatureCollection",
    name: "paleozonas_exemplo_epsg4326",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: PALEOZONA_FEATURES.map((b) => ({
      type: "Feature",
      properties: { paleozonas: b.classe, descricao: b.nome },
      geometry: { type: "Polygon", coordinates: [closeRing(b.ring)] },
    })),
  },
  null,
  2,
);

/** Versão do mesmo dataset reprojetada para UTM 23S (SIRGAS 2000) — demonstra a reprojeção automática. */
export function utmProjectedSample(): string {
  const toUtm = (lon: number, lat: number): number[] => proj4("EPSG:4326", "EPSG:31983", [lon, lat]);
  const fc: any = {
    type: "FeatureCollection",
    name: "paleozonas_exemplo_utm23s_sirgas2000",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::31983" } },
    features: PALEOZONA_FEATURES.map((b) => ({
      type: "Feature",
      properties: { paleozonas: b.classe, descricao: b.nome },
      geometry: {
        type: "Polygon",
        coordinates: [closeRing(b.ring).map(([lon, lat]) => toUtm(lon, lat).map((v) => Math.round(v * 100) / 100))],
      },
    })),
  };
  return JSON.stringify(fc);
}
