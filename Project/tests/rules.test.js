import { test, before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, collection, query, where } from "firebase/firestore";

let env;
// Contas com o e-mail já confirmado, como exigem as regras.
const verified = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const ana = () => verified("ana");
const rui = () => verified("rui");
const gestor = () => verified("gestor");
const anon = () => env.unauthenticatedContext().firestore();

const vehicle = (id, status = "active") =>
  ({ vehicleId: id, name: "RoboTaxi " + id, status, currentLocation: "Entrada Norte", batteryLevel: 85 });
const NAMES = { ana: "Ana", rui: "Rui", gestor: "Gestor" };
// Amanhã, para os testes não envelhecerem.
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const reservation = (uid, vehicleId = "taxi_01", date = TOMORROW, timeSlot = "14:30") => ({
  reservationId: `${vehicleId}_${date.replaceAll("-", "")}_${timeSlot.replace(":", "")}`,
  vehicleId, userId: uid, passengerName: NAMES[uid], pickupPoint: "Entrada Norte", dropoffPoint: "Entrada Sul",
  date, timeSlot, status: "booked", createdAt: serverTimestamp()
});
const slotRef = (db, r) => doc(db, "slots", r.reservationId);
const slotOf = (r) => ({ vehicleId: r.vehicleId, date: r.date, timeSlot: r.timeSlot });
// Reserva + bloco público no mesmo batch, como faz a app.
const userSlotRef = (db, r) => doc(db, "userSlots", `${r.userId}_${r.date.replaceAll("-", "")}_${r.timeSlot.replace(":", "")}`);
const userSlotOf = (r) => ({ userId: r.userId, reservationId: r.reservationId });
// Reserva + bloco público + marca do passageiro no mesmo batch, como faz a app.
const book = (db, r) => writeBatch(db).set(resRef(db, r), r).set(slotRef(db, r), slotOf(r)).set(userSlotRef(db, r), userSlotOf(r)).commit();
const cancel = (db, r) => writeBatch(db).delete(resRef(db, r)).delete(slotRef(db, r)).delete(userSlotRef(db, r)).commit();
const resRef = (db, r) => doc(db, "reservations", r.reservationId);
const feedback = (r, overrides = {}) => ({
  reservationId: r.reservationId, userId: r.userId, vehicleId: r.vehicleId,
  rating: 5, comment: "Viagem excelente", createdAt: serverTimestamp(), ...overrides
});
const feedbackRef = (db, r) => doc(db, "feedback", r.reservationId);
const seedCompletedReservation = (r) => env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), "reservations", r.reservationId), { ...r, status: "completed" }));

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

// users ("novo" acabou de se registar: e-mail ainda por confirmar)
const novo = () => env.authenticatedContext("novo", { email: "n@x.pt" }).firestore();
const perfil = (over = {}) => ({ uid: "novo", name: "Novo", email: "n@x.pt", role: "passenger", createdAt: serverTimestamp(), ...over });
test("e-mail por confirmar não lê a frota", () => assertFails(getDoc(doc(novo(), "vehicles/taxi_01"))));
test("e-mail por confirmar não reserva", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/novo"), { uid: "novo", name: "Novo", email: "n@x.pt", role: "passenger" }));
  const r = { ...reservation("ana"), userId: "novo", passengerName: "Novo" };
  await assertFails(book(novo(), r));
});
test("utilizador cria o próprio perfil como passenger", () =>
  assertSucceeds(setDoc(doc(novo(), "users/novo"), perfil())));
test("utilizador não se autopromove a manager ao criar", () =>
  assertFails(setDoc(doc(novo(), "users/novo"), perfil({ role: "manager" }))));
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
test("passageiro reserva veículo ativo", () => assertSucceeds(book(ana(), reservation("ana"))));
test("não reserva veículo em manutenção", () => {
  const r = reservation("ana", "taxi_02");
  return assertFails(book(ana(), r));
});
test("não reserva em nome de outro utilizador", () =>
  assertFails(book(ana(), reservation("rui"))));
test("ID tem de ser veiculo_data_bloco", () =>
  assertFails(setDoc(doc(ana(), "reservations/qualquer_id"), reservation("ana"))));
