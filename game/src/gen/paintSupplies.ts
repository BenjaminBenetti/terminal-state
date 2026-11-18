import type {StationLayout} from './stationTypes';
import {hashString} from '../core/rng';
import {CAN_IDS, isSprayCan} from '../items/sprayPaint';
import {marketStandOk} from './market/spots';
import type {MarketStall} from './market/marketTypes';

/** Append to the generated list. The ordinary pickup memory replaces the whole list on a revisit. */
export function placePaintFinds(layout: StationLayout): void {
  if (layout.market || layout.pickups.some(p => isSprayCan(p.itemId))) return;
  const candidates = layout.props.filter(p => !p.cargo && (p.kind === 'campTable' || p.kind === 'crate'));
  const seed = hashString('spray-can-find', layout.seed);
  for (let i=0; i<candidates.length; i++) {
    const p = candidates[(seed+i) % candidates.length], y = p.y+p.h;
    if (layout.props.some(q => q !== p && q.area===p.area && q.y<y+.23 && q.y+q.h>y+.01
      && Math.abs(q.x-p.x)<q.hx+.05 && Math.abs(q.z-p.z)<q.hz+.05)) continue;
    if (layout.pickups.some(q => Math.abs(q.y-y)<.3 && Math.hypot(q.x-p.x,q.z-p.z)<.32)) continue;
    layout.pickups.push({itemId: CAN_IDS[(seed >>> 12) % CAN_IDS.length], count: 1, area: p.area, level: p.level, x: p.x, z: p.z, y});
    break;
  }
}

/** An unmanned pay counter on existing workshop furniture. No layout RNG, collision, NPC or holder changes. */
export function fitPaintShop(layout: StationLayout): void {
  const m = layout.market;
  if (!m || m.paintShop) return;
  for (const p of layout.props) {
    if (p.kind !== 'repairBench' || m.stalls.some(s => s.area === p.area)) continue;
    const level = p.level ?? 0, grid = layout.levels[level].grid;
    const nx = Math.sin(p.rot), nz = Math.cos(p.rot);
    // Front of the bench is local +Z. The top is at .90 m; the two-metre extent includes the pegboard.
    for (const distance of [1.15, 1.45, .85, 1.75]) for (const side of [0, -.42, .42]) {
      const x = p.x+distance*nx+side*nz, z = p.z+distance*nz-side*nx;
      if (!marketStandOk(grid,x,z) || Math.abs(grid.floorOf(grid.idx(...grid.cellOf(x,z)))-p.y)>.15) continue;
      const at = {x:p.x, y:p.y, z:p.z, level};
      const stall: MarketStall = {id:'paint', name:'Colour Works — spray paint', area:p.area,
        counter:{...at,x0:p.x-p.hx,x1:p.x+p.hx,z0:p.z-p.hz,z1:p.z+p.hz},
        front:{...at,x,z}, trader:{...at,yaw:p.rot},
        displays:[{...at,x:p.x+.235*nx,z:p.z+.235*nz,y:p.y+.901, yaw:p.rot, w:1.40,d:.115,clear:.32}]};
      m.paintShop = stall;
      layout.signs.push({kind:'info',text:'COLOUR WORKS · SPRAY PAINT',area:p.area,level,
        x:p.x-.20*nx,z:p.z-.20*nz,y:p.y+1.61,rot:p.rot,w:1.48,h:.30,lit:.48,
        style:{bg:0x163e42,fg:0xffecd1,accent:0xff8129,font:'condensed'}});
      return;
    }
  }
}
