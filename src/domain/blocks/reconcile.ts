/**
 * Plan → Actual reconciliation. Plan blocks appear as ghosts in the Actual lane until
 * confirmed (linked actual blocks are created) or skipped.
 */
import { del, put } from "../changes";
import type {
  Block,
  ChangeSet,
  Env,
  Ghost,
  LocalDate,
  Minute,
  Now,
  PlanState,
} from "../types";
import { subtract, type Interval } from "./intervals";

/** Confirmed pieces shorter than this are dropped. */
export const MIN_PIECE_MINUTES = 5;

/** Fields a user can edit on a block (or apply to a ghost). */
export type BlockPatch = Partial<
  Pick<Block, "startMinute" | "endMinute" | "title" | "goalId" | "notes">
>;

/** True once the wall-clock moment (day, minute) is at or before `now`. */
export function isPast(day: LocalDate, minute: Minute, now: Now): boolean {
  return day < now.day || (day === now.day && minute <= now.minute);
}

/** Actual blocks linked to each plan block id. */
export function linksByPlan(blocks: readonly Block[]): Map<string, Block[]> {
  const map = new Map<string, Block[]>();
  for (const b of blocks) {
    if (b.layer !== "actual" || !b.planBlockId) continue;
    const list = map.get(b.planBlockId);
    if (list) list.push(b);
    else map.set(b.planBlockId, [b]);
  }
  return map;
}

export function ghostOf(plan: Block): Ghost {
  return {
    planBlockId: plan.id,
    day: plan.day,
    startMinute: plan.startMinute,
    endMinute: plan.endMinute,
    title: plan.title,
    goalId: plan.goalId,
  };
}

/** Every plan block that is not skipped and has no linked actual block. */
export function ghostsOf(blocks: readonly Block[]): Ghost[] {
  const links = linksByPlan(blocks);
  return blocks
    .filter((b) => b.layer === "plan" && !b.skipped && !links.has(b.id))
    .map(ghostOf)
    .sort((a, b) =>
      a.day < b.day ? -1 : a.day > b.day ? 1 : a.startMinute - b.startMinute,
    );
}

/**
 * - skipped: the plan block is marked skipped
 * - done: exactly one linked actual with the same start, end and goal
 * - adjusted: linked actual block(s) that differ from the plan
 * - unconfirmed: a ghost whose time has passed (its end is at or before now)
 * - pending: anything else
 */
export function planState(
  plan: Block,
  linked: readonly Block[],
  now: Now,
): PlanState {
  if (plan.skipped) return "skipped";
  if (linked.length === 1) {
    const a = linked[0]!;
    if (
      a.startMinute === plan.startMinute &&
      a.endMinute === plan.endMinute &&
      a.goalId === plan.goalId
    )
      return "done";
  }
  if (linked.length > 0) return "adjusted";
  return isPast(plan.day, plan.endMinute, now) ? "unconfirmed" : "pending";
}

/** `planState` for every plan block in `blocks`, keyed by plan id. */
export function planStates(
  blocks: readonly Block[],
  now: Now,
): Map<string, PlanState> {
  const links = linksByPlan(blocks);
  const out = new Map<string, PlanState>();
  for (const b of blocks)
    if (b.layer === "plan")
      out.set(b.id, planState(b, links.get(b.id) ?? [], now));
  return out;
}

/** Actual lanes of days after today are read-only. */
export function isActualReadOnly(day: LocalDate, now: Now): boolean {
  return day > now.day;
}

// ---------------------------------------------------------------------------
// Mutations (each returns a self-contained ChangeSet)
// ---------------------------------------------------------------------------

/** New block row; plan blocks never carry a link, actual blocks are never skipped. */
export function createBlock(
  fields: Pick<Block, "day" | "layer" | "startMinute" | "endMinute"> &
    Partial<Pick<Block, "title" | "goalId" | "notes" | "planBlockId">>,
  env: Env,
): { block: Block; changes: ChangeSet } {
  const t = env.nowMs();
  const block: Block = {
    id: env.newId(),
    day: fields.day,
    layer: fields.layer,
    startMinute: fields.startMinute,
    endMinute: fields.endMinute,
    title: fields.title ?? "",
    goalId: fields.goalId ?? null,
    notes: fields.notes ?? "",
    planBlockId:
      fields.layer === "actual" ? (fields.planBlockId ?? null) : null,
    skipped: false,
    createdAt: t,
    updatedAt: t,
  };
  return { block, changes: [put("blocks", block)] };
}

