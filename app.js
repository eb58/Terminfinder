const initialPeople = ["Frauke", "Dominik", "Sascha", "Erich"];
const formatter = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", });
const weekdayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const dayFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

const byId = id => document.getElementById(id);
const isoDate = date => date.toISOString().slice(0, 10);
const cleanName = name => name.trim().replace(/\s+/g, " ");
const cleanNames = value => value.split(",").map(cleanName).filter(Boolean);
const slotId = (date, time) => time ? `${date}T${time}` : date;
const formatSlot = slot => {
  const date = formatter.format(new Date(`${slot.date}T00:00`));
  return slot.time ? `${date} ${slot.time}` : date;
};
const decodeSlug = seg => { try { const once = decodeURIComponent(seg); return once.includes("%") ? decodeURIComponent(once) : once; } catch { return seg; } };
const normalizeSlug = s => s.replace(/[^\x00-\x7F]/g, "");
const rawSlug = decodeSlug(globalThis.location.pathname.split("/").findLast(Boolean) ?? "");
const isAdmin = rawSlug.endsWith("*");
const pollSlug = normalizeSlug(isAdmin ? rawSlug.slice(0, -1) : rawSlug);
const ignoredSlugs = new Set(["terminfinder", "index.html", "api.php"]);
const pollId = /^[\p{L}\p{N}_-]{1,80}$/u.test(pollSlug) && !ignoredSlugs.has(pollSlug.toLowerCase()) ? pollSlug : "default";
const isLanding = rawSlug === "" || ignoredSlugs.has(rawSlug.toLowerCase());
if (!isAdmin) document.body.classList.add("readonly");
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
  invitation: "",
  notifyEmail: "",
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
    .sort((a, b) => a.id.localeCompare(b.id)).map((slot, order) => ({ ...slot, order }));

const normalizeServerState = serverState => {
  const slots = normalizeSlots(serverState?.slots);
  return {
    people: Array.isArray(serverState?.people) ? serverState.people : [...initialPeople],
    availability: serverState?.availability && typeof serverState.availability === "object"
      ? serverState.availability
      : {},
    slots,
    useTime: typeof serverState?.useTime === "boolean" ? serverState.useTime : slots.some(slot => slot.time),
    invitation: typeof serverState?.invitation === "string" ? serverState.invitation : "",
    notifyEmail: typeof serverState?.notifyEmail === "string" ? serverState.notifyEmail : "",
  };
};

const applyServerState = serverState => {
  const nextState = normalizeServerState(serverState);
  state.people = nextState.people;
  state.availability = nextState.availability;
  state.slots = nextState.slots;
  state.useTime = nextState.useTime;
  state.invitation = nextState.invitation;
  state.notifyEmail = nextState.notifyEmail;
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
      invitation: state.invitation,
      notifyEmail: state.notifyEmail,
    }),
  });
  applyServerState(serverState);
  render();
};

const NONE_ID = "none";
const isAvailable = (person, slotId) => state.availability[person]?.includes(slotId) ?? false;

const toggleAvailability = async (person, slotId) => {
  const slots = new Set(state.availability[person] ?? []);
  if (slots.has(slotId)) slots.delete(slotId);
  else if (slotId === NONE_ID) (slots.clear(), slots.add(NONE_ID));
  else (slots.delete(NONE_ID), slots.add(slotId));
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
  state.slots = [...state.slots, { id: slotId(date, nextTime), date, time: nextTime, order: 0 }].sort((a, b) => a.id.localeCompare(b.id)).map((slot, order) => ({ ...slot, order }));
  render();
  await save();
};

