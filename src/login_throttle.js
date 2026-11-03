import {createHmac} from 'node:crypto';

// Limita intentos compartidos entre réplicas; guarda solo un HMAC irreversible de usuario + origen.
// No confiar en X-Forwarded-For sin configurar y verificar la cadena de proxies de Railway.
const WINDOW_MINUTES=10, MAX_ATTEMPTS=20;
export function loginThrottleKey(login,origin,secret=process.env.JWT_SECRET){
  if(typeof secret!=='string'||secret.length<24)throw Error('Falta la clave de seguridad del panel.');
  const normalized=String(login||'').trim().toLowerCase().slice(0,200);
  const remote=String(origin||'unknown').slice(0,200);
  return createHmac('sha256',secret).update(normalized+'\0'+remote).digest('hex');
}
export async function initLoginThrottle(db){
  await db.query("CREATE TABLE IF NOT EXISTS panel_login_attempts(rate_key TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,window_end TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("CREATE INDEX IF NOT EXISTS idx_panel_login_attempts_expiry ON panel_login_attempts(window_end)");
  // Limpieza al iniciar; evita crecimiento indefinido incluso si no hay intentos nuevos.
  await db.query("DELETE FROM panel_login_attempts WHERE window_end<NOW()-interval '1 day'");
}
export async function consumeLoginAttempt(db,key){
  if(!/^[a-f0-9]{64}$/.test(String(key||'')))throw Error('Clave de límite inválida.');
  const result=await db.query(
    "INSERT INTO panel_login_attempts(rate_key,attempts,window_end,updated_at) VALUES($1,1,NOW()+interval '10 minutes',NOW()) ON CONFLICT(rate_key) DO UPDATE SET attempts=CASE WHEN panel_login_attempts.window_end<=NOW() THEN 1 ELSE LEAST(panel_login_attempts.attempts+1,100000) END,window_end=CASE WHEN panel_login_attempts.window_end<=NOW() THEN NOW()+interval '10 minutes' ELSE panel_login_attempts.window_end END,updated_at=NOW() RETURNING attempts,GREATEST(1,CEIL(EXTRACT(EPOCH FROM(window_end-NOW()))))::int AS retry_seconds",
    [key]
  );
  const value=result.rows[0];
  return {allowed:Number(value.attempts)<=MAX_ATTEMPTS,retryAfterSeconds:Number(value.retry_seconds),windowMinutes:WINDOW_MINUTES};
}
export async function clearLoginAttempts(db,key){
  await db.query('DELETE FROM panel_login_attempts WHERE rate_key=$1',[key]);
}
