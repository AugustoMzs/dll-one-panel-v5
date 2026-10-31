// Límite de intentos fallidos de login, en memoria y sin dependencias.
// - Por IP + usuario: frena la adivinanza de la contraseña de una cuenta.
// - Por IP: frena a quien prueba muchos usuarios desde un mismo lugar.
// Una ventana fija se abre con el primer fallo y se vacía sola al vencer.
// Un login correcto borra el contador de esa IP + usuario.

export function createLoginLimiter({
  windowMs = 15 * 60 * 1000,
  maxPerUser = 8,
  maxPerIp = 30,
  maxKeys = 10000,
  now = () => Date.now()
} = {}) {
  const entries = new Map(); // clave -> { count, start }

  const userKey = (ip, user) =>
    `u|${ip}|${String(user || "").trim().toLowerCase().slice(0, 200)}`;
  const ipKey = (ip) => `i|${ip}`;

  function live(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() - entry.start >= windowMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function retryAfter(entry) {
    return Math.max(1, Math.ceil((entry.start + windowMs - now()) / 1000));
  }

  function prune() {
    if (entries.size <= maxKeys) return;
    const t = now();
    for (const [key, entry] of entries) {
      if (t - entry.start >= windowMs) entries.delete(key);
    }
    // Si sigue lleno, se descartan los más antiguos (el Map conserva el orden).
    for (const key of entries.keys()) {
      if (entries.size <= maxKeys) break;
      entries.delete(key);
    }
  }

  function bump(key) {
    const entry = live(key);
    if (entry) {
      entry.count += 1;
    } else {
      entries.set(key, { count: 1, start: now() });
    }
  }

  return {
    check(ip, user) {
      const byUser = live(userKey(ip, user));
      if (byUser && byUser.count >= maxPerUser) {
        return { allowed: false, retryAfterSec: retryAfter(byUser) };
      }
      const byIp = live(ipKey(ip));
      if (byIp && byIp.count >= maxPerIp) {
        return { allowed: false, retryAfterSec: retryAfter(byIp) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
    fail(ip, user) {
      bump(userKey(ip, user));
      bump(ipKey(ip));
      prune();
    },
    success(ip, user) {
      entries.delete(userKey(ip, user));
    },
    size() {
      return entries.size;
    }
  };
}
