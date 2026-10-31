import test from "node:test";
import assert from "node:assert/strict";
import { createLoginLimiter } from "../src/login_limiter.js";
import { safeMessage, isSystemError, GENERIC_ERROR } from "../src/safe_error.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("bloquea un usuario tras 8 fallos desde la misma IP", () => {
  const c = clock();
  const l = createLoginLimiter({ now: c.now });
  for (let i = 0; i < 8; i++) {
    assert.equal(l.check("1.1.1.1", "ana").allowed, true);
    l.fail("1.1.1.1", "ana");
  }
  const r = l.check("1.1.1.1", "ana");
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= 900);
});

test("el bloqueo de un usuario no afecta a otra IP ni a otro usuario", () => {
  const l = createLoginLimiter({ now: clock().now });
  for (let i = 0; i < 8; i++) l.fail("1.1.1.1", "ana");
  assert.equal(l.check("1.1.1.1", "ana").allowed, false);
  assert.equal(l.check("2.2.2.2", "ana").allowed, true);
  assert.equal(l.check("1.1.1.1", "beto").allowed, true);
});

test("el usuario se normaliza (mayúsculas y espacios)", () => {
  const l = createLoginLimiter({ now: clock().now });
  for (let i = 0; i < 8; i++) l.fail("1.1.1.1", i % 2 ? " ANA " : "ana");
  assert.equal(l.check("1.1.1.1", "Ana").allowed, false);
});

test("bloquea una IP que prueba muchos usuarios distintos", () => {
  const l = createLoginLimiter({ now: clock().now });
  for (let i = 0; i < 30; i++) l.fail("9.9.9.9", "usuario" + i);
  assert.equal(l.check("9.9.9.9", "otro").allowed, false);
  assert.equal(l.check("8.8.8.8", "otro").allowed, true);
});

test("el bloqueo vence después de la ventana", () => {
  const c = clock();
  const l = createLoginLimiter({ now: c.now });
  for (let i = 0; i < 8; i++) l.fail("1.1.1.1", "ana");
  assert.equal(l.check("1.1.1.1", "ana").allowed, false);
  c.advance(15 * 60 * 1000 + 1);
  assert.equal(l.check("1.1.1.1", "ana").allowed, true);
});

test("un login correcto borra el contador del usuario", () => {
  const l = createLoginLimiter({ now: clock().now });
  for (let i = 0; i < 7; i++) l.fail("1.1.1.1", "ana");
  l.success("1.1.1.1", "ana");
  for (let i = 0; i < 7; i++) l.fail("1.1.1.1", "ana");
  assert.equal(l.check("1.1.1.1", "ana").allowed, true);
});

test("la memoria queda acotada", () => {
  const l = createLoginLimiter({ now: clock().now, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) l.fail("ip" + i, "u" + i);
  assert.ok(l.size() <= 100);
});

test("safeMessage oculta errores de base de datos y deja pasar los de negocio", () => {
  const logged = [];
  const log = (...a) => logged.push(a);
  const pgErr = Object.assign(new Error('relation "panel_users" does not exist'), { code: "42P01", severity: "ERROR" });
  const netErr = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" });
  assert.equal(safeMessage(pgErr, log), GENERIC_ERROR);
  assert.equal(safeMessage(netErr, log), GENERIC_ERROR);
  assert.equal(logged.length, 2);
  assert.equal(safeMessage(new Error("Servicio demo pausado."), log), "Servicio demo pausado.");
  const closed = Object.assign(new Error("Los pedidos están cerrados."), { code: "ORDERS_CLOSED" });
  assert.equal(isSystemError(closed), false);
  assert.equal(safeMessage(closed, log), "Los pedidos están cerrados.");
  assert.equal(logged.length, 2);
});