function touched(block: Block, patch: Partial<Block>, env: Env): Block {
  return { ...block, ...patch, updatedAt: env.nowMs() };
}

/** Edits times/title/goal/notes in place (links are kept). */
export function updateBlock(
  block: Block,
  patch: BlockPatch,
  env: Env,
): ChangeSet {
  return [put("blocks", touched(block, patch, env))];
}

const toInterval = (b: {
  startMinute: number;
  endMinute: number;
}): Interval => ({
  start: b.startMinute,
  end: b.endMinute,
});

function actualsOn(day: LocalDate, blocks: readonly Block[]): Block[] {
  return blocks.filter((b) => b.layer === "actual" && b.day === day);
}

function isGhost(plan: Block, blocks: readonly Block[]): boolean {
  return (
    plan.layer === "plan" &&
    !plan.skipped &&
    !blocks.some((b) => b.layer === "actual" && b.planBlockId === plan.id)
  );
}

/** Confirms `plan` against the given occupied intervals; returns the changes and created blocks. */
function confirmAgainst(
  plan: Block,
  occupied: readonly Interval[],
  env: Env,
): { changes: ChangeSet; created: Block[] } {
  const pieces = subtract(toInterval(plan), occupied).filter(
    (p) => p.end - p.start >= MIN_PIECE_MINUTES,
  );
  if (pieces.length === 0)
    return {
      changes: [put("blocks", touched(plan, { skipped: true }, env))],
      created: [],
    };
  const changes: ChangeSet = [];
  const created: Block[] = [];
  for (const p of pieces) {
    const { block, changes: c } = createBlock(
      {
        day: plan.day,
        layer: "actual",
        startMinute: p.start,
        endMinute: p.end,
        title: plan.title,
        goalId: plan.goalId,
        notes: plan.notes,
        planBlockId: plan.id,
      },
      env,
    );
    changes.push(...c);
    created.push(block);
  }
  return { changes, created };
}

/**
 * Confirms a ghost: the plan interval minus every actual block of that day becomes linked
 * actual blocks (pieces < 5 min dropped). Nothing left → the plan is marked skipped.
 * No-op if `plan` is not currently a ghost (skipped or already linked).
 */
export function confirmGhost(
  plan: Block,
  blocks: readonly Block[],
  env: Env,
): ChangeSet {
  if (!isGhost(plan, blocks)) return [];
  return confirmAgainst(plan, actualsOn(plan.day, blocks).map(toInterval), env)
    .changes;
}

/** Drag/resize/edit of a ghost: one linked actual block = the ghost with `patch` applied. */
export function materializeGhost(
  plan: Block,
  patch: BlockPatch,
  env: Env,
): { block: Block; changes: ChangeSet } {
  return createBlock(
    {
      day: plan.day,
      layer: "actual",
      startMinute: patch.startMinute ?? plan.startMinute,
      endMinute: patch.endMinute ?? plan.endMinute,
      title: patch.title ?? plan.title,
      goalId: patch.goalId !== undefined ? patch.goalId : plan.goalId,
      notes: patch.notes ?? plan.notes,
      planBlockId: plan.id,
    },
    env,
  );
}

/** Marks a plan block as not done. */
export function skipPlan(plan: Block, env: Env): ChangeSet {
  return plan.skipped
    ? []
    : [put("blocks", touched(plan, { skipped: true }, env))];
}

/** Clears the skipped flag (the ghost reappears if the plan has no linked actuals). */
export function restorePlan(plan: Block, env: Env): ChangeSet {
  return plan.skipped
    ? [put("blocks", touched(plan, { skipped: false }, env))]
    : [];
}

/** Puts that unlink every actual block linked to `planId`. */
function unlinkActuals(
  planId: string,
  blocks: readonly Block[],
  env: Env,
  exceptId?: string,
): ChangeSet {
  return blocks
    .filter(
      (b) =>
        b.layer === "actual" && b.planBlockId === planId && b.id !== exceptId,
    )
    .map((b) => put("blocks", touched(b, { planBlockId: null }, env)));
}