const updateSlot = async (oldId, date, time) => {
  const nextTime = state.useTime ? time : "";
  const newId = slotId(date, nextTime);
  if (!date || oldId === newId) return;
  if (state.slots.some(slot => slot.id === newId)) return;
  state.slots = state.slots.map(slot => slot.id === oldId ? { ...slot, id: newId, date, time: nextTime } : slot).sort((a, b) => a.id.localeCompare(b.id)).map((slot, order) => ({ ...slot, order }));
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

const isValidEmail = email =>
  !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const stripSlotTimes = () => {
  const slotsByDate = new Map();
  const idMap = new Map(state.slots.map(slot => [slot.id, slot.date]));
  state.slots.forEach(slot => {
    if (!slotsByDate.has(slot.date)) slotsByDate.set(slot.date, { ...slot, id: slot.date, time: "" });
  });
  state.slots = [...slotsByDate.values()].map((slot, order) => ({ ...slot, order }));
  remapAvailability(idMap, new Set([...state.slots.map(slot => slot.id), NONE_ID]));
};

const applyTimeToSlots = time => {
  const idMap = new Map(state.slots.map(slot => [slot.id, slotId(slot.date, time)]));
  state.slots = state.slots.map(slot => ({ ...slot, id: slotId(slot.date, time), time }));
  remapAvailability(idMap, new Set([...state.slots.map(slot => slot.id), NONE_ID]));
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
  state.invitation = "";
  state.notifyEmail = "";
  render();
  await save();
};

const renderPeople = () => {
  const list = byId("personList");
  list.innerHTML = "";
  state.people.forEach(person => {
    const chip = document.createElement("div");
    chip.className = "person-chip";
    chip.textContent = person;
    if (isAdmin) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "x";
      remove.ariaLabel = `${person} entfernen`;
      remove.addEventListener("click", () => removePerson(person));
      chip.append(remove);
    }
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
    row.className = `slot-row${state.useTime ? "" : " day-only"}`;
    if (isAdmin) {
      const date = document.createElement("input");
      const time = document.createElement("input");
      const remove = document.createElement("button");
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
    } else {
      row.textContent = formatSlot(slot);
    }
    list.append(row);
  });
};

const makeSlotCell = slot => {
  const td = document.createElement("td");
  const weekday = document.createElement("span");
  const day = document.createElement("span");
  weekday.className = "slot-dow";
  weekday.textContent = weekdayFormatter.format(new Date(`${slot.date}T00:00`));
  day.textContent = dayFormatter.format(new Date(`${slot.date}T00:00`));
  td.append(weekday, day);
  if (slot.time) {
    const time = document.createElement("span");
    time.className = "slot-tod";
    time.textContent = slot.time;
    td.append(time);
  }
  return td;
};

const makeSlotTh = slot => {
  const th = document.createElement("th");
  th.scope = "col";
  const weekday = document.createElement("span");
  const day = document.createElement("span");
  weekday.className = "slot-dow";
  weekday.textContent = weekdayFormatter.format(new Date(`${slot.date}T00:00`));
  day.textContent = dayFormatter.format(new Date(`${slot.date}T00:00`));
  th.append(weekday, day);
  if (slot.time) {
    const time = document.createElement("span");
    time.className = "slot-tod";
    time.textContent = slot.time;
    th.append(time);
  }
  return th;
};

const makeAvailButton = (person, id, label) => {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = `slot-button${isAvailable(person, id) ? " active" : ""}`;
  button.type = "button";
  button.ariaLabel = label;
  button.addEventListener("click", () => toggleAvailability(person, id));
  cell.append(button);
  return cell;
};