test("bloco fora dos 30 min é rejeitado", () => {
  const r = reservation("ana", "taxi_01", "2026-10-28", "14:15");
  return assertFails(book(ana(), r));
});
test("não há sobreposição: segundo passageiro no mesmo bloco falha", async () => {
  await assertSucceeds(book(ana(), reservation("ana")));
  await assertFails(book(rui(), reservation("rui")));
});
test("só o dono cancela a sua reserva", async () => {
  await book(ana(), reservation("ana"));
  await assertFails(cancel(rui(), reservation("ana")));
  await assertSucceeds(cancel(ana(), reservation("ana")));
});
test("gestor pode cancelar qualquer reserva", async () => {
  await book(ana(), reservation("ana"));
  await assertSucceeds(cancel(gestor(), reservation("ana")));
});
test("passageiro não edita reservas", async () => {
  await book(ana(), reservation("ana"));
  await assertFails(updateDoc(resRef(ana(), reservation("ana")), { timeSlot: "15:00" }));
  await assertFails(updateDoc(resRef(ana(), reservation("ana")), { status: "completed" }));
});
test("reserva com data passada é rejeitada", () => {
  const r = reservation("ana", "taxi_01", "2020-01-01");
  return assertFails(book(ana(), r));
});
// TODAY em UTC, como as regras. 00:00 já passou e 23:30 ainda não (salvo a correr nessa meia hora).
const TODAY = new Date().toISOString().slice(0, 10);
test("reserva para hoje é aceite", () => {
  const r = reservation("ana", "taxi_01", TODAY, "23:30");
  return assertSucceeds(book(ana(), r));
});
test("bloco de hoje que já começou é rejeitado", () => {
  const r = reservation("ana", "taxi_01", TODAY, "00:00");
  return assertFails(book(ana(), r));
});
test("veículo com bateria abaixo de 20% não é reservado", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), { ...vehicle("taxi_03"), batteryLevel: 15 }));
  const r = reservation("ana", "taxi_03");
  await assertFails(book(ana(), r));
});
test("veículo com bateria de 20% é reservado", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), { ...vehicle("taxi_03"), batteryLevel: 20 }));
  const r = reservation("ana", "taxi_03");
  await assertSucceeds(book(ana(), r));
});
test("passengerName tem de ser o nome do perfil", () => {
  const r = { ...reservation("ana"), passengerName: "Outra Pessoa" };
  return assertFails(book(ana(), r));
});
test("gestor avança o estado da viagem", async () => {
  await book(ana(), reservation("ana"));
  await assertSucceeds(updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" }));
  await assertSucceeds(updateDoc(resRef(gestor(), reservation("ana")), { status: "completed" }));
});
test("gestor não usa estados inválidos nem muda outros campos", async () => {
  await book(ana(), reservation("ana"));
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { status: "voando" }));
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { timeSlot: "15:00" }));
});
test("estado da viagem só anda para a frente", async () => {
  await book(ana(), reservation("ana"));
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { status: "completed" }));
  await updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" });
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { status: "booked" }));
  await updateDoc(resRef(gestor(), reservation("ana")), { status: "completed" });
  await assertFails(updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" }));
});
test("passageiro não cancela viagem já iniciada", async () => {
  await book(ana(), reservation("ana"));
  await updateDoc(resRef(gestor(), reservation("ana")), { status: "in_progress" });
  await assertFails(cancel(ana(), reservation("ana")));
});

test("passageiro avalia uma vez a sua viagem concluída", async () => {
  const r = reservation("ana");
  await seedCompletedReservation(r);
  const ref = feedbackRef(ana(), r);
  await assertSucceeds(setDoc(ref, feedback(r)));
  await assertFails(setDoc(ref, feedback(r, { rating: 4 })));
  await assertFails(deleteDoc(ref));
});

test("feedback só pode ser criado pelo dono de uma viagem concluída", async () => {
  const r = reservation("ana");
  await book(ana(), r);
  await assertFails(setDoc(feedbackRef(ana(), r), feedback(r)));
  await seedCompletedReservation(r);
  await assertFails(setDoc(feedbackRef(rui(), r), feedback(r, { userId: "rui" })));
});

test("feedback só é visível ao passageiro autor e ao gestor", async () => {
  const r = reservation("ana");
  await seedCompletedReservation(r);
  await setDoc(feedbackRef(ana(), r), feedback(r));
  await assertSucceeds(getDoc(feedbackRef(ana(), r)));
  await assertFails(getDoc(feedbackRef(rui(), r)));
  await assertSucceeds(getDoc(feedbackRef(gestor(), r)));
});

