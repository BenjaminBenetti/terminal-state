// Task studio-market-bar-20261108-225231-01 (lane BEER): THE BEER BOTTLE — the world drop / pickup / held / icon model of the market bar's five
// beers (items/beers.ts), CODE-BUILT and DETERMINISTIC (no existing beer model; the way world/railTiesModel.ts built the ties):
//  - the bottle: a 330 ml long-neck lathed from one fixed profile (BEER_BOTTLE: 62 mm body, a shoulder into a 25 mm neck, the lip ring),
//    its glass a flat runtime colour per beer (green / emerald / near-black / brown / amber) — opaque: the beer inside is dark;
//  - the crown cap: a short flared cylinder in the beer's own cap colour (flat runtime colour, metallic);
//  - the LABEL: a cylinder band wrapped on the body's front (+Z), sized to the label art's 3 : 2 (BEER_LABEL_ATLAS.aspect), its UVs the
//    beer's rect in the label ATLAS — the beers' INITIAL Codex-generated labels (assets/beerLabels.generated.ts; provenance
//    assets/derivatives/beer-labels.json; tools/asset-pipeline/props/build-beer-labels.mjs). No label art is drawn in code: before the
//    atlas loads (Node tests, a failed fetch) the band is plain label paper.
// Origin bottom-centre, +Y up, front +Z, metres (bounds = ITEM_DIMS: tests). Geometry / materials are shared (cached once; the item
// templates flag them `userData.shared`; pickups clone the materials for their glow).
import * as THREE from 'three';
import {BEER_IDS, type BeerId} from '../../items/beers';
import {BEER_LABEL_ATLAS} from '../../assets/beerLabels.generated';

/** The bottle (m): the lathe profile [radius, height] bottom to lip, the cap, the label band. */
export const BEER_BOTTLE = {
  /** Outer profile of the glass, bottom (a shallow push-up) to the top of the lip; lathed about +Y. */
  profile: [
    [0, 0.0022], [0.022, 0.0006], [0.0285, 0], [0.0305, 0.0018], [0.031, 0.0055], [0.031, 0.118], [0.0302, 0.1275], [0.0276, 0.1395],
    [0.0226, 0.1525], [0.0174, 0.1655], [0.014, 0.1795], [0.0128, 0.1945], [0.0125, 0.2145], [0.0133, 0.2165], [0.0135, 0.2205],
    [0.0126, 0.2228], [0.0123, 0.2285], [0, 0.2285],
  ] as const,
  radius: 0.031,
  segments: 24,
  /** The crown cap: bottom (flared skirt) / top radius, from y0 to the bottle's top. */
  cap: {r0: 0.0146, r1: 0.0136, y0: 0.2265, y1: 0.235},
  /** The label band: its height and centre height on the straight body (its width follows the art's aspect around the body). */
  label: {h: 0.07, y: 0.066, lift: 0.0004},
} as const;

/** Glass / cap colours (flat runtime colours, sRGB hex). */
export const BEER_LOOK: Readonly<Record<BeerId, {glass: number; cap: number}>> = {
  beer_lager: {glass: 0x2d5a24, cap: 0xc9a43c}, // green glass, gold crown
  beer_pilsner: {glass: 0x3f7f3a, cap: 0x2f7d4f}, // emerald glass, green crown
  beer_stout: {glass: 0x24140a, cap: 0x8c4c2a}, // near-black glass, copper crown
  beer_porter: {glass: 0x46240c, cap: 0x203462}, // brown glass, navy crown
  beer_bock: {glass: 0x6a3410, cap: 0x8f2a22}, // amber glass, red crown
};

/** Model source line (QA / itemModelSources). */
export const beerModelSource = (): string => `code-built long-neck bottle (market/beer/beerModel.ts) · Codex label atlas ${label.tex ? 'loaded' : 'NOT loaded (plain label paper)'}`;

const label: {tex: THREE.Texture | null; mat: THREE.MeshStandardMaterial | null} = {tex: null, mat: null};
let geoCache: Record<string, THREE.BufferGeometry> = {};
let matCache: Record<string, THREE.Material> = {};
let preload: Promise<void> | null = null;

/** The label paper colour while no atlas is loaded. */
const PAPER = 0xe8dcc0;

/** The label atlas texture in use (null: plain paper). Tests / a re-delivery may swap it. */
export function setBeerLabelTexture(t: THREE.Texture | null): void {
  label.tex = t;
  const m = label.mat;
  if (m) { m.map = t; m.color.set(t ? 0xffffff : PAPER); m.needsUpdate = true; }
}

