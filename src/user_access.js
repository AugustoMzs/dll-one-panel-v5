// Access changes preserve business data and memberships in unrelated companies.
export async function changeUserAccess(pool, {userId, actorId, active, companyId}) {
  if (!/^[1-9]\d*$/.test(String(userId)) || !Number.isSafeInteger(Number(userId))) throw Error('Usuario inválido.');
  if (Number(userId) === Number(actorId)) throw Error('No podés modificar tu propio acceso.');
  if (companyId === undefined && typeof active !== 'boolean') throw Error('El estado debe ser verdadero o falso.');
  if (companyId !== undefined && (typeof companyId !== 'string' || !companyId.trim())) throw Error('Empresa inválida.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query('SELECT user_id, role FROM panel_users WHERE user_id=$1 FOR UPDATE', [Number(userId)]);
    if (!rows[0]) throw Error('Usuario no encontrado.');
    if (String(rows[0].role).toUpperCase() === 'SUPERADMIN') throw Error('Las cuentas SUPERADMIN están protegidas.');
    if (companyId !== undefined) {
      await client.query('DELETE FROM panel_user_companies WHERE user_id=$1 AND company_id=$2', [Number(userId), companyId]);
    } else {
      await client.query('UPDATE panel_users SET active=$2, updated_at=NOW() WHERE user_id=$1', [Number(userId), active]);
    }
    await client.query('COMMIT');
    return {ok:true};
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export function registerUserAccessRoutes(app, {pool, authRequired, requireSuperadmin}) {
  const handler = company => async (req, res) => {
    try {
      const result = await changeUserAccess(pool, {userId:req.params.userId, actorId:req.session?.uid,
        ...(company ? {companyId:req.params.companyId} : {active:req.body?.active})});
      return res.json(result);
    } catch (err) { return res.status(400).json({ok:false,error:err.message}); }
  };
  app.post('/api/admin/users/:userId/active', authRequired, requireSuperadmin, handler(false));
  app.delete('/api/admin/users/:userId/companies/:companyId', authRequired, requireSuperadmin, handler(true));
}
