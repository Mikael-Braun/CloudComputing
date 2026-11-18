import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator, sendEmailVerification, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp, connectFirestoreEmulator, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCb6aOBLBmDhQwf-isNMu1mYI2kCRwrj1U",
  authDomain: "cn-robottaxi.firebaseapp.com",
  projectId: "cn-robottaxi",
  storageBucket: "cn-robottaxi.firebasestorage.app",
  messagingSenderId: "127042854854",
  appId: "1:127042854854:web:2f75f78b9839bac3d0dcc7"
};

// Em localhost usa os emuladores (npm run serve) com um projeto demo, nunca os dados reais.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const app = initializeApp(local ? { ...firebaseConfig, projectId: "demo-robotaxi" } : firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (local) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const POINTS = ["Entrada Norte", "Entrada Sul", "Biblioteca", "Cantina", "Residências", "Parque de Estacionamento"];
// Blocos fixos de 30 minutos, 08:00–19:30.
const SLOTS = Array.from({ length: 24 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const MIN_BATTERY = 20; // igual a minBattery() em firestore.rules
const TRIP_BATTERY = 5; // % gasta em cada viagem concluída
const STATUS = { active: "Ativo", maintenance: "Em Manutenção", inactive: "Inativo" };
const TRIP_STATUS = { booked: "Reservada", in_progress: "Em curso", completed: "Concluída" };
const WEEKDAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
const STATS_HOURS = Array.from({ length: 12 }, (_, index) => `${String(index + 8).padStart(2, "0")}h`);
const DAY_MS = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const showError = (err) => { $("app-error").innerText = err ? err.message : ""; };

let me = null;          // { uid, name, role }
let vehicles = [];
let myReservations = [];
let managerReservations = [];
let myFeedback = [];
let managerFeedback = [];
let activeFeedbackReservationId = null;
let unsubs = [];
let gridUnsub = null;
let gridReservations = [];
let managerStatsExportData = null;

for (const sel of document.querySelectorAll(".points")) sel.innerHTML = POINTS.map((p) => `<option>${esc(p)}</option>`).join("");
for (const sel of document.querySelectorAll(".slots")) sel.innerHTML = SLOTS.map((s) => `<option>${s}</option>`).join("");
for (const id of ["fleet-search", "fleet-status-filter", "fleet-location-filter", "fleet-battery-filter"]) {
  $(id).addEventListener(id === "fleet-search" ? "input" : "change", renderFleet);
}
for (const id of ["reservation-status-filter", "reservation-vehicle-filter", "reservation-date-from", "reservation-date-to", "reservation-search"]) {
  const el = $(id);
  if (!el) continue;
  if (id === "reservation-search") { el.addEventListener("input", renderMyReservations); }
  else { el.addEventListener("change", renderMyReservations); }
}
$("stats-period").addEventListener("change", () => {
  if ($("stats-period").value !== "custom") setStatsPeriod($("stats-period").value);
  renderManagerStats();
});
$("stats-vehicle-filter").addEventListener("change", renderManagerStats);
$("stats-date-from").addEventListener("change", () => {
  $("stats-period").value = "custom";
  renderManagerStats();
});
$("stats-date-to").addEventListener("change", () => {
  $("stats-period").value = "custom";
  renderManagerStats();
});
$("stats-export-open").addEventListener("click", () => $("stats-export-dialog").showModal());
$("stats-export-confirm").addEventListener("click", () => {
  const format = $("stats-export-format").value;
  $("stats-export-dialog").close();
  exportManagerStats(format);
});
$("feedback-submit").addEventListener("click", submitTripFeedback);
$("feedback-dialog").addEventListener("close", () => { activeFeedbackReservationId = null; });
setStatsPeriod("30");
const today = new Date().toISOString().slice(0, 10);
$("r-date").value = today;
$("r-date").min = today;
$("grid-date").value = today;

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  if (gridUnsub) { gridUnsub(); gridUnsub = null; }
  $("auth-container").classList.toggle("hidden", !!user);
  $("verify-container").classList.toggle("hidden", !user || user.emailVerified);
  $("user-container").classList.toggle("hidden", !user?.emailVerified);
  if (!user) { me = null; myFeedback = []; managerFeedback = []; return; }
  // As regras recusam tudo a contas com e-mail por confirmar.
  if (!user.emailVerified) { $("verify-email").innerText = user.email; return; }

  const ref = doc(db, "users", user.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    // Contas criadas antes do Firestore (ou sem perfil) recebem o perfil de passageiro.
    await setDoc(ref, { uid: user.uid, name: $("name").value || user.email, email: user.email, role: "passenger", createdAt: serverTimestamp() });
    snap = await getDoc(ref);
  }
  me = snap.data();
  $("user-email").innerText = me.name || user.email;
  $("user-role").innerText = me.role === "manager" ? "Gestor de Frota" : "Passageiro";
  const isManager = me.role === "manager";
  document.querySelectorAll(".manager-only").forEach((el) => el.classList.toggle("hidden", !isManager));
  document.querySelectorAll(".passenger-only").forEach((el) => el.classList.toggle("hidden", isManager));

  // Atualizações em tempo real (simulação feita pelo gestor chega logo aos passageiros).
  unsubs.push(onSnapshot(collection(db, "vehicles"), (qs) => {
    vehicles = qs.docs.map((d) => d.data()).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    renderFleet();
    renderGrid();
    renderManagerFeedback();
  }, showError));

  if (!isManager) {
    myFeedback = [];
    unsubs.push(onSnapshot(query(collection(db, "reservations"), where("userId", "==", user.uid)), (qs) => {
      myReservations = qs.docs.map((d) => d.data()).sort((a, b) => (a.date + a.timeSlot).localeCompare(b.date + b.timeSlot));
      renderMyReservations();
    }, showError));
    unsubs.push(onSnapshot(query(collection(db, "feedback"), where("userId", "==", user.uid)), (qs) => {
      myFeedback = qs.docs.map((d) => d.data());
      renderMyReservations();
    }, showError));
    managerReservations = [];
    managerFeedback = [];
  } else {
    myFeedback = [];
    unsubs.push(onSnapshot(collection(db, "reservations"), (qs) => {
      managerReservations = qs.docs.map((d) => d.data());
      renderManagerStats();
      renderManagerFeedback();
    }, showError));
    unsubs.push(onSnapshot(collection(db, "feedback"), (qs) => {
      managerFeedback = qs.docs.map((d) => d.data());
      renderManagerFeedback();
    }, showError));
  }
  watchGrid();
});

