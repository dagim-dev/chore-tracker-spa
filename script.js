import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig, HOUSEHOLD_ID } from "./firebase-config.js";
import {
  normalizeAssignmentCycle,
  migrateAssignmentCycleIfNeeded as migrateRotationState,
  pickNextAssignee,
  assignDueChoresInOrder
} from "./assignment-rotation.js";

const ROOMMATES = ["Dagi", "Issac", "Dhruv", "Moutasim"];
const CATEGORIES = ["Kitchen", "Common Room", "Bathroom", "Other"];
const SUGGESTED_CHORES = [
  { description: "Empty Dehumidifier", category: "Kitchen" },
  { description: "Take Out Trash (from the house to the outside bin)", category: "Kitchen" },
  {
    description:
      "Take out trash (Roll the bin to the curb for collection day. Check dates posted for collection day on the fridge)",
    category: "Kitchen"
  },
  {
    description:
      "Clean kitchen counters and clear trash — Wipe down counters and remove anything that doesn’t belong (e.g. pizza boxes, empty takeout containers, food wrappers, used paper towels).",
    category: "Kitchen"
  },
  { description: "Vacuum the Common Room", category: "Common Room" },
  { description: "Clean Dishes", category: "Kitchen" },
  { description: "Vacuum Hallway", category: "Other" },
  { description: "Empty the Vacuum Cleaners", category: "Other" }
];
const STORAGE_KEY = "choreTrackerData";
const ASSIGNMENT_CYCLE_KEY = "choreTrackerAssignmentCycle";
const ASSIGNMENT_DELAY_ENABLED = false;
const ASSIGNMENT_DELAY_MS = 10 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

let chores = [];
let assignmentCycle = { nextIndex: 0 };
let activeFilter = "all";
let householdRef = null;
let db = null;
let assignmentTimerId = null;

function isFirebaseConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_");
}

function showSyncBanner(message, type = "error") {
  const banner = document.getElementById("syncBanner");
  banner.textContent = message;
  banner.className = `sync-banner ${type}`;
  banner.hidden = false;
}

function hideSyncBanner() {
  document.getElementById("syncBanner").hidden = true;
}

function readAssignmentCycle(raw) {
  const { cycle, migrated } = migrateRotationState(raw);
  return { cycle, migrated };
}

async function runHouseholdTransaction(updateFn) {
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(householdRef);
    if (!snap.exists()) return;

    const data = snap.data() || { chores: [] };
    const currentChores = (data.chores || []).map(chore => ({ ...chore }));
    const { cycle: assignmentCycle, migrated } = readAssignmentCycle(data.assignmentCycle);

    const result = updateFn({ currentChores, assignmentCycle, migrated });
    if (result === false) return;

    transaction.set(
      householdRef,
      { chores: currentChores, assignmentCycle },
      { merge: true }
    );
  });
}

async function ensureRotationSchemaMigrated() {
  if (!householdRef || !db) return;

  try {
    await runHouseholdTransaction(({ migrated, assignmentCycle }) => {
      if (!migrated) return false;
      return true;
    });
  } catch {
    showSyncBanner("Could not sync assignment rotation. Try again.");
  }
}

async function migrateAssignmentCycleIfNeeded() {
  const snap = await getDoc(householdRef);
  const data = snap.data() || {};

  if (data.assignmentCycle) {
    localStorage.removeItem(ASSIGNMENT_CYCLE_KEY);
    return;
  }

  const raw = localStorage.getItem(ASSIGNMENT_CYCLE_KEY);
  if (raw) {
    try {
      const { cycle } = readAssignmentCycle(JSON.parse(raw));
      await setDoc(householdRef, { assignmentCycle: cycle }, { merge: true });
    } catch {
      // ignore invalid local cycle data
    }
  }

  localStorage.removeItem(ASSIGNMENT_CYCLE_KEY);
}

function parseLocalData(raw) {
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    return { chores: data, suggestions: [] };
  }
  return {
    chores: data.chores || [],
    suggestions: data.suggestions || []
  };
}

async function migrateLocalStorageIfNeeded() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  const snap = await getDoc(householdRef);
  const existing = snap.data();
  const hasFirestoreData = existing?.chores?.length > 0;

  if (hasFirestoreData) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const local = parseLocalData(raw);
  if (local.chores.length === 0) return;

  await setDoc(householdRef, { chores: local.chores });
  localStorage.removeItem(STORAGE_KEY);
}

function isChoreDueForAssignment(chore, now = Date.now()) {
  if (chore.assignee) return false;
  if (!ASSIGNMENT_DELAY_ENABLED) return true;
  return (chore.assignAt ?? 0) <= now;
}