/** If `actual` is the last link of its plan block, the put that marks that plan skipped. */
function skipIfLastLink(
  actual: Block,
  blocks: readonly Block[],
  env: Env,
): ChangeSet {
  const planId = actual.planBlockId;
  if (actual.layer !== "actual" || !planId) return [];
  const others = blocks.some(
    (b) =>
      b.layer === "actual" && b.planBlockId === planId && b.id !== actual.id,
  );
  if (others) return [];
  const plan = blocks.find((b) => b.id === planId && b.layer === "plan");
  return plan && !plan.skipped
    ? [put("blocks", touched(plan, { skipped: true }, env))]
    : [];
}

/**
 * Deletes a block. A plan block's linked actuals are unlinked; deleting the last linked
 * actual of a plan block marks that plan skipped so its ghost does not come back.
 */
export function deleteBlock(
  block: Block,
  blocks: readonly Block[],
  env: Env,
): ChangeSet {
  const changes: ChangeSet = [del("blocks", block.id)];
  if (block.layer === "plan")
    changes.push(...unlinkActuals(block.id, blocks, env));
  else changes.push(...skipIfLastLink(block, blocks, env));
  return changes;
}

/**
 * Moves a block to a new time/day. Same-day moves keep links; a move to another day
 * unlinks the pair (as with delete, losing the last link marks the plan skipped).
 * With `copy`, a new unlinked block is created and the original is untouched.
 */
export function moveBlock(
  block: Block,
  to: { day: LocalDate; startMinute: number; endMinute: number },
  blocks: readonly Block[],
  env: Env,
  opts?: { copy?: boolean },
): { block: Block; changes: ChangeSet } {
  if (opts?.copy) {
    return createBlock(
      {
        ...to,
        layer: block.layer,
        title: block.title,
        goalId: block.goalId,
        notes: block.notes,
        planBlockId: null,
      },
      env,
    );
  }
  if (to.day === block.day) {
    const moved = touched(
      block,
      { startMinute: to.startMinute, endMinute: to.endMinute },
      env,
    );
    return { block: moved, changes: [put("blocks", moved)] };
  }
  if (block.layer === "plan") {
    const moved = touched(block, to, env);
    return {
      block: moved,
      changes: [put("blocks", moved), ...unlinkActuals(block.id, blocks, env)],
    };
  }
  const moved = touched(block, { ...to, planBlockId: null }, env);
  return {
    block: moved,
    changes: [put("blocks", moved), ...skipIfLastLink(block, blocks, env)],
  };
}

/**
 * Confirms every past ghost of `day` (end at or before now) as one ChangeSet, in start
 * order; actual blocks created by earlier confirms are subtracted from later ones.
 */
export function confirmRestOfDay(
  day: LocalDate,
  blocks: readonly Block[],
  now: Now,
  env: Env,
): ChangeSet {
  const dayBlocks = blocks.filter((b) => b.day === day);
  const plans = new Map(
    dayBlocks.filter((b) => b.layer === "plan").map((b) => [b.id, b]),
  );
  const occupied = actualsOn(day, dayBlocks).map(toInterval);
  const changes: ChangeSet = [];
  for (const g of ghostsOf(dayBlocks)) {
    const plan = plans.get(g.planBlockId);
    if (!plan || !isPast(day, plan.endMinute, now)) continue;
    const r = confirmAgainst(plan, occupied, env);
    changes.push(...r.changes);
    occupied.push(...r.created.map(toInterval));
  }
  return changes;
}

/** Copies `fromDay`'s plan blocks (title, goal, notes, times) to `toDay` with new ids. */
export function copyPlan(
  fromDay: LocalDate,
  toDay: LocalDate,
  blocks: readonly Block[],
  env: Env,
): ChangeSet {
  return blocks
    .filter((b) => b.layer === "plan" && b.day === fromDay)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
    .flatMap(
      (b) =>
        createBlock(
          {
            day: toDay,
            layer: "plan",
            startMinute: b.startMinute,
            endMinute: b.endMinute,
            title: b.title,
            goalId: b.goalId,
            notes: b.notes,
          },
          env,
        ).changes,
    );
}
