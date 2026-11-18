// Dados de teste para os emuladores locais (npm run serve noutro terminal, depois npm run seed).
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const PROJECT = "demo-robotaxi";
const ACCOUNTS = [
  { email: "gestor@robotaxi.test", password: "gestor123", name: "Gestor de Frota", role: "manager" },
  { email: "passageiro@robotaxi.test", password: "passageiro123", name: "Passageiro Teste", role: "passenger" }
];
const VEHICLES = [
  { vehicleId: "taxi_01", name: "RoboTaxi Alpha", status: "active", currentLocation: "Entrada Norte", batteryLevel: 85 },
  { vehicleId: "taxi_02", name: "RoboTaxi Beta", status: "active", currentLocation: "Biblioteca", batteryLevel: 62 },
  { vehicleId: "taxi_03", name: "RoboTaxi Gamma", status: "maintenance", currentLocation: "Parque de Estacionamento", batteryLevel: 15 },
  { vehicleId: "taxi_04", name: "RoboTaxi Delta", status: "active", currentLocation: "Cantina", batteryLevel: 100 },
  { vehicleId: "taxi_05", name: "RoboTaxi Épsilon", status: "active", currentLocation: "Residências", batteryLevel: 44 },
  { vehicleId: "taxi_06", name: "RoboTaxi Zeta", status: "inactive", currentLocation: "Parque de Estacionamento", batteryLevel: 3 }
];
// Viagens de exemplo do passageiro de teste: ontem (concluídas, uma avaliada), hoje e amanhã.
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const TRIPS = [
  { vehicleId: "taxi_01", date: day(-1), timeSlot: "09:30", pickupPoint: "Entrada Norte", dropoffPoint: "Biblioteca", status: "completed", rating: 5, comment: "Chegou a horas e a viagem foi tranquila." },
  { vehicleId: "taxi_02", date: day(-1), timeSlot: "13:00", pickupPoint: "Biblioteca", dropoffPoint: "Cantina", status: "completed" },
  { vehicleId: "taxi_04", date: day(0), timeSlot: "08:30", pickupPoint: "Cantina", dropoffPoint: "Entrada Sul", status: "in_progress" },
  { vehicleId: "taxi_01", date: day(0), timeSlot: "19:30", pickupPoint: "Entrada Norte", dropoffPoint: "Residências", status: "booked" },
  { vehicleId: "taxi_05", date: day(1), timeSlot: "10:00", pickupPoint: "Residências", dropoffPoint: "Biblioteca", status: "booked" }
];

const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8080 } });
let passenger;
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const a of ACCOUNTS) {
    const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: a.password })
    });
    const { localId, error } = await res.json();
    if (error) throw new Error(`${a.email}: ${error.message}`);
    // Contas de teste já com o e-mail confirmado (as regras exigem-no).
    await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ localId, emailVerified: true })
    });
    await setDoc(doc(db, "users", localId), { uid: localId, name: a.name, email: a.email, role: a.role, createdAt: new Date() });
    if (a.role === "passenger") passenger = { uid: localId, name: a.name };
  }
  for (const v of VEHICLES) await setDoc(doc(db, "vehicles", v.vehicleId), { ...v, createdAt: new Date() });
  for (const { rating, comment, ...t } of TRIPS) {
    const reservationId = `${t.vehicleId}_${t.date.replaceAll("-", "")}_${t.timeSlot.replace(":", "")}`;
    await setDoc(doc(db, "reservations", reservationId), { ...t, reservationId, userId: passenger.uid, passengerName: passenger.name, createdAt: new Date() });
    if (rating) await setDoc(doc(db, "feedback", reservationId), { reservationId, userId: passenger.uid, vehicleId: t.vehicleId, rating, comment, createdAt: new Date() });
  }
});
await env.cleanup();
console.log("Seed OK:", ACCOUNTS.map((a) => a.email).join(", "));