function renderMyReservations() {
  const statusFilter = $("reservation-status-filter").value;
  const vehicleFilter = $("reservation-vehicle-filter").value;
  const dateFrom = $("reservation-date-from").value;
  const dateTo = $("reservation-date-to").value;
  const search = $("reservation-search").value.trim().toLowerCase();

  if (dateFrom && dateTo && dateFrom > dateTo) {
    $("reservation-count").textContent = "Intervalo inválido";
    $("my-reservations").innerHTML = `<tr><td class="error" colspan="7">A data inicial não pode ser posterior à data final.</td></tr>`;
    return;
  }

  const filtered = myReservations.filter((r) => {
    const matchesStatus = !statusFilter || r.status === statusFilter;
    const matchesVehicle = !vehicleFilter || r.vehicleId === vehicleFilter;
    const matchesDateFrom = !dateFrom || r.date >= dateFrom;
    const matchesDateTo = !dateTo || r.date <= dateTo;
    const text = `${r.vehicleId} ${r.date} ${r.timeSlot} ${r.pickupPoint} ${r.dropoffPoint} ${TRIP_STATUS[r.status] || r.status}`.toLowerCase();
    const matchesSearch = !search || text.includes(search);
    return matchesStatus && matchesVehicle && matchesDateFrom && matchesDateTo && matchesSearch;
  });

  $("reservation-count").textContent = `${filtered.length} ${filtered.length === 1 ? "reserva" : "reservas"}`;
  $("my-reservations").innerHTML = filtered.map((r) => {
    const feedback = myFeedback.find((item) => item.reservationId === r.reservationId);
    const cancelAction = r.status === "booked"
      ? `<button class="danger" onclick="cancelReservation('${esc(r.reservationId)}')">Cancelar</button>`
      : "";
    const feedbackAction = r.status !== "completed"
      ? "—"
      : feedback
        ? `<span class="feedback-rating" aria-label="Avaliação enviada: ${feedback.rating} em 5">Enviado (${feedback.rating}/5)</span>`
        : `<button class="secondary" type="button" onclick="openTripFeedback('${esc(r.reservationId)}')">Avaliar táxi</button>`;
    const actions = [cancelAction, feedbackAction].filter((action) => action && action !== "—").join(" ");
    return `<tr><td>${esc(r.vehicleId)}</td><td>${esc(formatDisplayDate(r.date))}</td><td>${esc(r.timeSlot)}</td>
    <td>${esc(r.pickupPoint)}</td><td>${esc(r.dropoffPoint)}</td><td>${esc(TRIP_STATUS[r.status] || r.status)}</td>
    <td>${actions || "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="7">Sem reservas para estes filtros.</td></tr>`;
}

function renderManagerFeedback() {
  const container = $("manager-feedback-list");
  if (!container) return;
  const sorted = [...managerFeedback].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  container.innerHTML = sorted.map((feedback) => {
    const reservation = managerReservations.find((item) => item.reservationId === feedback.reservationId);
    const vehicle = vehicles.find((item) => item.vehicleId === feedback.vehicleId);
    const rating = Math.min(5, Math.max(0, Math.round(Number(feedback.rating) || 0)));
    const stars = `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
    const trip = reservation ? `${formatDisplayDate(reservation.date)} às ${reservation.timeSlot}` : "Viagem concluída";
    return `<article class="feedback-item">
      <div class="feedback-item-header">
        <strong>${esc(vehicle?.name || feedback.vehicleId)}</strong>
        <span>${esc(trip)}</span>
        <span class="feedback-rating" aria-label="${rating} em 5">${stars} (${rating}/5)</span>
      </div>
      <p>${feedback.comment ? esc(feedback.comment) : "Sem comentário escrito."}</p>
    </article>`;
  }).join("") || `<p class="stats-empty">Ainda não há feedback sobre viagens concluídas.</p>`;
}

function renderVehicleFilters() {
  const reservationVehicleFilter = $("reservation-vehicle-filter");
  const sorted = [...new Set(vehicles.map((v) => v.vehicleId))].sort((a, b) => a.localeCompare(b));
  if (reservationVehicleFilter) {
    const currentValue = reservationVehicleFilter.value;
    reservationVehicleFilter.innerHTML = `<option value="">Todos os veículos</option>${sorted
      .map((vehicleId) => `<option value="${esc(vehicleId)}">${esc(vehicleId)}</option>`).join("")}`;
    if (sorted.includes(currentValue)) reservationVehicleFilter.value = currentValue;
  }

  const statsVehicleFilter = $("stats-vehicle-filter");
  if (statsVehicleFilter) {
    const currentValue = statsVehicleFilter.value;
    statsVehicleFilter.innerHTML = `<option value="">Todos os táxis</option>${sorted
      .map((vehicleId) => {
        const vehicle = vehicles.find((item) => item.vehicleId === vehicleId);
        return `<option value="${esc(vehicleId)}">${esc(vehicle?.name || vehicleId)}</option>`;
      }).join("")}`;
    statsVehicleFilter.value = sorted.includes(currentValue) ? currentValue : "";
  }
  renderManagerStats();
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

function dateOrdinal(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatOrdinalDate(ordinal) {
  const date = new Date(ordinal);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function setStatsPeriod(days) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - Number(days) + 1);
  $("stats-date-from").value = formatLocalDate(start);
  $("stats-date-to").value = formatLocalDate(end);
}

window.clearStatsFilters = () => {
  $("stats-vehicle-filter").value = "";
  $("stats-period").value = "30";
  setStatsPeriod("30");
  renderManagerStats();
};

function renderStatsBars(containerId, entries) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.value));
  $(containerId).innerHTML = entries.map((entry) => {
    const width = (entry.value / maximum) * 100;
    return `<div class="stats-bar-row" role="img" aria-label="${esc(entry.label)}: ${entry.value} ${entry.value === 1 ? "reserva" : "reservas"}">
      <span class="stats-bar-label" title="${esc(entry.label)}">${esc(entry.label)}</span>
      <span class="stats-bar-track"><span class="stats-bar-fill" style="width:${width}%"></span></span>
      <strong>${entry.value}</strong>
    </div>`;
  }).join("") || `<p class="stats-empty">Sem dados para apresentar.</p>`;
}

function buildTrendBuckets(dateFrom, dateTo, reservations) {
  const start = dateOrdinal(dateFrom);
  const end = dateOrdinal(dateTo);
  const dayCount = Math.floor((end - start) / DAY_MS) + 1;
  const unit = dayCount <= 90 ? "day" : dayCount <= 365 ? "week" : "month";
  const buckets = [];

  if (unit === "day" || unit === "week") {
    const bucketSize = unit === "day" ? 1 : 7;
    for (let offset = 0; offset < dayCount; offset += bucketSize) {
      const bucketStart = start + offset * DAY_MS;
      const bucketEnd = Math.min(end, bucketStart + (bucketSize - 1) * DAY_MS);
      const label = unit === "day"
        ? formatDisplayDate(formatOrdinalDate(bucketStart))
        : `${formatDisplayDate(formatOrdinalDate(bucketStart))}–${formatDisplayDate(formatOrdinalDate(bucketEnd))}`;
      buckets.push({ key: unit === "day" ? String(offset) : String(Math.floor(offset / bucketSize)), label, value: 0 });
    }
  } else {
    const startDate = new Date(start);
    for (let cursor = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1);
      cursor <= end;
      cursor = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1)) {
      const date = new Date(cursor);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      buckets.push({ key, label: `${String(date.getUTCMonth() + 1).padStart(2, "0")}/01/${date.getUTCFullYear()}`, value: 0 });
    }
  }

  const bucketsByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const reservation of reservations) {
    const ordinal = dateOrdinal(reservation.date);
    if (!Number.isFinite(ordinal) || ordinal < start || ordinal > end) continue;
    const key = unit === "month"
      ? reservation.date.slice(0, 7)
      : String(Math.floor((ordinal - start) / (unit === "week" ? 7 * DAY_MS : DAY_MS)));
    const bucket = bucketsByKey.get(key);
    if (bucket) bucket.value += 1;
  }
  return { buckets, unit };
}

function renderStatsTrend(dateFrom, dateTo, reservations, trendData = buildTrendBuckets(dateFrom, dateTo, reservations)) {
  const { buckets, unit } = trendData;
  const chartWidth = 900;
  const chartHeight = 330;
  const plotX = 56;
  const plotY = 28;
  const plotWidth = 820;
  const plotHeight = 232;
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.value));
  const ticks = [...new Set([0, Math.ceil(maximum / 2), maximum])];
  const x = (index) => buckets.length < 2
    ? plotX + plotWidth / 2
    : plotX + (index / (buckets.length - 1)) * plotWidth;
  const y = (value) => plotY + plotHeight - (value / maximum) * plotHeight;
  const grid = ticks.map((tick) => `<line class="stats-chart-grid" x1="${plotX}" y1="${y(tick)}" x2="${plotX + plotWidth}" y2="${y(tick)}"></line>
    <text class="stats-chart-axis-label" x="${plotX - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join("");
  const points = buckets.map((bucket, index) => `${x(index)},${y(bucket.value)}`).join(" ");
  const markers = buckets.map((bucket, index) => `<g>
    <title>${esc(bucket.label)}: ${bucket.value} ${bucket.value === 1 ? "reserva" : "reservas"}</title>
    <circle class="stats-trend-point" cx="${x(index)}" cy="${y(bucket.value)}" r="3"></circle>
  </g>`).join("");
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));
  const labelIndexes = [];
  for (let index = 0; index < buckets.length; index += labelStep) labelIndexes.push(index);
  const lastIndex = buckets.length - 1;
  if (labelIndexes[labelIndexes.length - 1] !== lastIndex) {
    if (buckets.length > 8 && labelIndexes[labelIndexes.length - 1] === lastIndex - 1) labelIndexes.pop();
    labelIndexes.push(lastIndex);
  }
  const visibleLabels = new Set(labelIndexes);
  const labels = buckets.map((bucket, index) => visibleLabels.has(index)
    ? `<text class="stats-chart-category" x="${x(index)}" y="${plotY + plotHeight + 24}" text-anchor="middle">${esc(bucket.label)}</text>`
    : "").join("");
  $("stats-trend-chart").innerHTML = `<svg class="stats-chart-svg stats-trend-svg" role="img" aria-label="Reservas ao longo do tempo" viewBox="0 0 ${chartWidth} ${chartHeight}" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <polyline class="stats-trend-line" points="${points}"></polyline>
    ${markers}${labels}
    <text class="stats-chart-axis-label" x="14" y="${plotY + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 14 ${plotY + plotHeight / 2})">Reservas</text>
    <text class="stats-chart-axis-label" x="${plotX + plotWidth / 2}" y="${chartHeight - 8}" text-anchor="middle">${unit === "day" ? "Dia" : unit === "week" ? "Semana" : "Mês"}</text>
  </svg>`;
}

function renderManagerStats() {
  if (me?.role !== "manager") return;
  const selectedVehicle = $("stats-vehicle-filter").value;
  const dateFrom = $("stats-date-from").value;
  const dateTo = $("stats-date-to").value;
  const start = dateOrdinal(dateFrom);
  const end = dateOrdinal(dateTo);
  if (!dateFrom || !dateTo || !Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    managerStatsExportData = null;
    $("stats-export-open").disabled = true;
    $("stats-reservation-count").textContent = "Seleciona um intervalo de datas válido.";
    $("stats-total").textContent = "—";
    $("stats-completed").textContent = "—";
    $("stats-in-progress").textContent = "—";
    $("stats-average-per-taxi").textContent = "—";
    $("stats-period-comparison").textContent = "";
    $("stats-trend-chart").innerHTML = `<p class="stats-empty">Seleciona uma data inicial e final válidas para ver as estatísticas.</p>`;
    $("stats-weekday-chart").innerHTML = "";
    $("stats-hour-chart").innerHTML = "";
    $("stats-taxi-chart").innerHTML = "";
    $("stats-taxi-summary").innerHTML = "";
    return;
  }

  const filtered = managerReservations.filter((reservation) => {
    const ordinal = dateOrdinal(reservation.date);
    return (!selectedVehicle || reservation.vehicleId === selectedVehicle)
      && Number.isFinite(ordinal) && ordinal >= start && ordinal <= end;
  });
  const dayCount = Math.floor((end - start) / DAY_MS) + 1;
  const previousEnd = start - DAY_MS;
  const previousStart = previousEnd - (dayCount - 1) * DAY_MS;
  const previousCount = managerReservations.filter((reservation) => {
    const ordinal = dateOrdinal(reservation.date);
    return (!selectedVehicle || reservation.vehicleId === selectedVehicle)
      && Number.isFinite(ordinal) && ordinal >= previousStart && ordinal <= previousEnd;
  }).length;
  const completed = filtered.filter((reservation) => reservation.status === "completed").length;
  const inProgress = filtered.filter((reservation) => reservation.status === "in_progress").length;
  const visibleFleet = vehicles.filter((vehicle) => !selectedVehicle || vehicle.vehicleId === selectedVehicle);
  const average = visibleFleet.length
    ? (filtered.length / visibleFleet.length).toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "—";

  $("stats-total").textContent = String(filtered.length);
  $("stats-completed").textContent = String(completed);
  $("stats-in-progress").textContent = String(inProgress);
  $("stats-average-per-taxi").textContent = average;
  $("stats-reservation-count").textContent = `${filtered.length} ${filtered.length === 1 ? "reserva" : "reservas"} no período`;
  const comparison = previousCount
    ? `${filtered.length - previousCount > 0 ? "+" : ""}${Math.round(((filtered.length - previousCount) / previousCount) * 100)}% vs. período anterior (${previousCount} reservas)`
    : filtered.length ? "Sem reservas no período anterior" : "Sem reservas neste nem no período anterior";
  $("stats-period-comparison").textContent = comparison;

  const trendData = buildTrendBuckets(dateFrom, dateTo, filtered);
  renderStatsTrend(dateFrom, dateTo, filtered, trendData);
  const weekdayCounts = new Map(WEEKDAYS.map((day) => [day, 0]));
  const hourCounts = new Map(STATS_HOURS.map((hour) => [hour, 0]));
  for (const reservation of filtered) {
    const ordinal = dateOrdinal(reservation.date);
    const weekday = WEEKDAYS[(new Date(ordinal).getUTCDay() + 6) % 7];
    if (weekdayCounts.has(weekday)) weekdayCounts.set(weekday, weekdayCounts.get(weekday) + 1);
    const hour = `${String(reservation.timeSlot || "").slice(0, 2)}h`;
    if (hourCounts.has(hour)) hourCounts.set(hour, hourCounts.get(hour) + 1);
  }
  const weekdayStats = [...weekdayCounts].map(([label, value]) => ({ label, value }));
  const hourStats = [...hourCounts].map(([label, value]) => ({ label, value }));
  renderStatsBars("stats-weekday-chart", weekdayStats);
  renderStatsBars("stats-hour-chart", hourStats);

  const taxiStats = new Map(visibleFleet.map((vehicle) => [vehicle.vehicleId, {
    vehicleId: vehicle.vehicleId,
    name: vehicle.name || vehicle.vehicleId,
    total: 0,
    booked: 0,
    inProgress: 0,
    completed: 0
  }]));
  for (const reservation of filtered) {
    if (!taxiStats.has(reservation.vehicleId)) {
      taxiStats.set(reservation.vehicleId, {
        vehicleId: reservation.vehicleId,
        name: reservation.vehicleId || "Táxi desconhecido",
        total: 0,
        booked: 0,
        inProgress: 0,
        completed: 0
      });
    }
    const taxi = taxiStats.get(reservation.vehicleId);
    taxi.total += 1;
    if (reservation.status === "booked") taxi.booked += 1;
    if (reservation.status === "in_progress") taxi.inProgress += 1;
    if (reservation.status === "completed") taxi.completed += 1;
  }
  const sortedTaxiStats = [...taxiStats.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt"));
  renderStatsBars("stats-taxi-chart", sortedTaxiStats.map((taxi) => ({
    label: taxi.name,
    value: taxi.total
  })));
  $("stats-taxi-summary").innerHTML = sortedTaxiStats.map((taxi) => `<tr>
    <td>${esc(taxi.name)}</td><td>${taxi.total}</td><td>${taxi.booked}</td>
    <td>${taxi.inProgress}</td><td>${taxi.completed}</td>
  </tr>`).join("") || `<tr><td colspan="5">Sem táxis para apresentar.</td></tr>`;
  const selectedVehicleData = visibleFleet.find((vehicle) => vehicle.vehicleId === selectedVehicle);
  managerStatsExportData = {
    dateFrom: formatDisplayDate(dateFrom),
    dateTo: formatDisplayDate(dateTo),
    vehicleName: selectedVehicle
      ? selectedVehicleData?.name || selectedVehicle
      : "Todos os táxis",
    total: filtered.length,
    completed,
    inProgress,
    average,
    comparison,
    trendUnit: trendData.unit,
    trendBuckets: trendData.buckets.map(({ label, value }) => ({ label, value })),
    weekdayStats,
    hourStats,
    taxiStats: sortedTaxiStats.map((taxi) => ({ ...taxi }))
  };
  $("stats-export-open").disabled = false;
}

function downloadStatsFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportStatsCsv(data) {
  const rows = [
    ["Secção", "Categoria", "Indicador", "Valor"],
    ["Filtros", "Período", "Data inicial", data.dateFrom],
    ["Filtros", "Período", "Data final", data.dateTo],
    ["Filtros", "Táxi", "Selecionado", data.vehicleName],
    ["Resumo", "Reservas", "Total", data.total],
    ["Resumo", "Viagens", "Concluídas", data.completed],
    ["Resumo", "Viagens", "Em curso", data.inProgress],
    ["Resumo", "Reservas", "Média por táxi", data.average],
    ["Resumo", "Período anterior", "Comparação", data.comparison],
    ...data.trendBuckets.map((bucket) => ["Série temporal", bucket.label, "Reservas", bucket.value]),
    ...data.weekdayStats.map((entry) => ["Procura por dia da semana", entry.label, "Reservas", entry.value]),
    ...data.hourStats.map((entry) => ["Procura por hora", entry.label, "Reservas", entry.value]),
    ...data.taxiStats.flatMap((taxi) => [
      ["Resumo por táxi", taxi.name, "Total", taxi.total],
      ["Resumo por táxi", taxi.name, "Reservadas", taxi.booked],
      ["Resumo por táxi", taxi.name, "Em curso", taxi.inProgress],
      ["Resumo por táxi", taxi.name, "Concluídas", taxi.completed]
    ])
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  downloadStatsFile(`estatisticas-${data.dateFrom}-${data.dateTo}.csv`, csv, "text/csv;charset=utf-8");
}

function exportStatsChartSvg(data) {
  const source = $("stats-trend-chart").querySelector("svg");
  if (!source) {
    showError(new Error("Não foi possível encontrar o gráfico para exportar."));
    return;
  }
  const svg = source.cloneNode(true);
  const styleRules = [
    ["stats-chart-svg", ["font-family"]],
    ["stats-chart-grid", ["stroke", "stroke-width"]],
    ["stats-chart-axis-label", ["fill", "font-size"]],
    ["stats-chart-category", ["fill", "font-size"]],
    ["stats-trend-line", ["fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-linecap"]],
    ["stats-trend-point", ["fill", "stroke", "stroke-width"]]
  ].map(([className, properties]) => {
    const element = className === "stats-chart-svg" ? source : source.querySelector(`.${className}`);
    if (!element) return "";
    const computed = getComputedStyle(element);
    const declarations = properties.map((property) => `${property}:${computed.getPropertyValue(property)}`).join(";");
    return `.${className}{${declarations}}`;
  }).filter(Boolean).join("\n");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = styleRules;
  svg.insertBefore(style, svg.firstChild);
  const content = new XMLSerializer().serializeToString(svg);
  downloadStatsFile(`grafico-estatisticas-${data.dateFrom}-${data.dateTo}.svg`, content, "image/svg+xml;charset=utf-8");
}

function exportManagerStats(format) {
  if (!managerStatsExportData) {
    showError(new Error("Seleciona um intervalo de datas válido antes de exportar."));
    return;
  }
  showError(null);
  if (format === "pdf") {
    document.body.classList.add("printing-stats");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-stats"), { once: true });
    window.print();
  } else if (format === "csv") {
    exportStatsCsv(managerStatsExportData);
  } else if (format === "svg") {
    exportStatsChartSvg(managerStatsExportData);
  } else {
    showError(new Error("Formato de exportação desconhecido."));
  }
}

function renderFleet() {
  renderVehicleFilters();
  const isManager = me?.role === "manager";
  const locationFilter = $("fleet-location-filter");
  const selectedLocation = locationFilter.value;
  const locations = [...new Set(vehicles.map((v) => v.currentLocation).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  locationFilter.innerHTML = `<option value="">Todas as localizações</option>${locations
    .map((location) => `<option value="${esc(location)}">${esc(location)}</option>`).join("")}`;
  if (locations.includes(selectedLocation)) locationFilter.value = selectedLocation;

  const search = $("fleet-search").value.trim().toLocaleLowerCase();
  const status = $("fleet-status-filter").value;
  const location = locationFilter.value;
  const battery = $("fleet-battery-filter").value;
  const filteredVehicles = vehicles.filter((v) => {
    const searchableText = `${v.vehicleId} ${v.name}`.toLocaleLowerCase();
    const level = Number(v.batteryLevel);
    const matchesBattery = !battery
      || (battery === "75" && level >= 75)
      || (battery === "50-74" && level >= 50 && level <= 74)
      || (battery === "25-49" && level >= 25 && level <= 49)
      || (battery === "0-24" && level >= 0 && level < 25);
    return searchableText.includes(search)
      && (!status || v.status === status)
      && (!location || v.currentLocation === location)
      && matchesBattery;
  });
  $("fleet-count").textContent = `A mostrar ${filteredVehicles.length} de ${vehicles.length} veículos`;
  $("fleet").innerHTML = filteredVehicles.map((v) => `<tr><td>${esc(v.vehicleId)}</td><td>${esc(v.name)}</td><td>${esc(STATUS[v.status] || v.status)}</td>
    <td>${esc(v.currentLocation)}</td><td>${esc(v.batteryLevel)}%</td>
    <td class="${isManager ? "" : "hidden"}"><button onclick="editVehicle('${esc(v.vehicleId)}')">Editar</button></td></tr>`).join("")
    || `<tr><td colspan="6">${vehicles.length ? "Nenhum veículo corresponde aos filtros." : "Sem veículos."}</td></tr>`;
  // Mesmo critério das Security Rules: ativo e com bateria >= MIN_BATTERY.
  $("r-vehicle").innerHTML = vehicles.filter((v) => v.status === "active" && Number(v.batteryLevel) >= MIN_BATTERY)
    .map((v) => `<option value="${esc(v.vehicleId)}">${esc(v.name)} (${esc(v.currentLocation)} · ${esc(v.batteryLevel)}%)</option>`).join("");
}

window.clearFleetFilters = () => {
  $("fleet-search").value = "";
  $("fleet-status-filter").value = "";
  $("fleet-location-filter").value = "";
  $("fleet-battery-filter").value = "";
  renderFleet();
};

window.clearReservationFilters = () => {
  $("reservation-status-filter").value = "";
  $("reservation-vehicle-filter").value = "";
  $("reservation-date-from").value = "";
  $("reservation-date-to").value = "";
  $("reservation-search").value = "";
  renderMyReservations();
};

window.watchGrid = () => {
  if (gridUnsub) gridUnsub();
  gridUnsub = onSnapshot(query(collection(db, "reservations"), where("date", "==", $("grid-date").value)), (qs) => {
    gridReservations = qs.docs.map((d) => d.data());
    renderGrid();
  }, showError);
};

function renderGrid() {
  const taken = new Map(gridReservations.map((r) => [`${r.vehicleId}_${r.timeSlot}`, r]));
  const head = `<tr><th>Veículo</th>${SLOTS.map((s) => `<th>${s}</th>`).join("")}</tr>`;
  const body = vehicles.map((v) => `<tr><th>${esc(v.name)}</th>${SLOTS.map((s) => {
    const r = taken.get(`${v.vehicleId}_${s}`);
    const cls = r ? (r.userId === me?.uid ? "mine" : "busy") : (v.status !== "active" ? "off" : "");
    const title = r && me?.role === "manager" ? `title="${esc(r.passengerName)}: ${esc(r.pickupPoint)} → ${esc(r.dropoffPoint)}"` : "";
    return `<td class="${cls}" ${title}>${r ? "●" : ""}</td>`;
  }).join("")}</tr>`).join("");
  $("grid").innerHTML = head + body;

  if (me?.role !== "manager") return;
  const trips = [...gridReservations].sort((a, b) => (a.timeSlot + a.vehicleId).localeCompare(b.timeSlot + b.vehicleId));
  $("day-trips").innerHTML = trips.map((r) => `<tr><td>${esc(r.timeSlot)}</td><td>${esc(r.vehicleId)}</td><td>${esc(r.passengerName)}</td>
    <td>${esc(r.pickupPoint)}</td><td>${esc(r.dropoffPoint)}</td>
    <td><select onchange="setTripStatus('${esc(r.reservationId)}', this.value)">${Object.entries(TRIP_STATUS)
      .map(([k, label]) => `<option value="${k}" ${k === r.status ? "selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("")
    || `<tr><td colspan="6">Sem viagens neste dia.</td></tr>`;
}

window.setTripStatus = async (id, status) => {
  showError(null);
  const trip = gridReservations.find((r) => r.reservationId === id);
  const batch = writeBatch(db);
  batch.update(doc(db, "reservations", id), { status });
  // Viagem concluída: o veículo fica no destino e gasta bateria. Batch = as duas escritas ou nenhuma.
  if (status === "completed" && trip.status !== "completed") {
    const v = vehicles.find((x) => x.vehicleId === trip.vehicleId);
    // Math.max e não increment(-5): as regras recusam bateria < 0.
    batch.update(doc(db, "vehicles", trip.vehicleId), { currentLocation: trip.dropoffPoint, batteryLevel: Math.max(0, v.batteryLevel - TRIP_BATTERY) });
  }
  try { await batch.commit(); } catch (err) { showError(err); }
};

window.book = async () => {
  showError(null);
  const vehicleId = $("r-vehicle").value;
  const date = $("r-date").value;
  const timeSlot = $("r-slot").value;
  if (!vehicleId || !date) return showError(new Error("Escolha um veículo ativo (bateria ≥ 20%) e uma data."));
  // Hora em UTC, como em slotNotPast() nas regras.
  if (new Date(`${date}T${timeSlot}:00Z`) <= new Date()) return showError(new Error("Esse bloco já começou. Escolha um horário futuro."));
  if ($("r-pickup").value === $("r-dropoff").value) return showError(new Error("Recolha e destino têm de ser diferentes."));
  const vehicleName = $("r-vehicle").selectedOptions[0].text.split(" (")[0];
  if (!confirm(`Confirmar reserva?\n\n${vehicleName}\n${formatDisplayDate(date)} às ${timeSlot}\n${$("r-pickup").value} → ${$("r-dropoff").value}`)) return;
  const reservationId = `${vehicleId}_${date.replaceAll("-", "")}_${timeSlot.replace(":", "")}`;
  try {
    await setDoc(doc(db, "reservations", reservationId), {
      reservationId, vehicleId, userId: me.uid, passengerName: me.name,
      pickupPoint: $("r-pickup").value, dropoffPoint: $("r-dropoff").value,
      date, timeSlot, status: "booked", createdAt: serverTimestamp()
    });
  } catch (err) {
    // ID determinístico: se o bloco já existe, as Security Rules recusam.
    showError(err.code === "permission-denied" ? new Error("Bloco já ocupado ou veículo indisponível.") : err);
  }
};

window.cancelReservation = async (id) => {
  if (!confirm("Cancelar esta reserva?")) return;
  try { await deleteDoc(doc(db, "reservations", id)); } catch (err) { showError(err); }
};

window.openTripFeedback = (reservationId) => {
  showError(null);
  const reservation = myReservations.find((item) => item.reservationId === reservationId);
  if (!reservation || reservation.status !== "completed") {
    showError(new Error("Só podes avaliar uma viagem concluída."));
    return;
  }
  if (myFeedback.some((item) => item.reservationId === reservationId)) {
    showError(new Error("Já enviaste feedback para esta viagem."));
    return;
  }
  activeFeedbackReservationId = reservationId;
  const vehicle = vehicles.find((item) => item.vehicleId === reservation.vehicleId);
  $("feedback-trip-details").textContent = `${vehicle?.name || reservation.vehicleId} · ${formatDisplayDate(reservation.date)} às ${reservation.timeSlot} · ${reservation.pickupPoint} → ${reservation.dropoffPoint}`;
  $("feedback-rating").value = "5";
  $("feedback-comment").value = "";
  $("feedback-status").textContent = "";
  $("feedback-dialog").showModal();
};

async function submitTripFeedback() {
  showError(null);
  const reservation = myReservations.find((item) => item.reservationId === activeFeedbackReservationId);
  const rating = Number($("feedback-rating").value);
  const comment = $("feedback-comment").value.trim();
  if (!reservation || reservation.status !== "completed") {
    showError(new Error("Só podes avaliar uma viagem concluída."));
    return;
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 500) {
    showError(new Error("Escolhe uma classificação entre 1 e 5 e limita o comentário a 500 caracteres."));
    return;
  }
  if (myFeedback.some((item) => item.reservationId === reservation.reservationId)) {
    showError(new Error("Já enviaste feedback para esta viagem."));
    $("feedback-dialog").close();
    return;
  }

  const submitButton = $("feedback-submit");
  submitButton.disabled = true;
  try {
    await setDoc(doc(db, "feedback", reservation.reservationId), {
      reservationId: reservation.reservationId,
      userId: me.uid,
      vehicleId: reservation.vehicleId,
      rating,
      comment,
      createdAt: serverTimestamp()
    });
    $("feedback-status").textContent = "Obrigado! O teu feedback foi enviado.";
    $("feedback-dialog").close();
  } catch (err) {
    showError(err.code === "permission-denied"
      ? new Error("Não foi possível enviar: a viagem não está concluída ou já tem feedback.")
      : err);
  } finally {
    submitButton.disabled = false;
  }
}

window.editVehicle = (id) => {
  const v = vehicles.find((x) => x.vehicleId === id);
  $("v-id").value = v.vehicleId;
  $("v-name").value = v.name;
  $("v-status").value = v.status;
  $("v-location").value = v.currentLocation;
  $("v-battery").value = v.batteryLevel;
  // O formulário fica longe da tabela: levar o gestor até ele.
  $("v-msg").innerText = `A editar ${v.vehicleId}`;
  $("v-name").scrollIntoView({ behavior: "smooth", block: "center" });
  $("v-name").focus({ preventScroll: true });
};

window.saveVehicle = async () => {
  showError(null);
  const vehicleId = $("v-id").value.trim();
  if (!/^[a-z0-9_]+$/.test(vehicleId)) return showError(new Error("ID inválido (use letras minúsculas, números e _)."));
  const existing = vehicles.find((x) => x.vehicleId === vehicleId);
  try {
    await setDoc(doc(db, "vehicles", vehicleId), {
      vehicleId, name: $("v-name").value.trim(), status: $("v-status").value,
      currentLocation: $("v-location").value, batteryLevel: parseInt($("v-battery").value, 10) || 0,
      createdAt: existing?.createdAt ?? serverTimestamp()
    });
    $("v-msg").innerText = `${vehicleId} guardado ✓`;
  } catch (err) { showError(err); }
};

// Erros do Firebase Auth em português; o resto passa tal como vem.
const AUTH_ERRORS = {
  "auth/email-already-in-use": "Já existe uma conta com este e-mail. Usa «Iniciar sessão».",
  "auth/invalid-email": "E-mail inválido.",
  "auth/missing-email": "Indica o teu e-mail.",
  "auth/weak-password": "A palavra-passe tem de ter pelo menos 6 caracteres.",
  "auth/missing-password": "Indica a palavra-passe.",
  "auth/invalid-credential": "E-mail ou palavra-passe errados.",
  "auth/too-many-requests": "Demasiadas tentativas. Espera um pouco e tenta outra vez."
};
const authMessage = (err) => AUTH_ERRORS[err.code] || err.message;

window.login = () => {
  signInWithEmailAndPassword(auth, $("email").value, $("password").value)
    .catch((err) => { $("auth-error").innerText = authMessage(err); });
};

window.showPasswordReset = (e) => {
  e.preventDefault();
  $("reset-email").value = $("email").value.trim();
  $("reset-error").innerText = "";
  $("reset-message").innerText = "";
  $("auth-container").classList.add("hidden");
  $("reset-container").classList.remove("hidden");
  $("reset-email").focus();
};

window.returnToLogin = () => {
  $("reset-container").classList.add("hidden");
  $("auth-container").classList.remove("hidden");
  $("reset-error").innerText = "";
  $("reset-message").innerText = "";
};

window.resetPassword = async (e) => {
  e.preventDefault();
  const email = $("reset-email").value.trim();
  $("reset-error").innerText = "";
  $("reset-message").innerText = "";
  $("auth-error").innerText = "";
  if (!email) {
    $("reset-error").innerText = "Indica o teu e-mail para receberes as instruções.";
    $("reset-email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    $("reset-message").innerText = "Se existir uma conta associada a este e-mail, receberás instruções para redefinir a palavra-passe.";
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      $("reset-message").innerText = "Se existir uma conta associada a este e-mail, receberás instruções para redefinir a palavra-passe.";
      return;
    }
    $("reset-error").innerText = authMessage(err);
  }
};

// Alterna o formulário entre "Iniciar Sessão" e "Criar conta" (só este pede o nome).
window.toggleSignup = (e) => {
  e.preventDefault();
  const signingUp = $("name").classList.contains("hidden");
  document.querySelectorAll(".signup-only").forEach((el) => el.classList.toggle("hidden", !signingUp));
  document.querySelectorAll(".login-only").forEach((el) => el.classList.toggle("hidden", signingUp));
  $("auth-title").innerText = signingUp ? "Criar Conta" : "Iniciar Sessão";
  $("auth-toggle").innerText = signingUp ? "Já tens conta? Iniciar sessão" : "Ainda não tens conta? Criar conta";
  $("auth-error").innerText = "";
};

window.signup = async () => {
  if (!$("name").value.trim()) { $("auth-error").innerText = "Indica o teu nome."; return; }
  try {
    const { user } = await createUserWithEmailAndPassword(auth, $("email").value, $("password").value);
    // O perfil é criado já, enquanto o nome escrito no formulário ainda existe.
    await setDoc(doc(db, "users", user.uid), { uid: user.uid, name: $("name").value.trim(), email: user.email, role: "passenger", createdAt: serverTimestamp() });
    await sendEmailVerification(user);
  } catch (err) { $("auth-error").innerText = authMessage(err); }
};

window.resendVerification = () => sendEmailVerification(auth.currentUser)
  .then(() => { $("verify-msg").innerText = "E-mail reenviado."; })
  .catch((err) => { $("verify-msg").innerText = authMessage(err); });

window.checkVerified = async () => {
  await auth.currentUser.reload();
  if (!auth.currentUser.emailVerified) { $("verify-msg").innerText = "Ainda não confirmado. Clica no link do e-mail."; return; }
  await auth.currentUser.getIdToken(true); // token novo já com email_verified, que as regras exigem
  location.reload();
};

window.logout = () => signOut(auth);
