// ============================================================
// 4AM WEALTH — BOARDROOM BOOKING SCHEDULER
// ============================================================
//
// SETUP — before going live, do these two things:
//
// 1. FIREBASE PROJECT
//    a) Go to https://console.firebase.google.com
//    b) Create a new project (or use an existing one)
//    c) Register a Web App and copy the config values below
//    d) Go to Build → Firestore Database → Create database
//       Choose "Start in test mode" to begin, then tighten
//       rules before sharing publicly (see FIRESTORE RULES below)
//
// 2. PASTE YOUR CONFIG VALUES into FIREBASE_CONFIG below
//
// FIRESTORE SECURITY RULES (paste into Firebase Console):
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /bookings/{id} {
//         allow read, write: if true;
//       }
//     }
//   }
// ============================================================

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── YOUR FIREBASE CONFIG ────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCof5qWDhtUp1LmbII1jczsWb00TA7ocMY",
  authDomain:        "am-wealth-boardroom-schedule.firebaseapp.com",
  projectId:         "am-wealth-boardroom-schedule",
  storageBucket:     "am-wealth-boardroom-schedule.firebasestorage.app",
  messagingSenderId: "719226580402",
  appId:             "1:719226580402:web:ca03c4fee97dc01f86c8ab",
};
// ───────────────────────────────────────────────────────────

// ── APP SETTINGS (customise as needed) ─────────────────────
const SETTINGS = {
  roomName:  "Main Boardroom",
  dayStart:  7,   // first visible hour  (7  = 7:00 AM)
  dayEnd:    21,  // last  visible hour  (21 = 9:00 PM)
  hourPx:    58,  // pixel height per hour — must match CSS --hour-h
};
// ───────────────────────────────────────────────────────────

// ── STATE ──────────────────────────────────────────────────
let db;
let bookings          = [];
let weekOffset        = 0;          // weeks from current week
let selectedSlot      = null;       // { date: "YYYY-MM-DD", hour: number }
let selectedDur       = 1;          // hours
let pendingCancel     = null;       // booking id awaiting email confirmation
let mobileDayDate     = toDateStr(new Date()); // active day on mobile
let selectedRecur     = "none";               // 'none'|'daily'|'weekly'|'monthly'
// ───────────────────────────────────────────────────────────

function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

// ============================================================
// FIREBASE
// ============================================================

function initFirebase() {
  const isPlaceholder = !FIREBASE_CONFIG.apiKey ||
    FIREBASE_CONFIG.apiKey === "REPLACE_WITH_YOUR_API_KEY";

  if (isPlaceholder) {
    document.getElementById("setup-banner").classList.remove("hidden");
    hideLoading();
    return;
  }

  try {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    listenForBookings();
  } catch (err) {
    console.error("Firebase init failed:", err);
    document.getElementById("setup-banner").classList.remove("hidden");
    hideLoading();
  }
}

function listenForBookings() {
  const dot  = document.getElementById("live-dot");
  const text = document.getElementById("live-text");

  onSnapshot(
    collection(db, "bookings"),
    (snap) => {
      bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderBookings();
      hideLoading();
      dot.classList.add("online");
      text.textContent = "Live";
    },
    (err) => {
      console.error("Firestore error:", err);
      dot.classList.remove("online");
      text.textContent = "Offline";
      showToast("Connection lost. Check your Firebase config.", "error");
      hideLoading();
    }
  );
}

