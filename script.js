import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig, HOUSEHOLD_ID } from "./firebase-config.js";

const ROOMMATES = ["Dagi", "Issac", "Dhruv", "Moutasim"];
const CATEGORIES = ["Kitchen", "Common Room", "Bathroom", "Other"];
const SUGGESTED_CHORES = [
  { description: "Empty Dehumidifier", category: "Kitchen" },
  { description: "Take Out Trash (from the house to the outside bin)", category: "Kitchen" },
  { description: "Vacuum the Common Room", category: "Common Room" },
  { description: "Clean Dishes", category: "Kitchen" },
  { description: "Vacuum Hallway", category: "Other" },
  { description: "Empty the Vacuum Cleaners", category: "Other" }
];
const STORAGE_KEY = "choreTrackerData";
const ASSIGNMENT_CYCLE_KEY = "choreTrackerAssignmentCycle";
const ASSIGNMENT_DELAY_MS = 20 * 60 * 1000;

let chores = [];
let activeFilter = "all";
let householdRef = null;
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

async function saveData() {
  if (!householdRef) return;
  await setDoc(householdRef, { chores });
}

function loadAssignmentCycle() {
  const raw = localStorage.getItem(ASSIGNMENT_CYCLE_KEY);
  if (!raw) {
    return { cycleId: 1, eligible: [...ROOMMATES] };
  }

  try {
    const data = JSON.parse(raw);
    return {
      cycleId: data.cycleId ?? 1,
      eligible: Array.isArray(data.eligible) ? data.eligible : [...ROOMMATES]
    };
  } catch {
    return { cycleId: 1, eligible: [...ROOMMATES] };
  }
}

function saveAssignmentCycle(state) {
  localStorage.setItem(ASSIGNMENT_CYCLE_KEY, JSON.stringify(state));
}

function syncEligibleWithRoommates(state) {
  let eligible = state.eligible.filter(name => ROOMMATES.includes(name));

  if (eligible.length > 0) {
    ROOMMATES.forEach(name => {
      if (!eligible.includes(name)) {
        eligible.push(name);
      }
    });
  }

  return { ...state, eligible };
}

function pickRandomAssignee() {
  let state = syncEligibleWithRoommates(loadAssignmentCycle());

  if (state.eligible.length === 0) {
    state.cycleId += 1;
    state.eligible = [...ROOMMATES];
  }

  const index = Math.floor(Math.random() * state.eligible.length);
  const assignee = state.eligible[index];
  state.eligible.splice(index, 1);

  saveAssignmentCycle(state);
  return assignee;
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

function hasPendingAssignments() {
  return chores.some(chore => !chore.assignee);
}

function formatAssignmentCountdown(assignAt) {
  const remaining = Math.max(0, assignAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `Assigning in ${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function processDueAssignments() {
  const now = Date.now();
  const dueChores = chores.filter(chore => !chore.assignee && (chore.assignAt ?? 0) <= now);
  if (dueChores.length === 0) return;

  const previousStates = dueChores.map(chore => ({
    chore,
    assignAt: chore.assignAt
  }));

  for (const chore of dueChores) {
    chore.assignee = pickRandomAssignee();
    delete chore.assignAt;
  }

  try {
    await saveData();
  } catch {
    for (const { chore, assignAt } of previousStates) {
      chore.assignee = null;
      if (assignAt !== undefined) {
        chore.assignAt = assignAt;
      }
    }
    showSyncBanner("Could not assign chore. Try again.");
  }
}

function startAssignmentTimer() {
  if (assignmentTimerId) clearInterval(assignmentTimerId);

  assignmentTimerId = setInterval(() => {
    if (!hasPendingAssignments()) return;
    processDueAssignments();
    renderChores();
  }, 1000);
}

function subscribeToData() {
  onSnapshot(
    householdRef,
    (snapshot) => {
      const data = snapshot.data() || { chores: [] };
      chores = data.chores || [];
      hideSyncBanner();
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
  const chore = {
    id: crypto.randomUUID(),
    description,
    category,
    assignee: null,
    assignAt: Date.now() + ASSIGNMENT_DELAY_MS,
    status: "in-progress"
  };
  chores.push(chore);

  try {
    await saveData();
  } catch {
    chores = chores.filter(item => item.id !== chore.id);
    showSyncBanner("Could not save chore. Try again.");
  }
}

async function removeChore(id) {
  const chore = chores.find(c => c.id === id);
  if (!chore || chore.status !== "completed") return;

  const previous = chores;
  chores = chores.filter(c => c.id !== id);

  try {
    await saveData();
  } catch {
    chores = previous;
    showSyncBanner("Could not remove chore. Try again.");
  }
}

async function setChoreStatus(id, status) {
  const chore = chores.find(c => c.id === id);
  if (!chore || chore.status === status) return;

  const previousStatus = chore.status;
  chore.status = status;

  try {
    await saveData();
  } catch {
    chore.status = previousStatus;
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
      assignee = document.createElement("p");
      assignee.className = "chore-assignee";
      assignee.textContent = chore.assignee;
    } else {
      assignee = document.createElement("div");
      assignee.className = "assignment-pending";

      const timer = document.createElement("p");
      timer.className = "chore-assignee pending";
      timer.textContent = formatAssignmentCountdown(chore.assignAt ?? Date.now() + ASSIGNMENT_DELAY_MS);

      const note = document.createElement("p");
      note.className = "assignment-pending-note";
      note.textContent = "A random housemate will be assigned a chore at the end of the timer.";

      assignee.appendChild(timer);
      assignee.appendChild(note);
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
    if (activeFilter === "all") {
      body.appendChild(assignee);
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
    const db = getFirestore(app);
    householdRef = doc(db, "households", HOUSEHOLD_ID);

    await migrateLocalStorageIfNeeded();
    saveAssignmentCycle(syncEligibleWithRoommates(loadAssignmentCycle()));
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
