import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNMENT_ORDER,
  ROTATION_SCHEMA_VERSION,
  normalizeAssignmentCycle,
  migrateAssignmentCycleIfNeeded,
  pickNextAssignee,
  pickNextAssignees,
  sortChoresDueForAssignment,
  assignDueChoresInOrder,
  applyHouseholdOperation
} from "../assignment-rotation.js";

describe("pickNextAssignee sequence", () => {
  it("first four picks are Moutasim, Dhruv, Dagi, Issac", () => {
    const { assignees } = pickNextAssignees({ nextIndex: 0, schemaVersion: ROTATION_SCHEMA_VERSION }, 4);
    assert.deepEqual(assignees, ["Moutasim", "Dhruv", "Dagi", "Issac"]);
  });

  it("picks five through eight repeat the same order", () => {
    const { assignees } = pickNextAssignees({ nextIndex: 0, schemaVersion: ROTATION_SCHEMA_VERSION }, 8);
    assert.deepEqual(assignees.slice(4, 8), ["Moutasim", "Dhruv", "Dagi", "Issac"]);
  });
});

describe("deletion does not alter nextIndex", () => {
  it("deleteAllChores preserves assignmentCycle pointer", () => {
    const state = {
      chores: [{ id: "1", assignee: "Issac", status: "completed" }],
      assignmentCycle: { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 2 }
    };
    const next = applyHouseholdOperation(state, "deleteAllChores");
    assert.equal(next.chores.length, 0);
    assert.deepEqual(next.assignmentCycle, { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 2 });
  });
});

describe("batch delayed assignment order", () => {
  it("four pending chores get four names in creation order", () => {
    const now = 1_000_000;
    const chores = [
      { id: "c", createdAt: 300, assignAt: 0 },
      { id: "a", createdAt: 100, assignAt: 0 },
      { id: "d", createdAt: 400, assignAt: 0 },
      { id: "b", createdAt: 200, assignAt: 0 }
    ];
    assignDueChoresInOrder(
      chores,
      { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 0 },
      now,
      true
    );
    const byCreation = [...chores].sort((a, b) => a.createdAt - b.createdAt);
    assert.deepEqual(
      byCreation.map(c => c.assignee),
      ["Moutasim", "Dhruv", "Dagi", "Issac"]
    );
  });
});

describe("migrateAssignmentCycleIfNeeded", () => {
  it("legacy state migrates once to Moutasim (nextIndex 0)", () => {
    const { cycle, migrated } = migrateAssignmentCycleIfNeeded({ nextIndex: 3, assignedThisCycle: ["x"] });
    assert.equal(migrated, true);
    assert.equal(cycle.nextIndex, 0);
    assert.equal(cycle.schemaVersion, ROTATION_SCHEMA_VERSION);
  });

  it("already-versioned state is preserved", () => {
    const { cycle, migrated } = migrateAssignmentCycleIfNeeded({
      schemaVersion: ROTATION_SCHEMA_VERSION,
      nextIndex: 2
    });
    assert.equal(migrated, false);
    assert.equal(cycle.nextIndex, 2);
  });
});

describe("simulated concurrent clients", () => {
  it("sequential addImmediate from shared latest state does not skip or duplicate", () => {
    let state = {
      chores: [],
      assignmentCycle: { schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 0 }
    };
    const assignees = [];
    for (let i = 0; i < 5; i++) {
      state = applyHouseholdOperation(state, "addImmediate", {
        description: `Chore ${i}`,
        category: "Kitchen",
        id: String(i),
        createdAt: i
      });
      assignees.push(state.chores[state.chores.length - 1].assignee);
    }
    assert.deepEqual(assignees, ["Moutasim", "Dhruv", "Dagi", "Issac", "Moutasim"]);
  });
});

describe("normalizeAssignmentCycle", () => {
  it("wraps nextIndex into valid range", () => {
    const c = normalizeAssignmentCycle({ schemaVersion: ROTATION_SCHEMA_VERSION, nextIndex: 5 });
    assert.equal(c.nextIndex, 1);
    assert.equal(ASSIGNMENT_ORDER[c.nextIndex], "Dhruv");
  });
});
