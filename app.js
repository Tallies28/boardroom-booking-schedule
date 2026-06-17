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

async function removeBooking(id) {
  return deleteDoc(doc(db, "bookings", id));
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

function fmtHour(h) {
  if (h === 0)   return "12:00 AM";
  if (h < 12)    return `${h}:00 AM`;
  if (h === 12)  return "12:00 PM";
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

    const startH = parseInt(b.startTime.split(":")[0], 10);
    const endH   = parseInt(b.endTime.split(":")[0],   10);
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
  selectedSlot = { date: dateStr, hour };
  selectedDur  = 1;

  document.getElementById("booking-form").reset();
  document.getElementById("slot-display").textContent =
    `${fmtDateLong(dateStr)}  ·  ${fmtHour(hour)}`;

  refreshDurButtons();
  document.getElementById("conflict-msg").classList.add("hidden");
  document.getElementById("booking-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("f-title").focus(), 60);
}

function closeBookingModal() {
  document.getElementById("booking-modal").classList.add("hidden");
  selectedSlot = null;
}

function refreshDurButtons() {
  if (!selectedSlot) return;
  document.querySelectorAll(".dur-btn").forEach((btn) => {
    const h   = parseInt(btn.dataset.h, 10);
    const end = selectedSlot.hour + h;
    btn.classList.remove("active", "unavail");

    if (end > SETTINGS.dayEnd) {
      btn.classList.add("unavail");
      return;
    }

    const clash = bookings.some((b) => {
      if (b.date !== selectedSlot.date) return false;
      const bs = parseInt(b.startTime, 10);
      const be = parseInt(b.endTime,   10);
      return selectedSlot.hour < be && end > bs;
    });

    if (clash) btn.classList.add("unavail");
    if (h === selectedDur && !clash && end <= SETTINGS.dayEnd)
      btn.classList.add("active");
  });

  // ensure at least the first non-unavailable btn is active
  const active = document.querySelector(".dur-btn.active");
  if (!active) {
    const first = document.querySelector(".dur-btn:not(.unavail)");
    if (first) {
      first.classList.add("active");
      selectedDur = parseInt(first.dataset.h, 10);
    }
  }
}

function setDuration(h) {
  const btn = document.querySelector(`.dur-btn[data-h="${h}"]`);
  if (!btn || btn.classList.contains("unavail")) return;
  selectedDur = h;
  document.querySelectorAll(".dur-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  // Check whether THIS exact slot+duration conflicts
  const endH = selectedSlot.hour + h;
  const clash = bookings.some((b) => {
    if (b.date !== selectedSlot.date) return false;
    const bs = parseInt(b.startTime, 10);
    const be = parseInt(b.endTime,   10);
    return selectedSlot.hour < be && endH > bs;
  });
  document.getElementById("conflict-msg").classList.toggle("hidden", !clash);
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

  const startH = selectedSlot.hour;
  const endH   = startH + selectedDur;

  // Final conflict guard
  const clash = bookings.some((b) => {
    if (b.date !== selectedSlot.date) return false;
    const bs = parseInt(b.startTime, 10);
    const be = parseInt(b.endTime,   10);
    return startH < be && endH > bs;
  });

  if (clash) {
    showToast("This slot has just been taken. Please choose another.", "error");
    return;
  }

  if (!db) {
    showToast("Firebase is not configured. See setup-banner at the top.", "error");
    return;
  }

  const btn = document.getElementById("submit-btn");
  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    await saveBooking({
      title, name, email, notes,
      date:      selectedSlot.date,
      startTime: `${pad(startH)}:00`,
      endTime:   `${pad(endH)}:00`,
    });
    closeBookingModal();
    showToast("Booking confirmed!", "success");
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

  document.getElementById("view-details").innerHTML = `
    <div class="detail-row"><span class="detail-lbl">Meeting</span><span class="detail-val">${esc(booking.title)}</span></div>
    <div class="detail-row"><span class="detail-lbl">Date</span><span class="detail-val">${fmtDateLong(booking.date)}</span></div>
    <div class="detail-row"><span class="detail-lbl">Time</span><span class="detail-val">${booking.startTime} – ${booking.endTime}</span></div>
    <div class="detail-row"><span class="detail-lbl">Booked by</span><span class="detail-val">${esc(booking.name)}</span></div>
    <div class="detail-row"><span class="detail-lbl">Email</span><span class="detail-val">${esc(booking.email)}</span></div>
    ${booking.notes ? `<div class="detail-row"><span class="detail-lbl">Notes</span><span class="detail-val">${esc(booking.notes)}</span></div>` : ""}
    <div class="modal-footer" style="margin-top:16px">
      <button class="btn-ghost" id="vm-close-btn">Close</button>
      ${!past ? `<button class="btn-danger" id="vm-cancel-btn">Cancel Booking</button>` : ""}
    </div>
  `;

  document.getElementById("vm-close-btn").addEventListener("click", () =>
    document.getElementById("view-modal").classList.add("hidden")
  );

  if (!past) {
    document.getElementById("vm-cancel-btn").addEventListener("click", () => {
      document.getElementById("view-modal").classList.add("hidden");
      openCancelModal(booking.id);
    });
  }

  document.getElementById("view-modal").classList.remove("hidden");
}

// ============================================================
// CANCEL MODAL
// ============================================================

function openCancelModal(bookingId) {
  pendingCancel = bookingId;
  document.getElementById("cancel-email-input").value = "";
  document.getElementById("cancel-error").classList.add("hidden");
  document.getElementById("cancel-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("cancel-email-input").focus(), 60);
}

async function handleConfirmCancel() {
  const booking = bookings.find((b) => b.id === pendingCancel);
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
    await removeBooking(pendingCancel);
    document.getElementById("cancel-modal").classList.add("hidden");
    pendingCancel = null;
    showToast("Booking cancelled.", "success");
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
      setDuration(parseInt(btn.dataset.h, 10));
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
