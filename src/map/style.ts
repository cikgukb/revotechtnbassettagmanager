// Gaya peta. Semua sumber tile adalah percuma dan tanpa kunci API.
// Untuk tukar pembekal imej satelit, ubah SATELLITE sahaja.
import type { StyleSpecification } from 'maplibre-gl';
import { POLE_STATUS, POLE_STATUS_COLOR } from '../../shared/types';

export const VECTOR_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const SATELLITE = {
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  attribution: 'Imej © Esri, Maxar, Earthstar Geographics',
  maxzoom: 19,
};

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

/** Ungkapan warna ikut indeks status (sifat `s`). */
export const statusColor = ['match', ['get', 's'], ...POLE_STATUS.flatMap((s, i) => [i, POLE_STATUS_COLOR[s]]), '#94a3b8'] as unknown as string;

export const LAYERS_3D_MINZOOM = 16.5;
export const BEACON_MINZOOM = 13.5;
/** Lapisan yang boleh diklik untuk buka profil tiang. */
export const PICK_LAYERS = ['pt', 'pt-ground', 'poles-3d'];

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.3, position: [1.3, 200, 45] },
    sky: { 'sky-color': '#0b1b33', 'horizon-color': '#27405f', 'fog-color': '#1a2c47', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 },
    sources: {
      osm: { type: 'vector', url: VECTOR_TILEJSON },
      sat: { type: 'raster', tiles: SATELLITE.tiles, tileSize: 256, maxzoom: SATELLITE.maxzoom, attribution: SATELLITE.attribution },
      pts: {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 48,
        clusterProperties: {
          // bilangan tiang dalam kluster yang belum disenggara / masih ada kerja terbuka
          nDefect: ['+', ['case', ['==', ['get', 's'], 2], 1, 0]],
          nOpen: ['+', ['case', ['>=', ['get', 's'], 2], 1, 0]],
        },
      },
      p3d: { type: 'geojson', data: EMPTY, tolerance: 0 },
      beacon: { type: 'geojson', data: EMPTY, tolerance: 0 },
      sel: { type: 'geojson', data: EMPTY, tolerance: 0 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0c1626' } },
      { id: 'landcover', type: 'fill', source: 'osm', 'source-layer': 'landcover', paint: { 'fill-color': '#0f2420', 'fill-opacity': 0.7 } },
      { id: 'landuse', type: 'fill', source: 'osm', 'source-layer': 'landuse', paint: { 'fill-color': ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#111d31', ['industrial', 'commercial', 'retail'], '#141f33', '#0f1a2c'] } },
      { id: 'park', type: 'fill', source: 'osm', 'source-layer': 'park', paint: { 'fill-color': '#10291f' } },
      { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': '#0a2a4a' } },
      { id: 'waterway', type: 'line', source: 'osm', 'source-layer': 'waterway', paint: { 'line-color': '#0a2a4a', 'line-width': 1.5 } },
      {
        id: 'road-minor', type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track', 'path']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#26354f', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.5, 16, 4, 20, 26] },
      },
      {
        id: 'road-main', type: 'line', source: 'osm', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#5a6f96', 'primary', '#4b5f85', '#3a4c6e'],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 0.6, 12, 2, 16, 8, 20, 40],
        },
      },
      { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'visible' }, paint: { 'raster-fade-duration': 0, 'raster-saturation': -0.1, 'raster-brightness-max': 0.92 } },
      {
        id: 'buildings-3d', type: 'fill-extrusion', source: 'osm', 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': '#8fa0b8',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.7,
        },
      },
      {
        id: 'road-label', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 13] },
        paint: { 'text-color': '#e8eef7', 'text-halo-color': '#07101f', 'text-halo-width': 1.6 },
      },
      {
        id: 'place-label', type: 'symbol', source: 'osm', 'source-layer': 'place', maxzoom: 15,
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
        paint: { 'text-color': '#cbd5e1', 'text-halo-color': '#07101f', 'text-halo-width': 1.6 },
      },

      // ---- Tiang ----
      // Tiang bermasalah: tiang cahaya lut sinar yang nampak dari jauh.
      {
        id: 'beacon', type: 'fill-extrusion', source: 'beacon', minzoom: BEACON_MINZOOM,
        paint: { 'fill-extrusion-color': ['to-color', ['get', 'c']], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.4, 'fill-extrusion-vertical-gradient': false },
      },
      // Denyutan di tanah untuk tiang yang belum disenggara.
      {
        id: 'halo', type: 'circle', source: 'pts', minzoom: 14.5,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 's'], 2]],
        paint: { 'circle-color': POLE_STATUS_COLOR.defect, 'circle-radius': 10, 'circle-opacity': 0.4, 'circle-pitch-alignment': 'map', 'circle-blur': 0.4 },
      },
      {
        id: 'cluster', type: 'circle', source: 'pts', filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['case', ['>', ['get', 'nDefect'], 0], POLE_STATUS_COLOR.defect, ['>', ['get', 'nOpen'], 0], POLE_STATUS_COLOR.sedang, POLE_STATUS_COLOR.ok],
          'circle-radius': ['step', ['get', 'point_count'], 15, 25, 19, 100, 24, 400, 30],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.92,
        },
      },
      {
        id: 'cluster-count', type: 'symbol', source: 'pts', filter: ['has', 'point_count'],
        layout: {
          'text-field': ['case', ['>', ['get', 'nDefect'], 0], ['concat', ['to-string', ['get', 'point_count_abbreviated']], '\n', ['to-string', ['get', 'nDefect']], ' !'], ['to-string', ['get', 'point_count_abbreviated']]],
          'text-font': FONT_BOLD, 'text-size': 11, 'text-line-height': 1.05, 'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: 'pt', type: 'circle', source: 'pts', maxzoom: 15, filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': statusColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 },
      },
      {
        id: 'pt-ground', type: 'circle', source: 'pts', minzoom: 15, filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': statusColor,
          'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 15, 4, 17, 6.5, 19, 11, 21, 18],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'poles-3d', type: 'fill-extrusion', source: 'p3d', minzoom: LAYERS_3D_MINZOOM,
        paint: { 'fill-extrusion-color': ['to-color', ['get', 'c']], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': 1 },
      },
      {
        id: 'sel-beam', type: 'fill-extrusion', source: 'sel', filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-extrusion-color': '#fde047', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.35 },
      },
      {
        id: 'sel-ring', type: 'circle', source: 'sel', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': 'rgba(253, 224, 71, 0.15)', 'circle-radius': 18, 'circle-stroke-color': '#fde047', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' },
      },
      {
        id: 'pole-label', type: 'symbol', source: 'pts', minzoom: 17.6, filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['get', 'no'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#07101f', 'text-halo-width': 1.6 },
      },
    ],
  };
}
