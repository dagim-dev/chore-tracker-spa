/** Fixed rotation when assigning chores (repeats after the last name). */
export const ASSIGNMENT_ORDER = ["Moutasim", "Dhruv", "Dagi", "Issac"];

export const ROTATION_SCHEMA_VERSION = 2;

/**
 * @typedef {{ nextIndex: number, schemaVersion?: number }} AssignmentCycle
 */

/**
 * @param {unknown} raw
 * @returns {AssignmentCycle}
 */
export function normalizeAssignmentCycle(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    raw.schemaVersion === ROTATION_SCHEMA_VERSION &&
    typeof raw.nextIndex === "number" &&
    Number.isFinite(raw.nextIndex)
  ) {
    const len = ASSIGNMENT_ORDER.length;
    return {
      schemaVersion: ROTATION_SCHEMA_VERSION,
      nextIndex: ((raw.nextIndex % len) + len) % len
    };
  }

  return {
    schemaVersion: ROTATION_SCHEMA_VERSION,
    nextIndex: 0
  };
}

/**
 * One-time migration: legacy or missing version → fresh pointer at Moutasim.
 * @param {unknown} raw
 * @returns {{ cycle: AssignmentCycle, migrated: boolean }}
 */
export function migrateAssignmentCycleIfNeeded(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    raw.schemaVersion === ROTATION_SCHEMA_VERSION &&
    typeof raw.nextIndex === "number" &&
    Number.isFinite(raw.nextIndex)
  ) {
    return { cycle: normalizeAssignmentCycle(raw), migrated: false };
  }

  return {
    cycle: { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 0 },
    migrated: true
  };
}

/**
 * @param {AssignmentCycle} cycle
 * @returns {{ assignee: string, cycle: AssignmentCycle }}
 */
export function pickNextAssignee(cycle) {
  const normalized = normalizeAssignmentCycle(cycle);
  const len = ASSIGNMENT_ORDER.length;
  const index = normalized.nextIndex;
  const assignee = ASSIGNMENT_ORDER[index];
  const nextIndex = (index + 1) % len;
  return {
    assignee,
    cycle: { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex }
  };
}

/**
 * @param {AssignmentCycle} cycle
 * @param {number} count
 * @returns {{ assignees: string[], cycle: AssignmentCycle }}
 */
export function pickNextAssignees(cycle, count) {
  let current = normalizeAssignmentCycle(cycle);
  const assignees = [];
  for (let i = 0; i < count; i++) {
    const result = pickNextAssignee(current);
    assignees.push(result.assignee);
    current = result.cycle;
  }
  return { assignees, cycle: current };
}

/**
 * Deterministic order for pending chores (delayed mode / batch assign).
 * @param {Array<{ id: string, createdAt?: number, assignAt?: number }>} chores
 * @param {number} now
 * @param {boolean} delayEnabled
 */
export function sortChoresDueForAssignment(chores, now, delayEnabled) {
  const due = chores.filter(chore => {
    if (chore.assignee) return false;
    if (!delayEnabled) return true;
    return (chore.assignAt ?? 0) <= now;
  });

  due.sort((a, b) => {
    const ca = a.createdAt ?? 0;
    const cb = b.createdAt ?? 0;
    if (ca !== cb) return ca - cb;
    return String(a.id).localeCompare(String(b.id));
  });

  return due;
}

/**
 * Assign each due chore in order; mutates chore objects in the array passed in `currentChores`.
 * @param {Array<Record<string, unknown>>} currentChores
 * @param {AssignmentCycle} cycle
 * @param {number} now
 * @param {boolean} delayEnabled
 * @returns {{ cycle: AssignmentCycle, assignedCount: number }}
 */
export function assignDueChoresInOrder(currentChores, cycle, now, delayEnabled) {
  const due = sortChoresDueForAssignment(currentChores, now, delayEnabled);
  let currentCycle = normalizeAssignmentCycle(cycle);
  let assignedCount = 0;

  for (const chore of due) {
    const result = pickNextAssignee(currentCycle);
    chore.assignee = result.assignee;
    chore.assignedAt = now;
    delete chore.assignAt;
    currentCycle = result.cycle;
    assignedCount += 1;
  }

  return { cycle: currentCycle, assignedCount };
}

/**
 * Simulates applying an operation against latest household state (for concurrency tests).
 * @typedef {'addImmediate' | 'assignDue' | 'deleteAllChores'} SimOp
 */

/**
 * @param {{ chores: Array<Record<string, unknown>>, assignmentCycle: AssignmentCycle }} state
 * @param {SimOp} op
 * @param {Record<string, unknown>} [payload]
 * @param {number} [now]
 * @param {boolean} [delayEnabled]
 */
export function applyHouseholdOperation(state, op, payload = {}, now = Date.now(), delayEnabled = false) {
  const chores = state.chores.map(c => ({ ...c }));
  let assignmentCycle = normalizeAssignmentCycle(state.assignmentCycle);

  if (op === "deleteAllChores") {
    return { chores: [], assignmentCycle };
  }

  if (op === "addImmediate") {
    const { description, category, id, createdAt } = payload;
    const result = pickNextAssignee(assignmentCycle);
    assignmentCycle = result.cycle;
    chores.push({
      id: id ?? String(chores.length),
      description,
      category,
      assignee: result.assignee,
      assignedAt: now,
      createdAt: createdAt ?? now,
      status: "in-progress"
    });
    return { chores, assignmentCycle };
  }

  if (op === "assignDue") {
    const { cycle, assignedCount } = assignDueChoresInOrder(
      chores,
      assignmentCycle,
      now,
      delayEnabled
    );
    if (assignedCount > 0) {
      assignmentCycle = cycle;
    }
    return { chores, assignmentCycle };
  }

  return { chores, assignmentCycle };
}