test("feedback rejeita classificação e comentário fora dos limites", async () => {
  const r = reservation("ana");
  await seedCompletedReservation(r);
  const ref = feedbackRef(ana(), r);
  await assertFails(setDoc(ref, feedback(r, { rating: 0 })));
  await assertFails(setDoc(ref, feedback(r, { rating: 6 })));
  await assertFails(setDoc(ref, feedback(r, { comment: "x".repeat(501) })));
});

// Endurecimento após a auditoria de segurança (18 nov 2026)
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
test("perfil: nome tem de ser texto até 80 caracteres e o e-mail o da conta", async () => {
  await assertFails(setDoc(doc(novo(), "users/novo"), perfil({ name: "x".repeat(81) })));
  await assertFails(setDoc(doc(novo(), "users/novo"), perfil({ name: 123 })));
  await assertFails(setDoc(doc(novo(), "users/novo"), perfil({ email: "reitor@x.pt" })));
  await assertFails(setDoc(doc(novo(), "users/novo"), perfil({ createdAt: new Date("2000-01-01") })));
  await assertFails(updateDoc(doc(ana(), "users/ana"), { name: "x".repeat(81) }));
  await assertFails(updateDoc(doc(ana(), "users/ana"), { name: 123 }));
  await assertSucceeds(updateDoc(doc(ana(), "users/ana"), { name: "Ana Silva" }));
});
test("passageiro não lê reservas de outros (dados pessoais)", async () => {
  await book(rui(), reservation("rui"));
  await assertFails(getDoc(resRef(ana(), reservation("rui"))));
  await assertFails(getDocs(collection(ana(), "reservations")));
  await assertFails(getDocs(query(collection(ana(), "reservations"), where("date", "==", TOMORROW))));
  await assertSucceeds(getDocs(query(collection(ana(), "reservations"), where("userId", "==", "ana"))));
  await assertSucceeds(getDoc(resRef(rui(), reservation("rui"))));
  await assertSucceeds(getDocs(collection(gestor(), "reservations")));
});
test("ocupação pública mostra o bloco sem dados pessoais", async () => {
  await book(rui(), reservation("rui"));
  const snap = await assertSucceeds(getDoc(slotRef(ana(), reservation("rui"))));
  if (Object.keys(snap.data()).sort().join() !== "date,timeSlot,vehicleId") throw new Error("o bloco público expõe campos a mais");
  await assertFails(getDoc(slotRef(anon(), reservation("rui"))));
});
test("reserva e bloco público só existem juntos", async () => {
  const r = reservation("ana");
  await assertFails(setDoc(resRef(ana(), r), r));                 // reserva sem bloco
  await assertFails(setDoc(slotRef(ana(), r), slotOf(r)));        // bloco sem reserva (bloquearia a grelha)
  await book(ana(), r);
  await assertFails(deleteDoc(resRef(ana(), r)));                 // cancelar sem libertar o bloco
  await assertFails(deleteDoc(slotRef(ana(), r)));                // libertar o bloco sem cancelar
  await assertFails(deleteDoc(slotRef(rui(), r)));
  await assertFails(updateDoc(slotRef(ana(), r), { timeSlot: "15:00" }));
  await assertSucceeds(cancel(ana(), r));
});
test("bloco público tem de coincidir com a reserva", async () => {
  const r = reservation("ana");
  const db = ana();
  await assertFails(writeBatch(db).set(resRef(db, r), r).set(slotRef(db, r), { ...slotOf(r), timeSlot: "09:00" }).set(userSlotRef(db, r), userSlotOf(r)).commit());
});
test("gestor cria o bloco público de uma reserva antiga e limpa blocos órfãos", async () => {
  const r = reservation("ana");
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "reservations", r.reservationId), r));
  await assertFails(setDoc(slotRef(rui(), r), slotOf(r)));
  await assertSucceeds(setDoc(slotRef(gestor(), r), slotOf(r)));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "slots/orfao"), { vehicleId: "taxi_01", date: TOMORROW, timeSlot: "08:00" }));
  await assertFails(deleteDoc(doc(ana(), "slots/orfao")));
  await assertSucceeds(deleteDoc(doc(gestor(), "slots/orfao")));
});
test("reserva só até 30 dias à frente", async () => {
  await assertSucceeds(book(ana(), reservation("ana", "taxi_01", inDays(29))));
  await assertFails(book(ana(), reservation("ana", "taxi_01", inDays(32))));
  await assertFails(book(ana(), reservation("ana", "taxi_01", "2099-01-01")));
});
test("recolha e destino têm de ser pontos do campus", async () => {
  await assertFails(book(ana(), { ...reservation("ana"), pickupPoint: "<img src=x onerror=alert(1)>" }));
  await assertFails(book(ana(), { ...reservation("ana"), dropoffPoint: "y".repeat(5000) }));
});
test("data de criação da reserva é a do servidor", () =>
  assertFails(book(ana(), { ...reservation("ana"), createdAt: new Date("2000-01-01") })));
