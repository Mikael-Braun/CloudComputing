import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp, connectFirestoreEmulator }
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
const STATUS = { active: "Ativo", maintenance: "Em Manutenção", inactive: "Inativo" };
const TRIP_STATUS = { booked: "Reservada", in_progress: "Em curso", completed: "Concluída" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const showError = (err) => { $("app-error").innerText = err ? err.message : ""; };

let me = null;          // { uid, name, role }
let vehicles = [];
let unsubs = [];
let gridUnsub = null;
let gridReservations = [];

for (const sel of document.querySelectorAll(".points")) sel.innerHTML = POINTS.map((p) => `<option>${esc(p)}</option>`).join("");
for (const sel of document.querySelectorAll(".slots")) sel.innerHTML = SLOTS.map((s) => `<option>${s}</option>`).join("");
const today = new Date().toISOString().slice(0, 10);
$("r-date").value = today;
$("r-date").min = today;
$("grid-date").value = today;

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  if (gridUnsub) { gridUnsub(); gridUnsub = null; }
  $("auth-container").classList.toggle("hidden", !!user);
  $("user-container").classList.toggle("hidden", !user);
  if (!user) { me = null; return; }

  const ref = doc(db, "users", user.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    // Contas criadas antes do Firestore (ou sem perfil) recebem o perfil de passageiro.
    await setDoc(ref, { uid: user.uid, name: $("name").value || user.email, email: user.email, role: "passenger", createdAt: serverTimestamp() });
    snap = await getDoc(ref);
  }
  me = snap.data();
  $("user-email").innerText = user.email;
  $("user-role").innerText = me.role === "manager" ? "Gestor de Frota" : "Passageiro";
  const isManager = me.role === "manager";
  document.querySelectorAll(".manager-only").forEach((el) => el.classList.toggle("hidden", !isManager));
  document.querySelectorAll(".passenger-only").forEach((el) => el.classList.toggle("hidden", isManager));

  // Atualizações em tempo real (simulação feita pelo gestor chega logo aos passageiros).
  unsubs.push(onSnapshot(collection(db, "vehicles"), (qs) => {
    vehicles = qs.docs.map((d) => d.data()).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    renderFleet();
    renderGrid();
  }, showError));

  if (!isManager) {
    unsubs.push(onSnapshot(query(collection(db, "reservations"), where("userId", "==", user.uid)), (qs) => {
      const rows = qs.docs.map((d) => d.data()).sort((a, b) => (a.date + a.timeSlot).localeCompare(b.date + b.timeSlot));
      $("my-reservations").innerHTML = rows.map((r) => `<tr><td>${esc(r.vehicleId)}</td><td>${esc(r.date)}</td><td>${esc(r.timeSlot)}</td>
        <td>${esc(r.pickupPoint)}</td><td>${esc(r.dropoffPoint)}</td><td>${esc(TRIP_STATUS[r.status] || r.status)}</td>
        <td>${r.status === "booked" ? `<button class="danger" onclick="cancelReservation('${esc(r.reservationId)}')">Cancelar</button>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="7">Sem reservas.</td></tr>`;
    }, showError));
  }
  watchGrid();
});

function renderFleet() {
  const isManager = me?.role === "manager";
  $("fleet").innerHTML = vehicles.map((v) => `<tr><td>${esc(v.vehicleId)}</td><td>${esc(v.name)}</td><td>${esc(STATUS[v.status] || v.status)}</td>
    <td>${esc(v.currentLocation)}</td><td>${esc(v.batteryLevel)}%</td>
    <td class="${isManager ? "" : "hidden"}"><button onclick="editVehicle('${esc(v.vehicleId)}')">Editar</button></td></tr>`).join("")
    || `<tr><td colspan="6">Sem veículos.</td></tr>`;
  $("r-vehicle").innerHTML = vehicles.filter((v) => v.status === "active")
    .map((v) => `<option value="${esc(v.vehicleId)}">${esc(v.name)} (${esc(v.currentLocation)})</option>`).join("");
}

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
  try { await updateDoc(doc(db, "reservations", id), { status }); } catch (err) { showError(err); }
};

window.book = async () => {
  showError(null);
  const vehicleId = $("r-vehicle").value;
  const date = $("r-date").value;
  const timeSlot = $("r-slot").value;
  if (!vehicleId || !date) return showError(new Error("Escolha um veículo ativo e uma data."));
  if (date < new Date().toISOString().slice(0, 10)) return showError(new Error("Não é possível reservar datas passadas."));
  if ($("r-pickup").value === $("r-dropoff").value) return showError(new Error("Recolha e destino têm de ser diferentes."));
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

window.editVehicle = (id) => {
  const v = vehicles.find((x) => x.vehicleId === id);
  $("v-id").value = v.vehicleId;
  $("v-name").value = v.name;
  $("v-status").value = v.status;
  $("v-location").value = v.currentLocation;
  $("v-battery").value = v.batteryLevel;
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
  } catch (err) { showError(err); }
};

window.login = () => {
  signInWithEmailAndPassword(auth, $("email").value, $("password").value)
    .catch((err) => { $("auth-error").innerText = err.message; });
};

window.signup = () => {
  createUserWithEmailAndPassword(auth, $("email").value, $("password").value)
    .catch((err) => { $("auth-error").innerText = err.message; });
};

window.logout = () => signOut(auth);
