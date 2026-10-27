// First-person body: WASD movement with acceleration, sprint/stamina, jump/crouch, collision, health.
//
// Vertical model (iteration 05, Lane T): `y` is the absolute feet height. Grounded feet follow the
// grid floor (`floorAt`: stairs are ramps, the track bed sits 1.15 m below the platform, an
// underpass far below); walking off a ledge (the platform edge) falls under gravity and lands
// without damage. Collision is height-aware: ledges more than STEP_UP above the feet are walls.
// Props stay solid columns at any jump height: there is no standing on props. Headroom comes from
// the grid's absolute per-cell ceiling (area ceilings, lintels, ceilings following flights).
// Rescue ladders: startClimb() runs a scripted climb (same path as zombies); Space/S lets go.

import {ceilingOver, moveCircle, type PropIndex} from '../core/physics';
import type {Grid} from '../gen/grid';
import {CLIMB, climbDuration, ladderClimbPath, sampleClimb, type ClimbPath, type Ladder, type Vec3} from '../gen/traversal';
import {CROUCH_KEYS} from './input';

export const WALK_SPEED = 3.4;
export const SPRINT_SPEED = 5.8;
export const AIM_SPEED = 2.1;
export const STAND_EYE = 1.62;
export const CROUCH_EYE = 1.02;
/** Crown of the head above the eyes; used for ceiling clearance. */
export const HEAD_ABOVE_EYE = 0.12;
export const CROUCH_SPEED_MULT = 0.5;
export const GRAVITY = 17;
export const JUMP_HEIGHT = 0.5;
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
/** Holding C longer than this turns the press into hold-to-crouch (stand on release). */
export const CROUCH_HOLD_TIME = 0.3;
const CROUCH_BLEND_TIME = 0.2;
const GROUND_ACCEL = 11;
const GROUND_DECEL = 13;
/** Air steering only (approaches the same capped target velocity: no air speed gain). */
const AIR_ACCEL = 1.8;
const LAND_DIP_TIME = 0.3;
/** Grounded feet stay on a floor that drops by at most this in one frame (stairs); more = falling. */
const SNAP_DOWN = 0.4;
/** Vertical distance between rung sounds while climbing (m). */
const RUNG = 0.28;

/** Weapon recoil multiplier for the current stance (camera kick and viewmodel kick). */
export function stanceRecoilMult(crouched: boolean): number {
  return crouched ? 0.7 : 1;
}
/** Spread (cone) multiplier for the current stance. */
export function stanceSpreadMult(crouched: boolean): number {
  return crouched ? 0.8 : 1;
}

