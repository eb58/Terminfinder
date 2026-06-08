const initialPeople = ["Frauke", "Dominik", "Sascha", "Erich"];
const formatter = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", });

const byId = id => document.getElementById(id);
const isoDate = date => date.toISOString().slice(0, 10);
const cleanName = name => name.trim().replace(/\s+/g, " ");
const cleanNames = value => value.split(",").map(cleanName).filter(Boolean);
const slotId = (date, time) => time ? `${date}T${time}` : date;
const formatSlot = slot => {
  const date = formatter.format(new Date(`${slot.date}T00:00`));
  return slot.time ? `${date} ${slot.time}` : date;
};
const pollIdFromPath = () => {
  const ignored = new Set(["terminfinder", "index.html", "api.php"]);
  const slug = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "");
  return /^[a-z0-9_-]{1,80}$/i.test(slug) && !ignored.has(slug.toLowerCase()) ? slug : "default";
};
const pollId = pollIdFromPath();
const apiUrl = `api.php?poll=${encodeURIComponent(pollId)}`;
const pollTitle = pollId === "default" ? "" : pollId.replace(/[-_]+/g, " ");

const buildInitialSlots = () =>
  Array.from({ length: 10 }, (_, index) => {
    const date = new Date();
    date.setHours(18, 0, 0, 0);
    date.setDate(date.getDate() + index + 1);
    const dateValue = isoDate(date);
    const time = "18:00";
    return {
      id: slotId(dateValue, time),
      date: dateValue,
      time,
      order: index,
    };
  });

const state = {
  people: [...initialPeople],
  availability: {},
  slots: buildInitialSlots(),
  useTime: true,
};

