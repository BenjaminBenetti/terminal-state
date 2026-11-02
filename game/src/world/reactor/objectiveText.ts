// Task reactor-surface-ending-20261102 (lane OBJECTIVES, user: "the objective text is to wordy, saying "core floor generator is jammed"
// and all that. Get rid of that, include only simple objective indication. The player will know its jammed when they try to start
// it."): THE Reactor's HUD objective, every string and the pure line builder in ONE place (world/reactor/restart.ts renders it into
// #reactor-objective; pure, no DOM / three.js).
// - Simple and concise: the current goal, then the four restart tasks in ROUTE order (power on tier 4, coolant in the pump hall, the
//   key and the rods in the control room: the key lies there, on the core floor), each ticked off when done, the current one marked.
// - No jam / mask paragraph. The jam is learnt at the generator (its stall, flashing fault lamp and short toast:
//   gen/reactor/gasJam.ts JAM_TEXT). The HUD air line (world/reactor/generators.ts zoneStatus) says when a zone is toxic.
// - Later stages (lane ENDING: the gas cleared, the external doors open …) plug in through ObjectiveInput.stage and keep their strings
//   here too (OBJECTIVE_TEXT), so the HUD wording stays in one file.

import {reactorTasks, type ReactorRunState, type ReactorTaskStatus} from './runState';

/** Every HUD objective string of the Reactor. */
export const OBJECTIVE_TEXT = {
  /** The goal until the rods are withdrawn (followed by the task line). */
  restart: 'Restart the reactor',
  /** The win sequence running (the core waking, the towers powering up). */
  waking: 'Reactor restarted — surface ventilation towers powering up',
  /** After the win sequence. */
  running: 'Reactor running · surface ventilation towers online',
  /** The task labels. */
  tasks: {power: 'Power', coolant: 'Coolant', key: 'Key', rods: 'Rods'},
} as const;

/** The restart tasks in route order: the tier-4 switchgear, the pump hall, then the control room (its key, then the rods). */
export const OBJECTIVE_TASK_ORDER = ['power', 'coolant', 'key', 'rods'] as const;
export type ObjectiveTaskId = typeof OBJECTIVE_TASK_ORDER[number];

/** The current task: the first one not done in route order (null: all done). It is always 'ready' (its prerequisites come earlier). */
export function currentTask(s: ReactorRunState): ObjectiveTaskId | null {
  const t = reactorTasks(s);
  return OBJECTIVE_TASK_ORDER.find(id => t[id] !== 'done') ?? null;
}

/** The compact task line ("✓ Power · ▸ Coolant · Key · Rods"): statuses as classes (done / ready / blocked), the current one `now`. */
export function taskLine(s: ReactorRunState): {tasks: ReturnType<typeof reactorTasks>; current: ObjectiveTaskId | null; html: string} {
  const tasks = reactorTasks(s), current = currentTask(s);
  const part = (id: ObjectiveTaskId, st: ReactorTaskStatus) => {
    const now = id === current;
    return `<span class="rt ${st}${now ? ' now' : ''}">${st === 'done' ? '✓ ' : now ? '▸ ' : ''}${OBJECTIVE_TEXT.tasks[id]}</span>`;
  };
  return {tasks, current, html: OBJECTIVE_TASK_ORDER.map(id => part(id, tasks[id])).join(' · ')};
}

export interface ObjectiveInput {
  state: ReactorRunState;
  /** The win sequence is still running (rods withdrawn, the towers powering up). */
  waking: boolean;
  /** The storey label shown under the line ('' = none). */
  tier: string;
  /** A later stage's line (lane ENDING), shown instead of the post-restart line; null / '' = none. */
  stage?: string | null;
}

/** The main objective line (HTML). */
export function objectiveLine(i: ObjectiveInput): string {
  const s = i.state;
  if (!s.restarted) return `${OBJECTIVE_TEXT.restart} — ${taskLine(s).html}`;
  if (i.stage) return i.stage;
  return i.waking ? OBJECTIVE_TEXT.waking : OBJECTIVE_TEXT.running;
}

/** The whole #reactor-objective markup: the line, then the storey label. Nothing else (no hazard / jam paragraphs). */
export function objectiveHtml(i: ObjectiveInput): string {
  return `<div>${objectiveLine(i)}</div>${i.tier ? `<div class="tier">${i.tier}</div>` : ''}`;
}