const renderTable = () => {
  const table = byId("availabilityTable");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const everyoneHasDate = state.people.every(person => (state.availability[person] ?? []).some(id => id !== NONE_ID));
  const showNone = !isAdmin && !everyoneHasDate;
  const transposed = state.people.length > state.slots.length;

  if (transposed) {
    // Header: "Name" | slot1 | slot2 | ... | [Kein Termin]
    const headerRow = document.createElement("tr");
    const nameHead = document.createElement("th");
    nameHead.scope = "col";
    nameHead.textContent = "Name";
    headerRow.append(nameHead);
    state.slots.forEach(slot => headerRow.append(makeSlotTh(slot)));
    if (showNone) {
      const noneTh = document.createElement("th");
      noneTh.scope = "col";
      noneTh.className = "none-col";
      noneTh.textContent = "Kein Termin";
      headerRow.append(noneTh);
    }
    thead.append(headerRow);

    // Rows: one per person
    state.people.forEach(person => {
      const row = document.createElement("tr");
      const nameTh = document.createElement("th");
      nameTh.scope = "row";
      nameTh.textContent = person;
      row.append(nameTh);
      state.slots.forEach(slot => row.append(makeAvailButton(person, slot.id, `${person}, ${formatSlot(slot)}`)));
      if (showNone) {
        const noneCell = makeAvailButton(person, NONE_ID, `${person}, kein Termin passt`);
        noneCell.classList.add("none-col");
        row.append(noneCell);
      }
      tbody.append(row);
    });
  } else {
    // Header: "Termin" | person1 | person2 | ...
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
    thead.append(headerRow);

    // Rows: one per slot
    state.slots.forEach(slot => {
      const row = document.createElement("tr");
      row.append(makeSlotCell(slot));
      state.people.forEach(person => row.append(makeAvailButton(person, slot.id, `${person}, ${formatSlot(slot)}`)));
      tbody.append(row);
    });

    if (showNone) {
      const row = document.createElement("tr");
      row.className = "none-row";
      const labelCell = document.createElement("td");
      labelCell.textContent = "Kein Termin passt";
      row.append(labelCell);
      state.people.forEach(person => row.append(makeAvailButton(person, NONE_ID, `${person}, kein Termin passt`)));
      tbody.append(row);
    }
  }

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

  const makeResult = (label, available, className) => {
    const article = document.createElement("article");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    article.className = className;
    title.textContent = label;
    detail.textContent = `${available.length}/${state.people.length}: ${available.length ? available.join(", ") : "Noch niemand"}`;
    article.append(title, detail);
    return article;
  };

  const noneAvailable = state.people.filter(person => isAvailable(person, NONE_ID));
  const allVoted = state.people.length > 0 && state.people.every(person => state.availability[person]?.length);
  const noSlotFitsAll = allVoted && bestCount < state.people.length;
  results.replaceChildren(
    ...ranked.slice(0, 3).map(slot =>
      makeResult(formatSlot(slot), slot.available, slot.available.length === bestCount && slot.available.length > 0 ? "result best" : "result")),
    ...noSlotFitsAll ? [makeResult("Kein Termin passt", noneAvailable, "result none")] : [],
  );
};

const renderInvitation = () => {
  byId("inviteInput").value = state.invitation;
  byId("inviteText").textContent = state.invitation;
  byId("inviteText").hidden = isAdmin || !state.invitation;
  byId("notifyEmailInput").value = state.notifyEmail;
  byId("invitePanel").hidden = !isAdmin && !state.invitation;
};

const render = () => {
  renderInvitation();
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
byId("inviteInput").addEventListener("change", async event => {
  state.invitation = event.target.value.trim();
  render();
  await save();
});
const notifyEmailInput = byId("notifyEmailInput");
const emailStatus = byId("emailStatus");

const updateEmailStatus = () => {
  const email = notifyEmailInput.value.trim();
  if (!email) {
    emailStatus.hidden = true;
  } else if (!isValidEmail(email)) {
    emailStatus.hidden = false;
    emailStatus.className = "email-status error";
    emailStatus.textContent = "Ungültige E-Mail-Adresse";
  } else {
    emailStatus.hidden = false;
    emailStatus.className = "email-status valid";
    emailStatus.textContent = "✓ E-Mail-Adresse gültig";
  }
};

notifyEmailInput.addEventListener("input", updateEmailStatus);
notifyEmailInput.addEventListener("change", async event => {
  const email = event.target.value.trim();
  if (isValidEmail(email) && email) {
    state.notifyEmail = email;
    await save();
  }
});
byId("eyebrow").textContent = pollTitle ? `Termin abstimmen für ${pollTitle}` : "Termin abstimmen";

const nextSlotDate = new Date();
nextSlotDate.setDate(nextSlotDate.getDate() + 3);
byId("slotDate").value = isoDate(nextSlotDate);

byId("resetButton").addEventListener("click", reset);

if (isLanding) {
  byId("landingPage").hidden = false;
  byId("pollApp").hidden = true;
  byId("resetButton").hidden = true;
  byId("eyebrow").textContent = "Terminabstimmung für Gruppen";
  byId("createPollForm").addEventListener("submit", event => {
    event.preventDefault();
    const raw = byId("pollNameInput").value.trim();
    const slug = normalizeSlug(raw).replaceAll(/\s+/g, "-").replaceAll(/[^\p{L}\p{N}_-]/gu, "").slice(0, 80);
    if (slug) globalThis.location.href = `./${slug}*`;
  });
} else {
  render();
  load().catch(error => {
    console.error(error);
    alert("Der gespeicherte Status konnte nicht geladen werden.");
  });
}