const normalizeSlots = slots =>
  (Array.isArray(slots) ? slots : buildInitialSlots())
    .map((slot, index) => ({
      date: typeof slot.date === "string" ? slot.date : String(slot.id ?? "").slice(0, 10),
      time: typeof slot.time === "string" ? slot.time : String(slot.id ?? "").slice(11, 16),
      order: Number.isInteger(slot.order) ? slot.order : index,
    }))
    .filter(slot => /^\d{4}-\d{2}-\d{2}$/.test(slot.date) && /^(\d{2}:\d{2})?$/.test(slot.time))
    .map(slot => ({ ...slot, id: slotId(slot.date, slot.time) }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

const normalizeServerState = serverState => {
  const slots = normalizeSlots(serverState?.slots);
  return {
    people: Array.isArray(serverState?.people) ? serverState.people : [...initialPeople],
    availability: serverState?.availability && typeof serverState.availability === "object"
      ? serverState.availability
      : {},
    slots,
    useTime: typeof serverState?.useTime === "boolean" ? serverState.useTime : slots.some(slot => slot.time),
  };
};

const applyServerState = serverState => {
  const nextState = normalizeServerState(serverState);
  state.people = nextState.people;
  state.availability = nextState.availability;
  state.slots = nextState.slots;
  state.useTime = nextState.useTime;
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const load = async () => {
  applyServerState(await requestJson(apiUrl));
  render();
};

const save = async () => {
  const serverState = await requestJson(apiUrl, {
    method: "PUT",
    body: JSON.stringify({
      people: state.people,
      availability: state.availability,
      slots: state.slots,
      useTime: state.useTime,
    }),
  });
  applyServerState(serverState);
  render();
};

const isAvailable = (person, slotId) => state.availability[person]?.includes(slotId) ?? false;

const toggleAvailability = async (person, slotId) => {
  const slots = new Set(state.availability[person] ?? []);
  slots.has(slotId) ? slots.delete(slotId) : slots.add(slotId);
  state.availability[person] = [...slots];
  render();
  await save();
};

const addPeople = async value => {
  const existing = new Set(state.people.map(person => person.toLowerCase()));
  const newPeople = cleanNames(value).filter(person => {
    const key = person.toLowerCase();
    const isNew = !existing.has(key);
    existing.add(key);
    return isNew;
  });
  if (!newPeople.length) return;
  state.people = [...state.people, ...newPeople];
  render();
  await save();
};

const removePerson = async name => {
  state.people = state.people.filter(person => person !== name);
  delete state.availability[name];
  render();
  await save();
};

const addSlot = async (date, time) => {
  const nextTime = state.useTime ? time : "";
  if (!date || state.slots.some(slot => slot.id === slotId(date, nextTime))) return;
  state.slots = [...state.slots, { id: slotId(date, nextTime), date, time: nextTime, order: state.slots.length }];
  render();
  await save();
};

const updateSlot = async (oldId, date, time) => {
  const nextTime = state.useTime ? time : "";
  const newId = slotId(date, nextTime);
  if (!date || oldId === newId) return;
  if (state.slots.some(slot => slot.id === newId)) return;
  state.slots = state.slots.map(slot => slot.id === oldId ? { ...slot, id: newId, date, time: nextTime } : slot);
  state.availability = Object.fromEntries(
    Object.entries(state.availability).map(([person, slots]) => [
      person,
      slots.map(id => id === oldId ? newId : id),
    ]),
  );
  render();
  await save();
};

const remapAvailability = (idMap, validIds) => {
  state.availability = Object.fromEntries(
    Object.entries(state.availability).map(([person, slots]) => [
      person,
      [...new Set(slots.map(id => idMap.get(id) ?? id).filter(id => validIds.has(id)))],
    ]),
  );
};

const stripSlotTimes = () => {
  const slotsByDate = new Map();
  const idMap = new Map(state.slots.map(slot => [slot.id, slot.date]));
  state.slots.forEach(slot => {
    if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, { ...slot, id: slot.date, time: "" });
  });
  state.slots = [...slotsByDate.values()].map((slot, order) => ({ ...slot, order }));
  remapAvailability(idMap, new Set(state.slots.map(slot => slot.id)));
};

const applyTimeToSlots = time => {
  const idMap = new Map(state.slots.map(slot => [slot.id, slotId(slot.date, time)]));
  state.slots = state.slots.map(slot => ({ ...slot, id: slotId(slot.date, time), time }));
  remapAvailability(idMap, new Set(state.slots.map(slot => slot.id)));
};

const toggleTimeMode = async checked => {
  const selectedTime = byId("slotTime").value;
  state.useTime = checked;
  if (state.useTime && selectedTime) applyTimeToSlots(selectedTime);
  if (!state.useTime) stripSlotTimes();
  render();
  await save();
};

const removeSlot = async id => {
  state.slots = state.slots.filter(slot => slot.id !== id).map((slot, order) => ({ ...slot, order }));
  state.availability = Object.fromEntries(
    Object.entries(state.availability).map(([person, slots]) => [
      person,
      slots.filter(slotIdValue => slotIdValue !== id),
    ]),
  );
  render();
  await save();
};

const reset = async () => {
  state.people = [...initialPeople];
  state.availability = {};
  state.slots = buildInitialSlots();
  state.useTime = true;
  render();
  await save();
};

const renderPeople = () => {
  const list = byId("personList");
  list.innerHTML = "";
  state.people.forEach(person => {
    const chip = document.createElement("div");
    const remove = document.createElement("button");
    chip.className = "person-chip";
    chip.textContent = person;
    remove.type = "button";
    remove.textContent = "x";
    remove.ariaLabel = `${person} entfernen`;
    remove.addEventListener("click", () => removePerson(person));
    chip.append(remove);
    list.append(chip);
  });
};

const renderSlots = () => {
  const list = byId("slotList");
  const timeMode = byId("timeMode");
  const slotTime = byId("slotTime");
  timeMode.checked = state.useTime;
  slotTime.disabled = false;
  slotTime.hidden = false;
  list.innerHTML = "";
  state.slots.forEach(slot => {
    const row = document.createElement("div");
    const date = document.createElement("input");
    const time = document.createElement("input");
    const remove = document.createElement("button");
    row.className = `slot-row${state.useTime ? "" : " day-only"}`;
    date.type = "date";
    date.value = slot.date;
    date.ariaLabel = "Datum";
    time.type = "time";
    time.value = slot.time;
    time.ariaLabel = "Uhrzeit";
    date.addEventListener("change", () => updateSlot(slot.id, date.value, time.value));
    time.addEventListener("change", () => updateSlot(slot.id, date.value, time.value));
    remove.type = "button";
    remove.textContent = "x";
    remove.ariaLabel = `${formatSlot(slot)} entfernen`;
    remove.addEventListener("click", () => removeSlot(slot.id));
    state.useTime ? row.append(date, time, remove) : row.append(date, remove);
    list.append(row);
  });
};

const renderTable = () => {
  const table = byId("availabilityTable");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");
  const dateHead = document.createElement("th");
  dateHead.scope = "col";
  dateHead.textContent = "Termin";
  headerRow.append(dateHead);

  state.people.forEach(person => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = person;
    headerRow.append(th);
  });

  state.slots.forEach(slot => {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = formatSlot(slot);
    row.append(dateCell);

    state.people.forEach(person => {
      const cell = document.createElement("td");
      const button = document.createElement("button");
      button.className = `slot-button${isAvailable(person, slot.id) ? " active" : ""}`;
      button.type = "button";
      button.ariaLabel = `${person}, ${formatSlot(slot)}`;
      button.addEventListener("click", () => toggleAvailability(person, slot.id));
      cell.append(button);
      row.append(cell);
    });

    tbody.append(row);
  });

  thead.append(headerRow);
  table.replaceChildren(thead, tbody);
};

const renderResults = () => {
  const results = byId("results");
  const ranked = state.slots
    .map(slot => {
      const available = state.people.filter(person => isAvailable(person, slot.id));
      return { ...slot, available };
    })
    .sort((a, b) => b.available.length - a.available.length || a.order - b.order);
  const bestCount = ranked[0]?.available.length ?? 0;

  results.replaceChildren(
    ...ranked.map(slot => {
      const count = slot.available.length;
      const article = document.createElement("article");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      article.className = count === bestCount && count > 0 ? "result best" : "result";
      title.textContent = formatSlot(slot);
      detail.textContent = `${count}/${state.people.length}: ${count ? slot.available.join(", ") : "Noch niemand"}`;
      article.append(title, detail);
      return article;
    }),
  );
};

const render = () => {
  renderPeople();
  renderSlots();
  renderTable();
  renderResults();
};

byId("personForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = byId("personInput");
  await addPeople(input.value);
  input.value = "";
  input.focus();
});

byId("slotForm").addEventListener("submit", async event => {
  event.preventDefault();
  const date = byId("slotDate");
  const time = byId("slotTime");
  await addSlot(date.value, time.value);
  date.focus();
});

byId("timeMode").addEventListener("change", event => toggleTimeMode(event.target.checked));
byId("eyebrow").textContent = pollTitle ? `Termin abstimmen für ${pollTitle}` : "Termin abstimmen";

const nextSlotDate = new Date();
nextSlotDate.setDate(nextSlotDate.getDate() + 3);
byId("slotDate").value = isoDate(nextSlotDate);

byId("resetButton").addEventListener("click", reset);

render();
load().catch(error => {
  console.error(error);
  alert("Der gespeicherte Status konnte nicht geladen werden.");
});
