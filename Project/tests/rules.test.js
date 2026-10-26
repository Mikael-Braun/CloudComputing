import { test, before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

let env;
const ana = () => env.authenticatedContext("ana").firestore();
const rui = () => env.authenticatedContext("rui").firestore();
const gestor = () => env.authenticatedContext("gestor").firestore();
const anon = () => env.unauthenticatedContext().firestore();

const vehicle = (id, status = "active") =>
  ({ vehicleId: id, name: "RoboTaxi " + id, status, currentLocation: "Entrada Norte", batteryLevel: 85 });
const NAMES = { ana: "Ana", rui: "Rui", gestor: "Gestor" };
// Amanhã, para os testes não envelhecerem.
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const reservation = (uid, vehicleId = "taxi_01", date = TOMORROW, timeSlot = "14:30") => ({
  reservationId: `${vehicleId}_${date.replaceAll("-", "")}_${timeSlot.replace(":", "")}`,
  vehicleId, userId: uid, passengerName: NAMES[uid], pickupPoint: "Entrada Norte", dropoffPoint: "Entrada Sul",
  date, timeSlot, status: "booked"
});
const resRef = (db, r) => doc(db, "reservations", r.reservationId);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-robotaxi-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/gestor"), { uid: "gestor", name: "Gestor", email: "g@x.pt", role: "manager" });
    await setDoc(doc(db, "users/ana"), { uid: "ana", name: "Ana", email: "a@x.pt", role: "passenger" });
    await setDoc(doc(db, "users/rui"), { uid: "rui", name: "Rui", email: "r@x.pt", role: "passenger" });
    await setDoc(doc(db, "vehicles/taxi_01"), vehicle("taxi_01"));
    await setDoc(doc(db, "vehicles/taxi_02"), vehicle("taxi_02", "maintenance"));
  });
});

after(() => env.cleanup());

// users
const novo = () => env.authenticatedContext("novo").firestore();
test("utilizador cria o próprio perfil como passenger", () =>
  assertSucceeds(setDoc(doc(novo(), "users/novo"), { uid: "novo", name: "Novo", email: "n@x.pt", role: "passenger" })));
test("utilizador não se autopromove a manager ao criar", () =>
  assertFails(setDoc(doc(novo(), "users/novo"), { uid: "novo", name: "Novo", email: "n@x.pt", role: "manager" })));
test("utilizador não altera o próprio role", () =>
  assertFails(updateDoc(doc(ana(), "users/ana"), { role: "manager" })));
test("passageiro não lê perfis de outros", () => assertFails(getDoc(doc(ana(), "users/gestor"))));
test("gestor lê perfis de outros", () => assertSucceeds(getDoc(doc(gestor(), "users/ana"))));

// vehicles
test("anónimo não lê a frota", () => assertFails(getDoc(doc(anon(), "vehicles/taxi_01"))));
test("passageiro lê a frota", () => assertSucceeds(getDoc(doc(ana(), "vehicles/taxi_01"))));
test("passageiro não cria veículos", () => assertFails(setDoc(doc(ana(), "vehicles/taxi_09"), vehicle("taxi_09"))));
test("gestor cria veículo", () => assertSucceeds(setDoc(doc(gestor(), "vehicles/taxi_09"), vehicle("taxi_09"))));
test("gestor muda estado para inactive", () =>
  assertSucceeds(updateDoc(doc(gestor(), "vehicles/taxi_01"), { status: "inactive" })));
test("estado inválido é rejeitado", () =>
  assertFails(updateDoc(doc(gestor(), "vehicles/taxi_01"), { status: "voando" })));
test("bateria fora de 0-100 é rejeitada", () =>
  assertFails(updateDoc(doc(gestor(), "vehicles/taxi_01"), { batteryLevel: 150 })));
test("nem o gestor apaga veículos (remoção lógica)", () => assertFails(deleteDoc(doc(gestor(), "vehicles/taxi_01"))));
test("ID de veículo com caracteres inválidos é rejeitado", () =>
  assertFails(setDoc(doc(gestor(), "vehicles/x');alert(1)"), vehicle("x');alert(1)"))));

// reservations
test("passageiro reserva veículo ativo", () => assertSucceeds(setDoc(resRef(ana(), reservation("ana")), reservation("ana"))));
test("não reserva veículo em manutenção", () => {
  const r = reservation("ana", "taxi_02");
  return assertFails(setDoc(resRef(ana(), r), r));
});
test("não reserva em nome de outro utilizador", () =>
  assertFails(setDoc(resRef(ana(), reservation("rui")), reservation("rui"))));
test("ID tem de ser veiculo_data_bloco", () =>
  assertFails(setDoc(doc(ana(), "reservations/qualquer_id"), reservation("ana"))));
test("bloco fora dos 30 min é rejeitado", () => {
  const r = reservation("ana", "taxi_01", "2026-10-28", "14:15");
  return assertFails(setDoc(resRef(ana(), r), r));
});
test("não há sobreposição: segundo passageiro no mesmo bloco falha", async () => {
  await assertSucceeds(setDoc(resRef(ana(), reservation("ana")), reservation("ana")));
  await assertFails(setDoc(resRef(rui(), reservation("rui")), reservation("rui")));
});
test("só o dono cancela a sua reserva", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await assertFails(deleteDoc(resRef(rui(), reservation("ana"))));
  await assertSucceeds(deleteDoc(resRef(ana(), reservation("ana"))));
});
test("gestor pode cancelar qualquer reserva", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await assertSucceeds(deleteDoc(resRef(gestor(), reservation("ana"))));
});
test("passageiro não edita reservas", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await assertFails(updateDoc(resRef(ana(), reservation("ana")), { timeSlot: "15:00" }));
  await assertFails(updateDoc(resRef(ana(), reservation("ana")), { status: "completed" }));
});
test("reserva com data passada é rejeitada", () => {
  const r = reservation("ana", "taxi_01", "2020-01-01");
  return assertFails(setDoc(resRef(ana(), r), r));
});
test("reserva para hoje é aceite", () => {
  const r = reservation("ana", "taxi_01", new Date().toISOString().slice(0, 10), "23:30");
  return assertSucceeds(setDoc(resRef(ana(), r), r));
});
test("passengerName tem de ser o nome do perfil", () => {
  const r = { ...reservation("ana"), passengerName: "Outra Pessoa" };
  return assertFails(setDoc(resRef(ana(), r), r));
});
test("gestor avança o estado da viagem", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await assertSucceeds(updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" }));
  await assertSucceeds(updateDoc(resRef(gestor(), reservation("ana")), { status: "completed" }));
});
test("gestor não usa estados inválidos nem muda outros campos", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { status: "voando" }));
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { timeSlot: "15:00" }));
});
test("passageiro não cancela viagem já iniciada", async () => {
  await setDoc(resRef(ana(), reservation("ana")), reservation("ana"));
  await updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" });
  await assertFails(deleteDoc(resRef(ana(), reservation("ana"))));
});