/** The subset of Input the body reads (structural, so tests can drive it without a DOM). */
export interface MoveInput {
  down(code: string): boolean;
  hit(code: string): boolean;
  /** Incremented whenever input state is wiped (pause, pointer-lock loss, window blur). */
  readonly clears?: number;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class Player {
  x = 0;
  z = 0;
  /** Absolute feet height (world y; the floor under the player when grounded). */
  y = 0;
  vy = 0;
  grounded = true;
  yaw = 0;
  pitch = 0;
  vx = 0;
  vz = 0;
  hp = 100;
  readonly maxHp = 100;
  stamina = 100;
  alive = true;
  readonly radius = 0.3;
  /** Current world eye height: stance eye + jump height − landing dip. Drives the camera. */
  eye = STAND_EYE;
  /** Actual stance (weapon behaviour and speed follow this, not the camera). */
  crouched = false;
  /** 0 standing … 1 fully crouched (smoothed eye-height blend). */
  crouchBlend = 0;
  /** Wants to stand but the ceiling is too low; stands automatically once clear. */
  standBlocked = false;
  /** Landing camera dip currently applied (m, ≥ 0). */
  landDip = 0;
  sprinting = false;
  speed = 0;
  bobT = 0;
  // one-frame events (valid after update(); for audio/feedback wiring)
  justJumped = false;
  justLanded = false;
  /** Downward speed at touchdown (m/s) when justLanded. */
  landSpeed = 0;
  /** Stance flipped this frame (crouched or stood up). */
  stanceChanged = false;
  /** Ladder climb in progress (scripted path), or null. */
  climb: {ladder: Ladder; path: ClimbPath; t: number; lastRungY: number} | null = null;
  /** One-frame climb events: a hand/foot on a rung, the climb finished, the player let go. */
  justRung = false;
  justClimbed = false;
  justLetGo = false;
  private readonly climbPos: Vec3 = {x: 0, y: 0, z: 0};
  private wantCrouch = false;
  private crouchHeld = false;
  private crouchHoldT = 0;
  private clearsSeen = 0;
  private landT = LAND_DIP_TIME;
  private landAmp = 0;
  private sprintCd = 0;
  private stepPhase = 0;
  damageTaken = 0;

  spawn(x: number, z: number, yaw: number, y = 0): void {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.vx = this.vz = 0;
    this.y = y;
    this.vy = 0;
    this.climb = null;
    this.grounded = true;
    this.crouched = this.wantCrouch = this.crouchHeld = this.standBlocked = false;
    this.crouchBlend = 0;
    this.landDip = 0;
    this.landT = LAND_DIP_TIME;
    this.eye = STAND_EYE;
    this.hp = this.maxHp;
    this.stamina = 100;
    this.alive = true;
    this.sprinting = false;
    this.damageTaken = 0;
  }

  /** Eye height of the current (blended) stance, without jump or dip. */
  get stanceEye(): number {
    return STAND_EYE + (CROUCH_EYE - STAND_EYE) * ease(this.crouchBlend);
  }

  get climbing(): boolean {
    return this.climb !== null;
  }

  /** Start a scripted ladder climb (up from the track bed, or down from the platform edge). */
  startClimb(ladder: Ladder, up: boolean): void {
    if (this.climb || !this.alive) return;
    this.crouched = this.wantCrouch = this.crouchHeld = this.standBlocked = false;
    this.crouchBlend = 0;
    this.sprinting = false;
    this.vx = this.vz = this.vy = 0;
    this.climb = {ladder, path: ladderClimbPath(ladder, up, {x: this.x, y: this.y, z: this.z}, CLIMB.player), t: 0, lastRungY: this.y};
  }

  /** Let go of the ladder: fall from where the body is (always over the track bed or the platform). */
  letGo(): void {
    if (!this.climb) return;
    this.climb = null;
    this.grounded = false;
    this.vy = 0;
    this.justLetGo = true;
  }

  private updateClimb(dt: number, input: MoveInput, grid: Grid): void {
    const c = this.climb!;
    if (input.hit('Space') || input.hit('KeyS')) { this.letGo(); return; }
    c.t += dt;
    const seg = sampleClimb(c.path, c.t, this.climbPos);
    this.x = this.climbPos.x; this.y = this.climbPos.y; this.z = this.climbPos.z;
    if (seg === c.path.vertical && Math.abs(this.y - c.lastRungY) >= RUNG) { c.lastRungY = this.y; this.justRung = true; }
    if (c.t >= climbDuration(c.path)) {
      const end = c.path.pts[c.path.pts.length - 1];
      this.x = end.x; this.z = end.z;
      this.y = grid.floorAt(end.x, end.z);
      this.climb = null;
      this.grounded = true;
      this.justClimbed = true;
      this.justLanded = true;
      this.landSpeed = 0.8;
      this.landAmp = 0.02;
      this.landT = 0;
    }
  }

  /** Returns true when a footstep lands this frame. Jump/land/stance events are in the just* fields. */
  update(dt: number, input: MoveInput, grid: Grid, props: PropIndex | null, opts: {aiming: boolean; speedMult: number; canSprint: boolean}): boolean {
    this.justJumped = this.justLanded = this.stanceChanged = false;
    this.justRung = this.justClimbed = this.justLetGo = false;
    this.landSpeed = 0;
    if (this.climb) {
      this.updateClimb(dt, input, grid);
      if (this.climb || this.justClimbed) {
        this.speed = 0;
        this.landT = Math.min(LAND_DIP_TIME, this.landT + dt);
        this.landDip = this.landT < LAND_DIP_TIME ? this.landAmp * Math.sin(Math.PI * this.landT / LAND_DIP_TIME) : 0;
        this.eye = this.stanceEye + this.y - this.landDip;
        return false;
      }
    }
    let fx = 0, fz = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) fz += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const standHeadroom = ceilingOver(grid, this.x, this.z, this.radius) - this.y - STAND_EYE - HEAD_ABOVE_EYE;
    const canStand = standHeadroom >= -1e-4;

    // --- crouch input: tap C toggles; holding past CROUCH_HOLD_TIME stands on release -
    const clears = input.clears ?? 0;
    if (clears !== this.clearsSeen) {
      // Input was wiped (pause / pointer-lock loss / blur): a held crouch becomes a toggled one.
      this.clearsSeen = clears;
      this.crouchHeld = false;
    }
    if (CROUCH_KEYS.some(k => input.hit(k))) {
      this.wantCrouch = !this.wantCrouch;
      this.crouchHeld = this.wantCrouch;
      this.crouchHoldT = 0;
    } else if (this.crouchHeld) {
      if (CROUCH_KEYS.some(k => input.down(k))) this.crouchHoldT += dt;
      else {
        if (this.crouchHoldT > CROUCH_HOLD_TIME) this.wantCrouch = false;
        this.crouchHeld = false;
      }
    }
    const shiftHit = input.hit('ShiftLeft') || input.hit('ShiftRight');
    const shiftDown = input.down('ShiftLeft') || input.down('ShiftRight');
    // Space or a fresh Shift (moving forward, toggled crouch) stands up instead of jumping/sprinting.
    let standRequest = false;
    if (this.crouched && !this.crouchHeld && (input.hit('Space') || (shiftHit && fz < 0 && opts.canSprint))) {
      this.wantCrouch = false;
      standRequest = true;
    }
    if (this.grounded) {
      if (this.wantCrouch && !this.crouched) { this.crouched = true; this.stanceChanged = true; }
      else if (!this.wantCrouch && this.crouched && canStand) { this.crouched = false; this.stanceChanged = true; }
    }
    this.standBlocked = this.crouched && !this.wantCrouch && !canStand;

    // --- jump (standing, grounded; no double jump) -----------------------------------------------
    if (!standRequest && !this.crouched && this.grounded && standHeadroom > 0.05 && input.hit('Space')) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
      this.justJumped = true;
    }