function hasPendingAssignments() {
  return chores.some(chore => isChoreDueForAssignment(chore));
}

function hasLiveAssignedAges() {
  return chores.some(chore => chore.assignee && chore.status !== "completed");
}

let backfillAssignedAtPromise = null;

async function backfillMissingAssignedAt() {
  if (!householdRef) return;

  const needsBackfill = chores.some(
    chore => chore.assignee && chore.status !== "completed" && !chore.assignedAt
  );
  if (!needsBackfill) return;

  const now = Date.now();
  chores.forEach(chore => {
    if (chore.assignee && chore.status !== "completed" && !chore.assignedAt) {
      chore.assignedAt = now;
    }
  });

  try {
    await runHouseholdTransaction(({ currentChores, assignmentCycle }) => {
      let changed = false;
      const now = Date.now();
      currentChores.forEach(chore => {
        if (chore.assignee && chore.status !== "completed" && !chore.assignedAt) {
          chore.assignedAt = now;
          changed = true;
        }
      });
      return changed;
    });
    renderChores();
  } catch {
    showSyncBanner("Could not save assignment times. Try again.");
  }
}

function scheduleBackfillMissingAssignedAt() {
  if (backfillAssignedAtPromise) return;
  backfillAssignedAtPromise = backfillMissingAssignedAt().finally(() => {
    backfillAssignedAtPromise = null;
  });
}

