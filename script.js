const ADMIN_PIN = "1234";
const ROOMMATES = ["Alex", "Jordan", "Sam", "Taylor"];
const CATEGORIES = ["Kitchen", "Common Room", "Bathroom"];
const STORAGE_KEY = "choreTrackerData";

let chores = [];
let isAdmin = false;

function saveChores() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chores));
}

function loadChores() {
  const raw = localStorage.getItem(STORAGE_KEY);
  chores = raw ? JSON.parse(raw) : [];
}

function attemptLogin(inputPin) {
  if (inputPin === ADMIN_PIN) {
    isAdmin = true;
    document.getElementById("adminPanel").hidden = false;
    renderChores();
  } else {
    alert("Incorrect PIN.");
  }
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
  saveChores();
  renderChores();
}

function deleteChore(id) {
  if (!isAdmin) return;
  chores = chores.filter(chore => chore.id !== id);
  saveChores();
  renderChores();
}

function toggleStatus(id) {
  const chore = chores.find(c => c.id === id);
  if (!chore) return;
  chore.status = chore.status === "completed" ? "in-progress" : "completed";
  saveChores();
  renderChores();
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
  const filterValue = document.getElementById("filterRoommate").value;
  const filtered = getFilteredChores(filterValue);
  const choreList = document.getElementById("choreList");

  if (filtered.length === 0) {
    choreList.innerHTML = '<p class="empty-message">No chores to show.</p>';
    return;
  }

  choreList.innerHTML = "";

  filtered.forEach(chore => {
    const card = document.createElement("article");
    card.className = `chore-card ${chore.status}`;

    const header = document.createElement("div");
    header.className = "chore-header";

    const description = document.createElement("span");
    description.className = "chore-description";
    description.textContent = chore.description;

    const badge = document.createElement("span");
    badge.className = `category-badge ${getCategoryClass(chore.category)}`;
    badge.textContent = chore.category;

    header.appendChild(description);
    header.appendChild(badge);

    const meta = document.createElement("p");
    meta.className = "chore-meta";
    meta.textContent = `Assigned to: ${chore.assignee}`;

    const actions = document.createElement("div");
    actions.className = "chore-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "toggle-btn";
    toggleBtn.textContent = chore.status === "completed" ? "Mark In Progress" : "Mark Complete";
    toggleBtn.addEventListener("click", () => toggleStatus(chore.id));

    actions.appendChild(toggleBtn);

    if (isAdmin) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "❌ Delete";
      deleteBtn.addEventListener("click", () => deleteChore(chore.id));
      actions.appendChild(deleteBtn);
    }

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(actions);
    choreList.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadChores();
  renderChores();

  document.getElementById("adminLoginBtn").addEventListener("click", () => {
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

  document.getElementById("filterRoommate").addEventListener("change", renderChores);
});
