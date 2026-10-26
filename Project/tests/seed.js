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
  { vehicleId: "taxi_03", name: "RoboTaxi Gamma", status: "maintenance", currentLocation: "Parque de Estacionamento", batteryLevel: 15 }
];

const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const a of ACCOUNTS) {
    const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: a.password })
    });
    const { localId, error } = await res.json();
    if (error) throw new Error(`${a.email}: ${error.message}`);
    await setDoc(doc(db, "users", localId), { uid: localId, name: a.name, email: a.email, role: a.role, createdAt: new Date() });
  }
  for (const v of VEHICLES) await setDoc(doc(db, "vehicles", v.vehicleId), { ...v, createdAt: new Date() });
});
await env.cleanup();
console.log("Seed OK:", ACCOUNTS.map((a) => a.email).join(", "));