    // --- sprint / horizontal movement ------------------------------------------------------------
    const wantsSprint = shiftDown && fz < 0 && opts.canSprint && !opts.aiming && !this.crouched;
    this.sprintCd = Math.max(0, this.sprintCd - dt);
    if (wantsSprint && this.stamina > (this.sprinting ? 0 : 15)) {
      this.sprinting = true;
      this.stamina = Math.max(0, this.stamina - 24 * dt);
      this.sprintCd = 0.9;
      if (this.stamina <= 0) this.sprinting = false;
    } else {
      this.sprinting = false;
      if (this.sprintCd <= 0) this.stamina = Math.min(100, this.stamina + 18 * dt);
    }
    const max = (this.sprinting ? SPRINT_SPEED : opts.aiming ? AIM_SPEED : WALK_SPEED) * (this.crouched ? CROUCH_SPEED_MULT : 1) * opts.speedMult;
    // camera-relative: forward is -Z rotated by yaw
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = fx * c + fz * s;
    const wz = -fx * s + fz * c;
    const accel = !this.grounded ? AIR_ACCEL : len > 0 ? GROUND_ACCEL : GROUND_DECEL;
    this.vx += (wx * max - this.vx) * Math.min(1, accel * dt);
    this.vz += (wz * max - this.vz) * Math.min(1, accel * dt);
    const [nx, nz] = moveCircle(grid, props, this.x, this.z, this.vx * dt, this.vz * dt, this.radius, this.y);
    // Velocity follows what actually happened (sliding along walls).
    if (dt > 0) { this.vx = (nx - this.x) / dt; this.vz = (nz - this.z) / dt; }
    this.x = nx; this.z = nz;
    this.speed = Math.hypot(this.vx, this.vz);

    // --- vertical: gravity, ceiling clamp, landing ------------------------------------------------
    const blendStep = dt / CROUCH_BLEND_TIME;
    this.crouchBlend += Math.max(-blendStep, Math.min(blendStep, (this.crouched ? 1 : 0) - this.crouchBlend));
    const ground = grid.floorAt(this.x, this.z);
    if (this.grounded) {
      // Feet follow stairs/ramps; walking off a ledge (platform edge) starts a fall.
      if (this.y - ground > SNAP_DOWN) { this.grounded = false; this.vy = 0; }
      else this.y = ground;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      const maxFeet = ceilingOver(grid, this.x, this.z, this.radius) - this.stanceEye - HEAD_ABOVE_EYE;
      if (this.y > maxFeet) { this.y = Math.max(ground, maxFeet); this.vy = Math.min(0, this.vy); }
      if (this.y <= ground) {
        this.landSpeed = Math.max(0, -this.vy);
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.justLanded = true;
        this.landAmp = Math.min(0.08, this.landSpeed * 0.016);
        this.landT = 0;
      }
    }
    this.landT = Math.min(LAND_DIP_TIME, this.landT + dt);
    this.landDip = this.landT < LAND_DIP_TIME ? this.landAmp * Math.sin(Math.PI * this.landT / LAND_DIP_TIME) : 0;
    this.eye = this.stanceEye + this.y - this.landDip;

    if (!this.grounded) return false;
    this.bobT += dt * this.speed * 2.1;
    const phase = Math.floor(this.bobT / Math.PI);
    const step = phase !== this.stepPhase && this.speed > 0.8;
    this.stepPhase = phase;
    return step;
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.damageTaken += amount;
    if (this.hp <= 0) this.alive = false;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }
}
