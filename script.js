const ADMIN_PIN = "DG1234";
const ROOMMATES = ["Dagi", "Issac", "Dhruv", "Moutasim"];
const CATEGORIES = ["Kitchen", "Common Room", "Bathroom"];
const STORAGE_KEY = "choreTrackerData";

let chores = [];
let suggestions = [];
let isAdmin = false;
let activeFilter = "all";

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ chores, suggestions }));
}

function loadChores() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    chores = [];
    suggestions = [];
    return;
  }

  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    chores = data;
    suggestions = [];
    return;
  }

  chores = data.chores || [];
  suggestions = data.suggestions || [];
}

function getRoommateStats(name) {
  const assigned = chores.filter(chore => chore.assignee === name);
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

function populateAssigneeSelect() {
  const select = document.getElementById("choreAssignee");
  select.innerHTML = '<option value="" disabled selected>Assign Roommate</option>';

  ROOMMATES.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

function setAdminUI(enabled) {
  isAdmin = enabled;

  const adminBtn = document.getElementById("adminModeBtn");
  const adminPanel = document.getElementById("adminPanel");
  const loginWidget = document.getElementById("loginWidget");

  adminBtn.classList.toggle("active", enabled);
  adminBtn.setAttribute("aria-pressed", String(enabled));
  adminPanel.hidden = !enabled;
  loginWidget.hidden = true;

  renderSuggestions();
  renderChores();
}

function attemptLogin(inputPin) {
  if (inputPin === ADMIN_PIN) {
    setAdminUI(true);
  } else {
    alert("Incorrect PIN.");
  }
}

function addSuggestion(text) {
  suggestions.push({
    id: crypto.randomUUID(),
    text
  });
  saveData();
  renderSuggestions();
}

function deleteSuggestion(id) {
  suggestions = suggestions.filter(suggestion => suggestion.id !== id);
  saveData();
  renderSuggestions();
}

function useSuggestion(id) {
  if (!isAdmin) return;

  const suggestion = suggestions.find(item => item.id === id);
  if (!suggestion) return;

  document.getElementById("choreDescription").value = suggestion.text;
  deleteSuggestion(id);
  document.getElementById("adminPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("choreDescription").focus();
}

function renderSuggestions() {
  const list = document.getElementById("suggestionList");

  if (suggestions.length === 0) {
    list.innerHTML = '<p class="empty-message">No suggestions yet.</p>';
    return;
  }

  list.innerHTML = "";

  suggestions.forEach(suggestion => {
    const card = document.createElement("article");
    card.className = "suggestion-card";

    const text = document.createElement("p");
    text.className = "suggestion-text";
    text.textContent = suggestion.text;

    const actions = document.createElement("div");
    actions.className = "suggestion-actions";

    if (isAdmin) {
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "suggestion-use-btn";
      useBtn.textContent = "Add to Chores";
      useBtn.addEventListener("click", () => useSuggestion(suggestion.id));
      actions.appendChild(useBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "suggestion-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteSuggestion(suggestion.id));
    actions.appendChild(deleteBtn);

    card.appendChild(text);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function addChore(description, category, assignee) {
  if (!isAdmin) return;
  chores.push({
    id: crypto.randomUUID(),
    description,
    category,
    assignee,
    status: "in-progress"
  });
  saveData();
  renderAll();
}

function deleteChore(id) {
  if (!isAdmin) return;
  chores = chores.filter(chore => chore.id !== id);
  saveData();
  renderAll();
}

function toggleStatus(id) {
  const chore = chores.find(c => c.id === id);
  if (!chore) return;
  chore.status = chore.status === "completed" ? "in-progress" : "completed";
  saveData();
  renderAll();
}

function getFilteredChores(filterValue) {
  if (filterValue === "all") return chores;
  return chores.filter(chore => chore.assignee === filterValue);
}

function getCategoryClass(category) {
  if (category === "Kitchen") return "kitchen";
  if (category === "Common Room") return "common-room";
  if (category === "Bathroom") return "bathroom";
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
    if (isAdmin) {
      card.classList.add("admin-view");
    }

    const badge = document.createElement("span");
    badge.className = `category-badge ${getCategoryClass(chore.category)}`;
    badge.textContent = chore.category;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "status-toggle";
    toggleBtn.setAttribute("aria-label", chore.status === "completed" ? "Mark in progress" : "Mark complete");
    toggleBtn.textContent = chore.status === "completed" ? "✓" : "";
    toggleBtn.addEventListener("click", () => toggleStatus(chore.id));

    const body = document.createElement("div");
    body.className = "chore-body";

    const description = document.createElement("p");
    description.className = "chore-description";
    description.textContent = chore.description;

    const assignee = document.createElement("p");
    assignee.className = "chore-assignee";
    assignee.textContent = chore.assignee;

    body.appendChild(description);
    if (activeFilter === "all") {
      body.appendChild(assignee);
    }

    card.appendChild(toggleBtn);
    card.appendChild(body);
    card.appendChild(badge);

    if (isAdmin) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.setAttribute("aria-label", "Delete chore");
      deleteBtn.textContent = "❌";
      deleteBtn.addEventListener("click", () => deleteChore(chore.id));
      card.appendChild(deleteBtn);
    }

    choreList.appendChild(card);
  });
}

function renderAll() {
  renderLeaderboard();
  renderSuggestions();
  renderChores();
}

document.addEventListener("DOMContentLoaded", () => {
  loadChores();
  populateAssigneeSelect();
  renderFilterNav();
  renderAll();

  document.getElementById("adminModeBtn").addEventListener("click", () => {
    if (isAdmin) {
      setAdminUI(false);
      return;
    }

    const loginWidget = document.getElementById("loginWidget");
    loginWidget.hidden = !loginWidget.hidden;
  });

  document.getElementById("adminSubmitBtn").addEventListener("click", () => {
    const pinInput = document.getElementById("adminPinInput");
    attemptLogin(pinInput.value);
    pinInput.value = "";
  });

  document.getElementById("adminPinInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const pinInput = document.getElementById("adminPinInput");
      attemptLogin(pinInput.value);
      pinInput.value = "";
    }
  });

  document.getElementById("addChoreForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const description = document.getElementById("choreDescription").value.trim();
    const category = document.getElementById("choreCategory").value;
    const assignee = document.getElementById("choreAssignee").value;

    if (!description || !category || !assignee) return;

    addChore(description, category, assignee);
    event.target.reset();
  });

  document.getElementById("suggestionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("suggestionInput");
    const text = input.value.trim();
    if (!text) return;

    addSuggestion(text);
    input.value = "";
  });
});
