// Task track3-eaton-centre-20261031 (lane PACKAGE): level-scoped GPU resources. Textures loaded for ONE logical level (e.g. the
// mall's terrazzo / shop-finish / signage files under assets/textures/mall/) and anything a level's builders create for that level
// alone (canvas textures, materials) are registered here under the level and released when the run moves to another level — so
// the resident set follows the current level instead of growing with every level visited (assets/levelAssets.ts has the full
// loading model). Use it from a section preload (Game.sectionPreloads: `await game.levelResources.load('mall', url, spec)`) and read
// synchronously while building (`get`). Another level's level-only file is refused (null), never downloaded or decoded.
//
// Release timing (Game.buildSection, right after the old world left the scene): textures are disposed at once (they hold no
// shader programs), owned resources go through the game's retire queue (after the new level's warm-up), matching how
// leaveSection defers GPU releases so programs shared with the next level are not rebuilt.

import * as THREE from 'three';
import {assetUrl} from './loader';
import {assetAllowedIn} from './levelAssets';

export interface LevelTextureSpec {
  /** Colour texture (sRGB) vs data (normal / ORM). */
  srgb: boolean;
  /** Tileable: true = repeat on both axes, 's' = repeat on S only (a skyline strip), false = clamp. */
  repeat: boolean | 's';
  anisotropy?: number;
}

type Disposable = {dispose(): void};
type TextureLoad = (url: string) => Promise<THREE.Texture>;

export class LevelResources {
  private readonly pending = new Map<string, Map<string, Promise<THREE.Texture | null>>>();
  private readonly textures = new Map<string, Map<string, THREE.Texture>>();
  private readonly owned = new Map<string, Set<Disposable>>();
  /** Set once a level is built (Game.buildSection), cleared when the next level is prepared: a load while sealed counts as `late`. */
  sealed = false;
  readonly stats = {loaded: 0, failed: 0, refused: 0, released: 0, late: 0};

  constructor(private readonly loadTexture: TextureLoad = url => new THREE.TextureLoader().loadAsync(assetUrl(url))) {}

  /** Loads (once per level) a texture file for `level`; null when it is another level's file or on any failure. Never throws. */
  load(level: string, url: string, spec: LevelTextureSpec): Promise<THREE.Texture | null> {
    if (!assetAllowedIn(level, url)) {
      this.stats.refused++;
      console.warn(`Level ${level} asked for another level's texture (refused): ${url}`);
      return Promise.resolve(null);
    }
    let per = this.pending.get(level);
    if (!per) this.pending.set(level, (per = new Map()));
    const cached = per.get(url);
    if (cached) return cached;
    if (this.sealed) { this.stats.late++; console.warn(`Level texture fetched mid-level (not behind a loading screen): ${url}`); }
    const p: Promise<THREE.Texture | null> = this.loadTexture(url).then(t => {
      if (this.pending.get(level)?.get(url) !== p) { t.dispose(); return null; } // the level was released meanwhile
      t.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = spec.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.wrapT = spec.repeat === true ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = spec.anisotropy ?? 4;
      let ready = this.textures.get(level);
      if (!ready) this.textures.set(level, (ready = new Map()));
      ready.set(url, t);
      this.stats.loaded++;
      return t;
    }, () => { this.stats.failed++; return null; });
    per.set(url, p);
    return p;
  }

  /** A texture `load` already resolved for `level` (synchronous builder read), else undefined. */
  get(level: string, url: string): THREE.Texture | undefined {
    return this.textures.get(level)?.get(url);
  }

  /** Registers a GPU resource made for `level` alone (canvas texture, material, geometry); released with the level. Returns it. */
  own<T extends Disposable>(level: string, resource: T): T {
    let set = this.owned.get(level);
    if (!set) this.owned.set(level, (set = new Set()));
    set.add(resource);
    return resource;
  }

  /**
   * Releases every level other than `level`: textures now, owned resources through `retire` (default: now). Returns the number
   * of released resources. Same level again (Retry / NewGame in the same level): nothing is released.
   */
  retainOnly(level: string, retire: (fn: () => void) => void = fn => fn()): number {
    let n = 0;
    for (const lv of [...new Set([...this.pending.keys(), ...this.textures.keys(), ...this.owned.keys()])]) {
      if (lv === level) continue;
      for (const t of this.textures.get(lv)?.values() ?? []) { t.dispose(); n++; }
      const owned = [...(this.owned.get(lv) ?? [])];
      if (owned.length) retire(() => { for (const r of owned) { try { r.dispose(); } catch (err) { console.warn('Releasing a level resource failed', err); } } });
      n += owned.length;
      this.pending.delete(lv);
      this.textures.delete(lv);
      this.owned.delete(lv);
    }
    this.stats.released += n;
    return n;
  }

  /** Resident resources per level (QA / tests). */
  summary(): Record<string, {textures: number; owned: number}> {
    const out: Record<string, {textures: number; owned: number}> = {};
    for (const lv of new Set([...this.textures.keys(), ...this.owned.keys()])) out[lv] = {textures: this.textures.get(lv)?.size ?? 0, owned: this.owned.get(lv)?.size ?? 0};
    return out;
  }
}
