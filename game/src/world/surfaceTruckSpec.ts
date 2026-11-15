/** Measured normalized supplied military truck; same arcade physics as the prize car. */
import type {CarSpec} from './skywaysCarSpec';

export const SURFACE_TRUCK_LANE = 'surface.truck';
export const SURFACE_TRUCK_SPEC: CarSpec = {
  url: 'assets/models/surface-military-truck.glb',
  proceduralCab: true,
  length: 6.8, width: 2.33, height: 2.92,
  clearance: 3.85,
  wheelBase: 3.46, track: 1.92,
  wheels: [
    {x: -0.96, y: 0.52, z: -2.18, r: 0.52}, {x: 0.96, y: 0.52, z: -2.18, r: 0.52},
    {x: -0.96, y: 0.52, z: -1.02, r: 0.52}, {x: 0.96, y: 0.52, z: -1.02, r: 0.52},
    {x: -0.96, y: 0.52, z: 1.36, r: 0.52}, {x: 0.96, y: 0.52, z: 1.36, r: 0.52},
    {x: -0.96, y: 0.52, z: 2.36, r: 0.52}, {x: 0.96, y: 0.52, z: 2.36, r: 0.52},
  ],
  eye: {x: -0.47, y: 1.81, z: -2.63},
  wheelCentre: {x: -0.47, y: 1.5, z: -3.03},
  exits: {left: {x: -1.85, z: -2.63}, right: {x: 1.85, z: -2.63}},
  circles: [{z: -2.25, r: 1.08}, {z: -0.73, r: 1.12}, {z: 0.8, r: 1.12}, {z: 2.25, r: 1.08}],
  interior: {x0: -0.96, x1: 0.96, y0: 0.77, y1: 2.07, z0: -3.22, z1: -2.06},
  cowl: {y: 1.52, z: -3.22}, header: {y: 2.07, z: -3.22},
  lamp: {y: 1.03, z: -3.47},
};

/** The three real stores share the truck record's 16 slots; no copied display inventory. */
export const TRUCK_COMPARTMENTS = [
  {id: 'cab', name: 'Cab locker', slots: 4, start: 0, x: 1.16, y: 1.22, z: -2.63},
  {id: 'tools', name: 'Side tool locker', slots: 4, start: 4, x: -1.16, y: 0.95, z: 0.6},
  {id: 'bed', name: 'Rear cargo locker', slots: 8, start: 8, x: 0, y: 1.1, z: 3.4},
] as const;
export const TRUCK_TIE_POINTS = [
  {x: -0.56, y: 3.01, z: 0.4}, {x: 0.56, y: 3.01, z: 0.4},
  {x: -0.56, y: 3.01, z: 1.68}, {x: 0.56, y: 3.01, z: 1.68},
] as const;
