// Iteration 16 (lane TOWER): QA hooks for short, bounded spot checks of the office tower (spread into window.__LL by
// qa.ts). Nothing here bypasses the gameplay rules: rides / stairs go through the real panel / door handlers and RUN's
// travel; the "go" helpers only place the player (like a teleport) and aim the view.

import type {TowerRuntime} from './towerRuntime';
import {floorLabel} from './towerShared';

interface QaGame {
  tower: TowerRuntime;
  player: {x: number; z: number; y: number; yaw: number; pitch: number; eye: number};
  camera: {updateMatrixWorld(force?: boolean): void};
}

/** Face (x, y, z) from the player's eye (camera convention: forward = (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch)). */
function face(g: QaGame, x: number, y: number, z: number): void {
  const p = g.player, eyeY = p.y + 1.62;
  const dx = x - p.x, dz = z - p.z, dy = y - eyeY;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

export function towerQaApi(game: unknown) {
  const g = game as QaGame;
  const rt = () => g.tower;
  return {
    /** Office tower state: floor, elevator (door 0..1, phase, target, rides), stair doors, windows, exterior, requests. */
    tower: () => {
      const s = rt().section;
      if (!s) return {office: false, requests: rt().requests.length};
      const e = s.elevator, ex = s.exterior;
      return {
        office: true, floor: s.info.floor, floorLabel: floorLabel(s.info.floor), floors: s.info.floors, baseY: s.info.baseY, groundY: s.info.groundY,
        elevator: e ? {door: +e.logic.door.toFixed(3), state: e.logic.state, phase: e.logic.phase, target: e.logic.target, rides: e.logic.rides, cab: e.plan.info.cab, depth: e.plan.gate.depth} : null,
        stairDoors: s.stairs?.plans.map(p => ({x: p.x, z: p.z, choices: p.choices})) ?? [],
        windows: s.windows ? {spans: s.windows.plans.length, panes: s.windows.plans.reduce((n, p) => n + p.panes.length, 0), glassMeshes: s.windows.view.glass.length} : null,
        exterior: ex ? {visible: ex.view.root.visible, tris: ex.view.tris, instanced: ex.view.instanced.length, models: ex.view.used, buildings: ex.plan.buildings.length, props: ex.plan.props.length} : null,
        target: rt().target?.kind ?? null, prompt: rt().prompt, listOpen: rt().choice.isOpen,
        requests: rt().requests.map(r => ({to: `${r.to.level}:${r.to.section}`, arrival: r.arrival.kind, floor: r.arrival.floor})),
      };
    },
    /** Stand in front of the call panel (outside), facing it. */
    towerGoCall: () => {
      const e = rt().section?.elevator;
      if (!e) return false;
      const c = e.plan.info.callPanel, [nx, nz] = e.plan.callN;
      g.player.x = c.x + nx * 0.9; g.player.z = c.z + nz * 0.9;
      face(g, c.x, c.y, c.z);
      return true;
    },
    /** Stand in the cab, facing the floor panel. */
    towerGoCab: () => {
      const e = rt().section?.elevator;
      if (!e) return false;
      const cab = e.plan.info.cab, p = e.plan.info.panel;
      g.player.x = (cab.x0 + cab.x1) / 2; g.player.z = (cab.z0 + cab.z1) / 2;
      face(g, p.x, p.y, p.z);
      return true;
    },
    /** Stand in front of the stairwell door, facing it. */
    towerGoStairs: () => {
      const d = rt().section?.stairs?.plans[0];
      if (!d) return false;
      g.player.x = d.x + d.n[0] * 1.0; g.player.z = d.z + d.n[1] * 1.0;
      face(g, d.x, d.y + 1.2, d.z);
      return true;
    },
    /** Press E on what the crosshair targets (panel / call / stair door), as the game's E does. */
    towerInteract: () => rt().interact(),
    /** In the cab: pick a floor from the panel list ('open' = open doors). */
    towerPick: (floor: number | 'open') => rt().panelPick(floor),
  };
}