/** Fetch the label atlas once (no browser / a failure resolves quietly -> plain label paper). Awaited by Game.load before the item icons. */
export function preloadBeerLabels(): Promise<void> {
  if (preload) return preload;
  if (typeof window === 'undefined' || typeof document === 'undefined') return (preload = Promise.resolve());
  preload = new THREE.TextureLoader().loadAsync(new URL(BEER_LABEL_ATLAS.url, document.baseURI).href).then(t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.name = 'beer-labels';
    setBeerLabelTexture(t);
  }, err => { console.warn(`beer: ${BEER_LABEL_ATLAS.url} did not load — plain label paper is used`, err); });
  return preload;
}

/** The lathed glass (shared by every beer). */
function glassGeometry(): THREE.BufferGeometry {
  return geoCache.glass ??= (() => {
    const g = new THREE.LatheGeometry(BEER_BOTTLE.profile.map(([r, y]) => new THREE.Vector2(r, y)), BEER_BOTTLE.segments);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  })();
}

/** The crown cap (shared). */
function capGeometry(): THREE.BufferGeometry {
  return geoCache.cap ??= (() => {
    const c = BEER_BOTTLE.cap;
    const g = new THREE.CylinderGeometry(c.r1, c.r0, c.y1 - c.y0, 20, 1, false).translate(0, (c.y0 + c.y1) / 2, 0);
    g.computeBoundingBox();
    return g;
  })();
}

/** The label arc (radians around the body) for the art's aspect: width = aspect x height, wrapped at the band radius. */
export const beerLabelArc = (): number => (BEER_LABEL_ATLAS.aspect * BEER_BOTTLE.label.h) / (BEER_BOTTLE.radius + BEER_BOTTLE.label.lift);

/** One beer's label band: centred on the front (+Z), u left -> right as seen from the front, v up; UVs = its rect in the atlas. */
function labelGeometry(id: BeerId): THREE.BufferGeometry {
  return geoCache[`label:${id}`] ??= (() => {
    const L = BEER_BOTTLE.label, r = BEER_BOTTLE.radius + L.lift, arc = beerLabelArc();
    const g = new THREE.CylinderGeometry(r, r, L.h, 24, 1, true, -arc / 2, arc).translate(0, L.y, 0);
    const [u0, v0, u1, v1] = BEER_LABEL_ATLAS.rect[id], uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    uv.needsUpdate = true;
    g.computeBoundingBox();
    return g;
  })();
}

const std = (key: string, p: THREE.MeshStandardMaterialParameters): THREE.Material => matCache[key] ??= new THREE.MeshStandardMaterial(p);

function labelMaterial(): THREE.MeshStandardMaterial {
  return label.mat ??= (() => {
    const m = new THREE.MeshStandardMaterial({name: 'beer-label', map: label.tex, color: label.tex ? 0xffffff : PAPER, roughness: 0.62, metalness: 0});
    matCache.label = m;
    return m;
  })();
}

/** A NEW group of one beer's bottle (shared geometry / materials; the caller may clone it). */
export function beerModel(id: BeerId): THREE.Group {
  const look = BEER_LOOK[id];
  const g = new THREE.Group();
  g.name = `item-${id}`;
  g.userData.authored = true;
  const glass = new THREE.Mesh(glassGeometry(), std(`glass:${id}`, {name: `beer-glass-${id}`, color: look.glass, roughness: 0.16, metalness: 0}));
  const cap = new THREE.Mesh(capGeometry(), std(`cap:${id}`, {name: `beer-cap-${id}`, color: look.cap, roughness: 0.38, metalness: 0.75}));
  const lab = new THREE.Mesh(labelGeometry(id), labelMaterial());
  glass.name = 'beer-glass';
  cap.name = 'beer-cap';
  lab.name = 'beer-label';
  g.add(glass, lab, cap);
  return g;
}

/** Every beer has a bottle (tests / warm-up). */
export const BEER_MODEL_IDS: readonly BeerId[] = BEER_IDS;

/** Tests / previews: drop the cached geometry / materials (the loaded texture stays). */
export function resetBeerModel(): void {
  for (const x of Object.values(geoCache)) x.dispose();
  for (const x of Object.values(matCache)) x.dispose();
  geoCache = {};
  matCache = {};
  label.mat = null;
}