async function saveBooking(data) {
  return addDoc(collection(db, "bookings"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

async function saveBatchBookings(baseData, dates) {
  const groupId = dates.length > 1 ? crypto.randomUUID() : null;
  const batch   = writeBatch(db);
  dates.forEach((date) => {
    const ref = doc(collection(db, "bookings"));
    batch.set(ref, {
      ...baseData,
      date,
      ...(groupId ? { groupId } : {}),
      createdAt: serverTimestamp(),
    });
  });
  return batch.commit();
}

async function removeBooking(id) {
  return deleteDoc(doc(db, "bookings", id));
}

async function removeBookingGroup(groupId) {
  const snap  = await getDocs(query(collection(db, "bookings"), where("groupId", "==", groupId)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  return batch.commit();
}

// ============================================================
// DATE HELPERS
// ============================================================

function weekDays(offset = 0) {
  const now  = new Date();
  const dow  = now.getDay();                               // 0 = Sun
  const mon  = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pad(n) { return String(n).padStart(2, "0"); }

function isToday(d) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() &&
         d.getMonth()    === t.getMonth()    &&
         d.getDate()     === t.getDate();
}

function isPastDate(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return d < t;
}

// A slot is "past" if its date is in the past, or if it's today and the hour has passed.
function isPastSlot(dateStr, hour) {
  const d = fromDateStr(dateStr);
  if (isPastDate(d)) return true;
  if (isToday(d) && hour < new Date().getHours()) return true;
  return false;
}

// "14:30" → 14.5
function timeToHours(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h + m / 60;
}

// "14:00" + 1.5 → "15:30"
function addHours(timeStr, hours) {
  const [h, m] = timeStr.split(":").map(Number);
  const totalMins = h * 60 + m + Math.round(hours * 60);
  return `${pad(Math.floor(totalMins / 60))}:${pad(totalMins % 60)}`;
}

// "14:30" → "2:30 PM"
function fmtTime(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad(m)} ${period}`;
}

function fmtHour(h) {
  if (h === 0)  return "12:00 AM";
  if (h < 12)   return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function fmtHourShort(h) {
  if (h === 0)  return "12 AM";
  if (h < 12)   return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function fmtDateLong(dateStr) {
  return fromDateStr(dateStr).toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// Populate the start-time <select> with 15-min interval options
function populateTimeSelect(defaultTime) {
  const sel = document.getElementById("f-start-time");
  sel.innerHTML = "";
  for (let h = SETTINGS.dayStart; h < SETTINGS.dayEnd; h++) {
    for (let m = 0; m < 60; m += 15) {
      const val  = `${pad(h)}:${pad(m)}`;
      const opt  = document.createElement("option");
      opt.value  = val;
      opt.text   = fmtTime(val);
      if (val === defaultTime) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

// ============================================================
// RECURRENCE HELPERS
// ============================================================

function computeOccurrences(startDateStr, recur, selectedWeekDays, endDateStr) {
  if (recur === "none" || !endDateStr) return [startDateStr];

  const start = fromDateStr(startDateStr);
  const end   = fromDateStr(endDateStr);
  if (end < start) return [startDateStr];

  const dates = [];

  if (recur === "daily") {
    let d = new Date(start);
    while (d <= end && dates.length < 100) {
      dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (recur === "weekly") {
    if (!selectedWeekDays.length) return [];
    let d = new Date(start);
    while (d <= end && dates.length < 100) {
      if (selectedWeekDays.includes(d.getDay())) dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (recur === "monthly") {
    let d = new Date(start);
    while (d <= end && dates.length < 24) {
      dates.push(toDateStr(d));
      d.setMonth(d.getMonth() + 1);
    }
  }

  return dates;
}

function getSelectedWeekDays() {
  return Array.from(document.querySelectorAll('input[name="rday"]:checked'))
    .map((cb) => parseInt(cb.value, 10));
}

function updateRecurHint() {
  const hint = document.getElementById("recur-hint");
  if (!hint || !selectedSlot) return;

  const endDateStr = document.getElementById("f-recur-end").value;
  if (!endDateStr) { hint.classList.add("hidden"); return; }

  const days  = selectedRecur === "weekly" ? getSelectedWeekDays() : [];
  const dates = computeOccurrences(selectedSlot.date, selectedRecur, days, endDateStr);

  if (dates.length === 0) {
    hint.textContent = "No occurrences — select at least one day.";
    hint.style.color = "var(--danger)";
  } else {
    hint.textContent = `Creates ${dates.length} booking${dates.length !== 1 ? "s" : ""}`;
    hint.style.color = "var(--sage)";
  }
  hint.classList.remove("hidden");
}

function defaultEndDate(startDateStr, recur) {
  const d = fromDateStr(startDateStr);
  if (recur === "daily")   d.setDate(d.getDate() + 14);
  if (recur === "weekly")  d.setDate(d.getDate() + 56);
  if (recur === "monthly") d.setMonth(d.getMonth() + 3);
  return toDateStr(d);
}

// ============================================================
// CALENDAR RENDERING
// ============================================================

function renderCalendar() {
  const days = weekDays(weekOffset);
  updateWeekLabel(days);

  const cal = document.getElementById("calendar");
  let html  = "";

  // ── day header row ──
  html += `<div class="cal-header"><div class="cal-gutter-hdr"></div>`;
  days.forEach((day) => {
    const today = isToday(day);
    const abbr  = day.toLocaleDateString("en", { weekday: "short" });
    html += `<div class="cal-day-hdr ${today ? "today" : ""}">
      <span class="day-abbr">${abbr}</span>
      <span class="day-num-badge">${day.getDate()}</span>
    </div>`;
  });
  html += `</div>`;

  // ── body ──
  html += `<div class="cal-body">`;

  // time gutter
  html += `<div class="cal-time-gutter">`;
  for (let h = SETTINGS.dayStart; h < SETTINGS.dayEnd; h++) {
    html += `<div class="time-label">${fmtHourShort(h)}</div>`;
  }
  html += `</div>`;

  // day columns
  days.forEach((day) => {
    const dateStr = toDateStr(day);
    const pastCol = isPastDate(day) && !isToday(day);
    html += `<div class="cal-day-col${isToday(day) ? " today" : ""}${pastCol ? " past-col" : ""}"
      id="col-${dateStr}" data-date="${dateStr}">`;
    for (let h = SETTINGS.dayStart; h < SETTINGS.dayEnd; h++) {
      const past = isPastSlot(dateStr, h);
      html += `<div class="hour-cell${past ? " past" : ""}"
        data-date="${dateStr}" data-hour="${h}"></div>`;
    }
    html += `</div>`;
  });

  html += `</div>`;  // cal-body
  cal.innerHTML = html;

  // click handlers on available cells
  cal.querySelectorAll(".hour-cell:not(.past)").forEach((cell) => {
    cell.addEventListener("click", () =>
      openBookingModal(cell.dataset.date, parseInt(cell.dataset.hour))
    );
  });

  renderBookings();
  renderNowLine();
  renderDayStrip();
  applyMobileDay();
}

function renderDayStrip() {
  const strip = document.getElementById("day-strip");
  if (!strip) return;

  const days = weekDays(weekOffset);
  strip.innerHTML = days.map((day) => {
    const dateStr  = toDateStr(day);
    const abbr     = day.toLocaleDateString("en", { weekday: "short" });
    const isToday_ = isToday(day);
    const isSel    = dateStr === mobileDayDate;
    return `<button class="day-pill${isToday_ ? " is-today" : ""}${isSel ? " is-selected" : ""}"
      data-date="${dateStr}" aria-label="${day.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}">
      <span class="pill-abbr">${abbr}</span>
      <span class="pill-num">${day.getDate()}</span>
    </button>`;
  }).join("");

  strip.querySelectorAll(".day-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      mobileDayDate = pill.dataset.date;
      applyMobileDay();
      renderDayStrip();
    });
  });
}

function applyMobileDay() {
  document.querySelectorAll(".cal-day-col").forEach((col) => {
    col.classList.toggle("mobile-active", col.dataset.date === mobileDayDate);
  });

  // Keep mobileDayDate in sync when navigating weeks
  const days = weekDays(weekOffset).map(toDateStr);
  if (!days.includes(mobileDayDate)) {
    mobileDayDate = days.find((d) => !isPastDate(fromDateStr(d))) || days[0];
  }
}

function renderBookings() {
  document.querySelectorAll(".booking-block").forEach((el) => el.remove());

  const { dayStart, dayEnd, hourPx } = SETTINGS;

  bookings.forEach((b) => {
    const col = document.getElementById(`col-${b.date}`);
    if (!col) return;

    const startH = timeToHours(b.startTime);
    const endH   = timeToHours(b.endTime);
    if (startH >= dayEnd || endH <= dayStart) return;

    const clampedStart = Math.max(startH, dayStart);
    const clampedEnd   = Math.min(endH,   dayEnd);
    const top    = (clampedStart - dayStart) * hourPx;
    const height = (clampedEnd - clampedStart) * hourPx - 4;

    const past  = isPastSlot(b.date, startH);
    const block = document.createElement("div");
    block.className = `booking-block${past ? " past-booking" : ""}`;
    block.style.top    = `${top}px`;
    block.style.height = `${Math.max(height, 22)}px`;
    block.innerHTML = `
      ${b.groupId ? `<span class="recur-badge" title="Recurring">↻</span>` : ""}
      <div class="booking-block-title">${esc(b.title)}</div>
      <div class="booking-block-time">${b.startTime} – ${b.endTime}</div>
      ${height > 38 ? `<div class="booking-block-name">${esc(b.name)}</div>` : ""}
    `;
    block.addEventListener("click", (e) => {
      e.stopPropagation();
      openViewModal(b);
    });
    col.appendChild(block);
  });
}

function renderNowLine() {
  const todayStr = toDateStr(new Date());
  const col = document.getElementById(`col-${todayStr}`);
  if (!col) return;

  const existing = col.querySelector(".now-line");
  if (existing) existing.remove();

  const now      = new Date();
  const fraction = (now.getHours() - SETTINGS.dayStart) + now.getMinutes() / 60;
  if (fraction < 0 || fraction > (SETTINGS.dayEnd - SETTINGS.dayStart)) return;

  const line = document.createElement("div");
  line.className  = "now-line";
  line.style.top  = `${fraction * SETTINGS.hourPx}px`;
  col.appendChild(line);
}

function updateWeekLabel(days) {
  let label;
  if (isMobile()) {
    const d = fromDateStr(mobileDayDate);
    label = d.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
  } else {
    const first = days[0], last = days[6];
    const sameMonth = first.getMonth() === last.getMonth();
    label = sameMonth
      ? `${first.toLocaleDateString("en", { month: "long" })} ${first.getDate()} – ${last.getDate()}, ${first.getFullYear()}`
      : `${first.toLocaleDateString("en", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en", { month: "short", day: "numeric" })}, ${last.getFullYear()}`;
  }
  document.getElementById("week-label").textContent = label;
}

// ============================================================
// BOOKING MODAL
// ============================================================

function openBookingModal(dateStr, hour) {
  selectedSlot  = { date: dateStr };
  selectedDur   = 1;
  selectedRecur = "none";

  document.getElementById("booking-form").reset();
  document.getElementById("slot-display").textContent = fmtDateLong(dateStr);

  // Reset recurrence UI
  document.querySelectorAll(".recur-grid .dur-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.recur-grid .dur-btn[data-recur="none"]').classList.add("active");
  document.getElementById("recur-days-wrap").classList.add("hidden");
  document.getElementById("recur-end-wrap").classList.add("hidden");
  document.getElementById("recur-hint").classList.add("hidden");

  // Pre-check the booked day of week for weekly recurrence
  const dow = fromDateStr(dateStr).getDay();
  document.querySelectorAll('input[name="rday"]').forEach((cb) => {
    cb.checked = parseInt(cb.value, 10) === dow;
  });

  // Populate time select defaulting to the clicked hour
  const defaultTime = `${pad(hour)}:00`;
  populateTimeSelect(defaultTime);

  // Re-check conflicts whenever start time changes
  const sel = document.getElementById("f-start-time");
  sel.onchange = () => {
    refreshDurButtons();
    document.getElementById("conflict-msg").classList.add("hidden");
    // If selected duration now conflicts, pick first available
    const active = document.querySelector(".dur-btn.active");
    if (active && active.classList.contains("unavail")) {
      const first = document.querySelector(".dur-btn:not(.unavail)");
      if (first) {
        active.classList.remove("active");
        first.classList.add("active");
        selectedDur = parseFloat(first.dataset.h);
      }
    }
  };

  refreshDurButtons();
  document.getElementById("conflict-msg").classList.add("hidden");
  document.getElementById("booking-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("f-title").focus(), 60);
}

function closeBookingModal() {
  document.getElementById("booking-modal").classList.add("hidden");
  selectedSlot = null;
}

function getSelectedStartTime() {
  const sel = document.getElementById("f-start-time");
  return sel ? sel.value : null;
}

function hasConflict(dateStr, startTimeStr, durationHours) {
  const startH = timeToHours(startTimeStr);
  const endH   = startH + durationHours;
  return bookings.some((b) => {
    if (b.date !== dateStr) return false;
    const bs = timeToHours(b.startTime);
    const be = timeToHours(b.endTime);
    return startH < be && endH > bs;
  });
}

function refreshDurButtons() {
  if (!selectedSlot) return;
  const startTime = getSelectedStartTime();
  if (!startTime) return;
  const startH = timeToHours(startTime);

  document.querySelectorAll(".dur-btn").forEach((btn) => {
    const dur = parseFloat(btn.dataset.h);
    const endH = startH + dur;
    btn.classList.remove("active", "unavail");

    if (endH > SETTINGS.dayEnd) {
      btn.classList.add("unavail");
      return;
    }
    if (hasConflict(selectedSlot.date, startTime, dur)) {
      btn.classList.add("unavail");
      return;
    }
    if (dur === selectedDur) btn.classList.add("active");
  });

  // ensure at least the first non-unavailable btn is active
  if (!document.querySelector(".dur-btn.active")) {
    const first = document.querySelector(".dur-btn:not(.unavail)");
    if (first) {
      first.classList.add("active");
      selectedDur = parseFloat(first.dataset.h);
    }
  }
}

function setDuration(dur) {
  const btn = document.querySelector(`.dur-btn[data-h="${dur}"]`);
  if (!btn || btn.classList.contains("unavail")) return;
  selectedDur = dur;
  document.querySelectorAll(".dur-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  const startTime = getSelectedStartTime();
  if (startTime) {
    const clash = hasConflict(selectedSlot.date, startTime, dur);
    document.getElementById("conflict-msg").classList.toggle("hidden", !clash);
  }
}

async function handleBookingSubmit(e) {
  e.preventDefault();

  const title = document.getElementById("f-title").value.trim();
  const name  = document.getElementById("f-name").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const notes = document.getElementById("f-notes").value.trim();

  if (!title || !name || !email) {
    showToast("Please complete all required fields.", "error");
    return;
  }

  if (!selectedSlot) return;

  const startTime = getSelectedStartTime();
  if (!startTime) return;
  const endTime = addHours(startTime, selectedDur);

  // Validate end time doesn't exceed day bounds
  if (timeToHours(endTime) > SETTINGS.dayEnd) {
    showToast("Booking extends past end of day. Please shorten the duration.", "error");
    return;
  }

  // Final conflict guard
  if (hasConflict(selectedSlot.date, startTime, selectedDur)) {
    showToast("This slot has just been taken. Please choose another.", "error");
    return;
  }

  if (!db) {
    showToast("Firebase is not configured. See setup-banner at the top.", "error");
    return;
  }

  // Compute recurring dates
  const endDateStr = document.getElementById("f-recur-end").value;
  const weekDays   = selectedRecur === "weekly" ? getSelectedWeekDays() : [];

  if (selectedRecur === "weekly" && weekDays.length === 0) {
    showToast("Please select at least one day for weekly recurrence.", "error");
    return;
  }

  const dates = computeOccurrences(selectedSlot.date, selectedRecur, weekDays, endDateStr);

  if (dates.length === 0) {
    showToast("No valid dates found for this recurrence.", "error");
    return;
  }

  const btn = document.getElementById("submit-btn");
  btn.disabled    = true;
  btn.textContent = dates.length > 1 ? `Saving ${dates.length} bookings…` : "Saving…";

  const baseData = { title, name, email, notes, startTime, endTime };

  try {
    await saveBatchBookings(baseData, dates);
    closeBookingModal();
    const msg = dates.length > 1
      ? `${dates.length} recurring bookings confirmed!`
      : "Booking confirmed!";
    showToast(msg, "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to save. Please try again.", "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Confirm Booking";
  }
}

// ============================================================
// VIEW MODAL
// ============================================================

function openViewModal(booking) {
  const past = isPastSlot(booking.date, parseInt(booking.startTime, 10));

  const isRecurring = !!booking.groupId;
  const seriesCount = isRecurring
    ? bookings.filter((b) => b.groupId === booking.groupId).length
    : 0;

  document.getElementById("view-details").innerHTML = `
    <div class="detail-row"><span class="detail-lbl">Meeting</span><span class="detail-val">${esc(booking.title)}</span></div>
    ${isRecurring ? `<div class="detail-row"><span class="detail-lbl">Recurs</span><span class="detail-val" style="color:var(--sage)">↻ Recurring · ${seriesCount} booking${seriesCount !== 1 ? "s" : ""} in series</span></div>` : ""}
    <div class="detail-row"><span class="detail-lbl">Date</span><span class="detail-val">${fmtDateLong(booking.date)}</span></div>
    <div class="detail-row"><span class="detail-lbl">Time</span><span class="detail-val">${booking.startTime} – ${booking.endTime}</span></div>
    <div class="detail-row"><span class="detail-lbl">Booked by</span><span class="detail-val">${esc(booking.name)}</span></div>
    <div class="detail-row"><span class="detail-lbl">Email</span><span class="detail-val">${esc(booking.email)}</span></div>
    ${booking.notes ? `<div class="detail-row"><span class="detail-lbl">Notes</span><span class="detail-val">${esc(booking.notes)}</span></div>` : ""}
    <div class="modal-footer" style="margin-top:16px">
      <button class="btn-ghost" id="vm-close-btn">Close</button>
      ${!past && isRecurring ? `
        <button class="btn-outline-danger" id="vm-cancel-one-btn">This Only</button>
        <button class="btn-danger" id="vm-cancel-all-btn">Cancel Series</button>
      ` : !past ? `
        <button class="btn-danger" id="vm-cancel-btn">Cancel Booking</button>
      ` : ""}
    </div>
  `;

  document.getElementById("vm-close-btn").addEventListener("click", () =>
    document.getElementById("view-modal").classList.add("hidden")
  );

  if (!past) {
    if (isRecurring) {
      document.getElementById("vm-cancel-one-btn").addEventListener("click", () => {
        document.getElementById("view-modal").classList.add("hidden");
        openCancelModal(booking.id, booking.groupId, false);
      });
      document.getElementById("vm-cancel-all-btn").addEventListener("click", () => {
        document.getElementById("view-modal").classList.add("hidden");
        openCancelModal(booking.id, booking.groupId, true);
      });
    } else {
      document.getElementById("vm-cancel-btn").addEventListener("click", () => {
        document.getElementById("view-modal").classList.add("hidden");
        openCancelModal(booking.id, null, false);
      });
    }
  }

  document.getElementById("view-modal").classList.remove("hidden");
}

// ============================================================
// CANCEL MODAL
// ============================================================

function openCancelModal(bookingId, groupId, cancelAll) {
  pendingCancel = { id: bookingId, groupId, cancelAll };
  document.getElementById("cancel-email-input").value = "";
  document.getElementById("cancel-error").classList.add("hidden");

  const infoEl = document.getElementById("cancel-info-text");
  if (cancelAll && groupId) {
    const count = bookings.filter((b) => b.groupId === groupId).length;
    infoEl.textContent = `This will cancel all ${count} bookings in this series. Enter your email to confirm.`;
  } else {
    infoEl.textContent = "Enter the email address used when booking to confirm cancellation.";
  }

  document.getElementById("confirm-cancel-btn").textContent =
    cancelAll ? "Cancel Entire Series" : "Cancel Booking";

  document.getElementById("cancel-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("cancel-email-input").focus(), 60);
}

async function handleConfirmCancel() {
  if (!pendingCancel) return;
  const booking = bookings.find((b) => b.id === pendingCancel.id);
  if (!booking) return;

  const entered = document.getElementById("cancel-email-input").value.trim().toLowerCase();
  if (entered !== booking.email.toLowerCase()) {
    document.getElementById("cancel-error").classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("confirm-cancel-btn");
  btn.disabled    = true;
  btn.textContent = "Cancelling…";

  try {
    if (pendingCancel.cancelAll && pendingCancel.groupId) {
      await removeBookingGroup(pendingCancel.groupId);
      showToast("Entire series cancelled.", "success");
    } else {
      await removeBooking(pendingCancel.id);
      showToast("Booking cancelled.", "success");
    }
    document.getElementById("cancel-modal").classList.add("hidden");
    pendingCancel = null;
  } catch (err) {
    console.error(err);
    showToast("Failed to cancel. Please try again.", "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Cancel Booking";
  }
}

// ============================================================
// UTILITIES
// ============================================================

function hideLoading() {
  document.getElementById("loading-overlay").classList.add("hidden");
}

function showToast(msg, type = "success") {
  const t = document.createElement("div");
  t.className   = `toast ${type}`;
  t.textContent = msg;
  document.getElementById("toast-container").appendChild(t);
  setTimeout(() => {
    t.style.animation = "toast-out 0.3s ease forwards";
    setTimeout(() => t.remove(), 320);
  }, 3600);
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function closeAllModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) =>
    m.classList.add("hidden")
  );
}

// ============================================================
// EVENT WIRING
// ============================================================

function wireEvents() {
  // Week / day navigation
  document.getElementById("prev-week").addEventListener("click", () => {
    if (isMobile()) {
      const d = fromDateStr(mobileDayDate);
      d.setDate(d.getDate() - 1);
      mobileDayDate = toDateStr(d);
      const newWeekDays = weekDays(weekOffset).map(toDateStr);
      if (!newWeekDays.includes(mobileDayDate)) weekOffset--;
      renderCalendar();
    } else {
      weekOffset--; renderCalendar();
    }
  });
  document.getElementById("next-week").addEventListener("click", () => {
    if (isMobile()) {
      const d = fromDateStr(mobileDayDate);
      d.setDate(d.getDate() + 1);
      mobileDayDate = toDateStr(d);
      const newWeekDays = weekDays(weekOffset).map(toDateStr);
      if (!newWeekDays.includes(mobileDayDate)) weekOffset++;
      renderCalendar();
    } else {
      weekOffset++; renderCalendar();
    }
  });
  document.getElementById("today-btn").addEventListener("click", () => {
    weekOffset = 0;
    mobileDayDate = toDateStr(new Date());
    renderCalendar();
  });

  // Booking modal
  document.getElementById("close-booking-modal").addEventListener("click", closeBookingModal);
  document.getElementById("cancel-form").addEventListener("click", closeBookingModal);
  document.getElementById("booking-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeBookingModal();
  });
  document.getElementById("booking-form").addEventListener("submit", handleBookingSubmit);

  // Duration grid
  document.getElementById("dur-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".dur-btn");
    if (btn && !btn.classList.contains("unavail"))
      setDuration(parseFloat(btn.dataset.h));
  });

  // View modal
  document.getElementById("close-view-modal").addEventListener("click", () =>
    document.getElementById("view-modal").classList.add("hidden")
  );
  document.getElementById("view-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget)
      document.getElementById("view-modal").classList.add("hidden");
  });

  // Cancel modal
  document.getElementById("close-cancel-modal").addEventListener("click", () =>
    document.getElementById("cancel-modal").classList.add("hidden")
  );
  document.getElementById("dismiss-cancel").addEventListener("click", () =>
    document.getElementById("cancel-modal").classList.add("hidden")
  );
  document.getElementById("cancel-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget)
      document.getElementById("cancel-modal").classList.add("hidden");
  });
  document.getElementById("confirm-cancel-btn").addEventListener("click", handleConfirmCancel);
  document.getElementById("cancel-email-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConfirmCancel();
  });

  // Recurrence type selector
  document.getElementById("recur-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".dur-btn[data-recur]");
    if (!btn) return;

    selectedRecur = btn.dataset.recur;
    document.querySelectorAll(".recur-grid .dur-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const isRecur = selectedRecur !== "none";
    document.getElementById("recur-days-wrap").classList.toggle("hidden", selectedRecur !== "weekly");
    document.getElementById("recur-end-wrap").classList.toggle("hidden", !isRecur);

    if (isRecur && selectedSlot) {
      const endEl = document.getElementById("f-recur-end");
      endEl.min   = selectedSlot.date;
      if (!endEl.value) endEl.value = defaultEndDate(selectedSlot.date, selectedRecur);
      updateRecurHint();
    } else {
      document.getElementById("recur-hint").classList.add("hidden");
    }
  });

  // Day checkboxes and end date — update hint on change
  document.getElementById("recur-day-checks").addEventListener("change", updateRecurHint);
  document.getElementById("f-recur-end").addEventListener("change", updateRecurHint);

  // Escape key closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });
}

// ============================================================
// BOOT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("room-name-heading").textContent = SETTINGS.roomName;
  wireEvents();
  renderCalendar();
  initFirebase();

  // Update the "now" line every minute
  setInterval(() => {
    renderNowLine();
    // Re-mark past cells without full redraw
    document.querySelectorAll(".hour-cell:not(.past)").forEach((cell) => {
      if (isPastSlot(cell.dataset.date, parseInt(cell.dataset.hour, 10))) {
        cell.classList.add("past");
        cell.style.cursor = "default";
      }
    });
  }, 60_000);
});