function formatAssignmentCountdown(assignAt) {
  const remaining = Math.max(0, assignAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `Assigning in ${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatAssignedAge(assignedAt) {
  const elapsed = Math.max(0, Date.now() - assignedAt);
  const overdue = elapsed > MS_PER_DAY;

  if (elapsed < MS_PER_HOUR) {
    const minutes = Math.floor(elapsed / 60000);
    let text;
    if (minutes === 0) {
      text = "Assigned just now";
    } else if (minutes === 1) {
      text = "Assigned 1 minute ago";
    } else {
      text = `Assigned ${minutes} minutes ago`;
    }
    return { text, overdue };
  }

  if (elapsed < MS_PER_DAY) {
    const hours = Math.floor(elapsed / MS_PER_HOUR);
    const text = hours === 1 ? "Assigned 1 hour ago" : `Assigned ${hours} hours ago`;
    return { text, overdue };
  }

  const days = Math.floor(elapsed / MS_PER_DAY);
  const text = days === 1 ? "Assigned 1 day ago" : `Assigned ${days} days ago`;
  return { text, overdue };
}

function appendAssignedAge(chore, container) {
  if (chore.status === "completed" || !chore.assignee) return;

  const assignedAt = chore.assignedAt;
  if (!assignedAt) return;

  const { text, overdue } = formatAssignedAge(assignedAt);
  const age = document.createElement("p");
  age.className = overdue ? "chore-assigned-age overdue" : "chore-assigned-age";
  age.textContent = text;
  container.appendChild(age);

  if (overdue) {
    const nudge = document.createElement("p");
    nudge.className = "chore-overdue-nudge";
    nudge.textContent = `${chore.assignee} Do your chores!!`;
    container.appendChild(nudge);
  }
}

let assignmentProcessing = false;

async function processDueAssignments() {
  if (!householdRef || !db) return;
  if (assignmentProcessing) return;

  const now = Date.now();
  if (!chores.some(chore => isChoreDueForAssignment(chore, now))) {
    return;
  }

  assignmentProcessing = true;
  try {
    await runHouseholdTransaction(({ currentChores, assignmentCycle, migrated }) => {
      const { cycle: nextCycle, assignedCount } = assignDueChoresInOrder(
        currentChores,
        assignmentCycle,
        now,
        ASSIGNMENT_DELAY_ENABLED
      );
      if (assignedCount === 0 && !migrated) return false;
      Object.assign(assignmentCycle, nextCycle);
      return assignedCount > 0 || migrated;
    });
  } catch {
    showSyncBanner("Could not assign chore. Try again.");
  } finally {
    assignmentProcessing = false;
  }
}

function startAssignmentTimer() {
  if (assignmentTimerId) clearInterval(assignmentTimerId);

  assignmentTimerId = setInterval(() => {
    if (hasPendingAssignments()) {
      processDueAssignments();
    }
    if (hasPendingAssignments() || hasLiveAssignedAges()) {
      renderChores();
    }
  }, 1000);
}
function subscribeToData() {
  onSnapshot(
    householdRef,
    (snapshot) => {
      const data = snapshot.data() || { chores: [] };
      chores = data.chores || [];
      assignmentCycle = normalizeAssignmentCycle(data.assignmentCycle);
      hideSyncBanner();
      scheduleBackfillMissingAssignedAt();
      processDueAssignments();
      renderAll();
    },
    () => {
      showSyncBanner("Could not load data. Check Firebase config and Firestore rules.");
    }
  );
}

function getRoommateStats(name) {
  const assigned = chores.filter(chore => chore.assignee && chore.assignee === name);
  const total = assigned.length;
  const done = assigned.filter(chore => chore.status === "completed").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function createProgressRing(percent) {
  const ring = document.createElement("div");
  ring.className = "progress-ring";

  const offset = 100 - percent;

  ring.innerHTML = `
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle class="ring-bg" cx="18" cy="18" r="15.9155" pathLength="100"></circle>
      <circle class="ring-fill" cx="18" cy="18" r="15.9155" pathLength="100"
        stroke-dasharray="100"
        stroke-dashoffset="${offset}"></circle>
    </svg>
    <span class="ring-percent">${percent}%</span>
  `;

  return ring;
}

function renderLeaderboard() {
  const container = document.getElementById("leaderboard");
  container.innerHTML = "";

  ROOMMATES.forEach(name => {
    const { total, done, percent } = getRoommateStats(name);

    const card = document.createElement("article");
    card.className = "leaderboard-card";
    if (percent === 100 && total > 0) {
      card.classList.add("complete");
    }

    const top = document.createElement("div");
    top.className = "leaderboard-top";

    const nameEl = document.createElement("span");
    nameEl.className = "leaderboard-name";
    nameEl.textContent = name;

    top.appendChild(nameEl);
    top.appendChild(createProgressRing(percent));

    const tally = document.createElement("p");
    tally.className = "leaderboard-tally";
    tally.textContent = `Total Done: ${done} / ${total}`;

    card.appendChild(top);
    card.appendChild(tally);
    container.appendChild(card);
  });
}

function renderFilterNav() {
  const nav = document.getElementById("filterNav");
  nav.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "filter-btn active";
  allBtn.dataset.filter = "all";
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => setFilter("all"));
  nav.appendChild(allBtn);

  ROOMMATES.forEach(name => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.filter = name;
    btn.textContent = name;
    btn.addEventListener("click", () => setFilter(name));
    nav.appendChild(btn);
  });
}

function setFilter(filterValue) {
  activeFilter = filterValue;

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filterValue);
  });

  renderChores();
}

async function addChore(description, category) {
  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    await runHouseholdTransaction(({ currentChores, assignmentCycle }) => {
      if (ASSIGNMENT_DELAY_ENABLED) {
        currentChores.push({
          id,
          description,
          category,
          assignee: null,
          assignAt: now + ASSIGNMENT_DELAY_MS,
          createdAt: now,
          status: "in-progress"
        });
        return true;
      }

      const result = pickNextAssignee(assignmentCycle);
      Object.assign(assignmentCycle, result.cycle);
      currentChores.push({
        id,
        description,
        category,
        assignee: result.assignee,
        assignedAt: now,
        createdAt: now,
        status: "in-progress"
      });
      return true;
    });
  } catch {
    showSyncBanner("Could not save chore. Try again.");
  }
}

async function removeChore(id) {
  const chore = chores.find(c => c.id === id);
  if (!chore || chore.status !== "completed") return;

  try {
    await runHouseholdTransaction(({ currentChores }) => {
      const index = currentChores.findIndex(c => c.id === id);
      if (index === -1) return false;
      if (currentChores[index].status !== "completed") return false;
      currentChores.splice(index, 1);
      return true;
    });
  } catch {
    showSyncBanner("Could not remove chore. Try again.");
  }
}

async function setChoreStatus(id, status) {
  const chore = chores.find(c => c.id === id);
  if (!chore || chore.status === status) return;

  try {
    await runHouseholdTransaction(({ currentChores }) => {
      const target = currentChores.find(c => c.id === id);
      if (!target || target.status === status) return false;
      target.status = status;
      return true;
    });
  } catch {
    showSyncBanner("Could not update chore. Try again.");
  }
}

function getFilteredChores(filterValue) {
  if (filterValue === "all") return chores;
  return chores.filter(chore => chore.assignee === filterValue);
}

function getCategoryClass(category) {
  if (category === "Kitchen") return "kitchen";
  if (category === "Common Room") return "common-room";
  if (category === "Bathroom") return "bathroom";
  if (category === "Other") return "other";
  return "";
}

function renderChores() {
  const filtered = getFilteredChores(activeFilter);
  const choreList = document.getElementById("choreList");

  if (filtered.length === 0) {
    choreList.innerHTML = '<p class="empty-message">No chores to show.</p>';
    return;
  }

  choreList.innerHTML = "";

  filtered.forEach(chore => {
    const card = document.createElement("article");
    card.className = `chore-card ${chore.status}`;

    const badge = document.createElement("span");
    badge.className = `category-badge ${getCategoryClass(chore.category)}`;
    badge.textContent = chore.category;

    const body = document.createElement("div");
    body.className = "chore-body";

    const description = document.createElement("p");
    description.className = "chore-description";
    description.textContent = chore.description;

    let assignee;
    if (chore.assignee) {
      assignee = document.createElement("div");
      assignee.className = "chore-assignee-block";

      if (activeFilter === "all") {
        const nameEl = document.createElement("p");
        nameEl.className = "chore-assignee";
        nameEl.textContent = chore.assignee;
        assignee.appendChild(nameEl);
      }

      appendAssignedAge(chore, assignee);
    } else if (ASSIGNMENT_DELAY_ENABLED) {
      assignee = document.createElement("div");
      assignee.className = "assignment-pending";

      const timer = document.createElement("p");
      timer.className = "chore-assignee pending";
      timer.textContent = formatAssignmentCountdown(chore.assignAt ?? Date.now() + ASSIGNMENT_DELAY_MS);

      const note = document.createElement("p");
      note.className = "assignment-pending-note";
      note.textContent =
        "The next person in the house rotation will be assigned when the timer ends (Moutasim → Dhruv → Dagi → Issac).";

      assignee.appendChild(timer);
      assignee.appendChild(note);
    } else {
      assignee = null;
    }

    const statusControls = document.createElement("div");
    statusControls.className = "status-controls";
    statusControls.setAttribute("role", "group");
    statusControls.setAttribute("aria-label", "Chore status");

    const inProgressBtn = document.createElement("button");
    inProgressBtn.type = "button";
    inProgressBtn.className = "status-btn";
    inProgressBtn.textContent = "In Progress";
    inProgressBtn.classList.toggle("active", chore.status === "in-progress");
    inProgressBtn.addEventListener("click", () => setChoreStatus(chore.id, "in-progress"));

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "status-btn";
    doneBtn.textContent = "Done";
    doneBtn.classList.toggle("active", chore.status === "completed");
    doneBtn.addEventListener("click", () => setChoreStatus(chore.id, "completed"));

    statusControls.appendChild(inProgressBtn);
    statusControls.appendChild(doneBtn);

    if (chore.status === "completed") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeChore(chore.id));
      statusControls.appendChild(removeBtn);
    }

    body.appendChild(description);
    if (assignee) {
      if (chore.assignee) {
        if (assignee.childNodes.length > 0) {
          body.appendChild(assignee);
        }
      } else if (activeFilter === "all") {
        body.appendChild(assignee);
      }
    }
    body.appendChild(statusControls);

    card.appendChild(body);
    card.appendChild(badge);

    choreList.appendChild(card);
  });
}

function renderAll() {
  renderLeaderboard();
  renderChores();
}

function renderSuggestedChores() {
  const container = document.getElementById("suggestedChores");
  if (!container) return;

  container.innerHTML = "";

  const label = document.createElement("p");
  label.className = "suggested-label";
  label.textContent = "Suggested";
  container.appendChild(label);

  const list = document.createElement("div");
  list.className = "suggested-chores-list";

  SUGGESTED_CHORES.forEach(({ description, category }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggested-chore-btn";
    btn.textContent = description;
    btn.setAttribute("aria-label", `${description} (${category})`);
    btn.addEventListener("click", () => addChore(description, category));
    list.appendChild(btn);
  });

  container.appendChild(list);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!isFirebaseConfigured()) {
    showSyncBanner("Add your Firebase config to firebase-config.js");
    return;
  }

  showSyncBanner("Connecting…", "loading");

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    householdRef = doc(db, "households", HOUSEHOLD_ID);

    await migrateLocalStorageIfNeeded();
    await migrateAssignmentCycleIfNeeded();
    await ensureRotationSchemaMigrated();
    subscribeToData();
    startAssignmentTimer();
  } catch {
    showSyncBanner("Firebase failed to initialize. Check firebase-config.js");
    return;
  }

  renderFilterNav();
  renderSuggestedChores();

  document.getElementById("addChoreForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const description = document.getElementById("choreDescription").value.trim();
    const category = document.getElementById("choreCategory").value;

    if (!description || !category) return;
    if (!CATEGORIES.includes(category)) return;

    await addChore(description, category);
    event.target.reset();
  });
});