test("gestor não apaga viagens concluídas", async () => {
  const r = reservation("ana");
  await book(ana(), r);
  await updateDoc(resRef(gestor(), r), { status: "in_progress" });
  await updateDoc(resRef(gestor(), r), { status: "completed" });
  await assertFails(cancel(gestor(), r));
});
test("veículo: nome e localização com tamanho limitado", async () => {
  await assertFails(updateDoc(doc(gestor(), "vehicles/taxi_01"), { name: "x".repeat(61) }));
  await assertFails(updateDoc(doc(gestor(), "vehicles/taxi_01"), { currentLocation: { a: 1 } }));
  await assertFails(updateDoc(doc(gestor(), "vehicles/taxi_01"), { currentLocation: "y".repeat(61) }));
});

// userSlots: o mesmo passageiro não tem duas viagens à mesma hora
test("passageiro não reserva dois veículos para a mesma hora", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), vehicle("taxi_03")));
  await assertSucceeds(book(ana(), reservation("ana")));
  await assertFails(book(ana(), reservation("ana", "taxi_03")));
});
test("passageiro reserva dois veículos em horas diferentes", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), vehicle("taxi_03")));
  await assertSucceeds(book(ana(), reservation("ana")));
  await assertSucceeds(book(ana(), reservation("ana", "taxi_03", TOMORROW, "15:00")));
});
test("dois passageiros reservam veículos diferentes para a mesma hora", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), vehicle("taxi_03")));
  await assertSucceeds(book(ana(), reservation("ana")));
  await assertSucceeds(book(rui(), reservation("rui", "taxi_03")));
});
test("reserva sem a marca do passageiro é recusada", () => {
  const db = ana(), r = reservation("ana");
  return assertFails(writeBatch(db).set(resRef(db, r), r).set(slotRef(db, r), slotOf(r)).commit());
});
test("marca do passageiro sem reserva é recusada", () => {
  const db = ana(), r = reservation("ana");
  return assertFails(setDoc(userSlotRef(db, r), userSlotOf(r)));
});
test("não se cria a marca em nome de outro passageiro", async () => {
  const db = ana(), r = reservation("ana"), deRui = reservation("rui");
  await assertFails(writeBatch(db).set(resRef(db, r), r).set(slotRef(db, r), slotOf(r)).set(userSlotRef(db, deRui), userSlotOf(r)).commit());
});
test("depois de cancelar, o passageiro volta a poder reservar essa hora", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "vehicles/taxi_03"), vehicle("taxi_03")));
  await book(ana(), reservation("ana"));
  await assertSucceeds(cancel(ana(), reservation("ana")));
  await assertSucceeds(book(ana(), reservation("ana", "taxi_03")));
});
test("cancelar sem apagar a marca do passageiro é recusado", async () => {
  const db = ana(), r = reservation("ana");
  await book(db, r);
  await assertFails(writeBatch(db).delete(resRef(db, r)).delete(slotRef(db, r)).commit());
});
test("gestor cancela reserva e liberta a hora do passageiro", async () => {
  await book(ana(), reservation("ana"));
  await assertSucceeds(cancel(gestor(), reservation("ana")));
});
test("reserva antiga sem marca continua a poder ser cancelada", async () => {
  const r = reservation("ana");
  await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); await setDoc(doc(db, "reservations", r.reservationId), r); await setDoc(doc(db, "slots", r.reservationId), slotOf(r)); });
  await assertSucceeds(cancel(ana(), r));
});
test("outro passageiro não lê as marcas alheias", async () => {
  await book(ana(), reservation("ana"));
  await assertFails(getDoc(userSlotRef(rui(), reservation("ana"))));
});
