window.renderAdminUsers = function(container, users, {api, reload, currentUser, companies, notify}) {
  container.replaceChildren();
  if (!users.length) { container.textContent='Todavía no creaste usuarios de empresas.'; return; }
  for (const user of users) {
    const row=document.createElement('div'); row.className='data-row';
    const main=document.createElement('div'); main.className='data-row-main';
    const title=document.createElement('strong'); title.textContent=user.display_name||user.login_key;
    const detail=document.createElement('small'); detail.textContent=`${user.login_key} · ${user.role} · ${user.active?'Activo':'Suspendido'}`;
    main.append(title,detail);row.append(main);container.append(row);
    const protectedUser=String(user.role).toUpperCase()==='SUPERADMIN'||Number(user.user_id)===Number(currentUser.userId);
    function button(label, question, url, options) {
      const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;
      b.addEventListener('click',async()=>{
        if(!window.confirm(question))return;
        b.disabled=true;
        try { await api(url,options);await reload();notify('Acceso actualizado.'); }
        catch(e) { notify(e.message||'No se pudo actualizar el acceso.');b.disabled=false; }
      });return b;
    }
    for(const membership of user.companies||[]) {
      const entry=document.createElement('div');entry.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px';
      const name=companies.find(c=>c.idEmpresa===membership.companyId)?.nombreEmpresa||membership.companyId;
      const label=document.createElement('span');label.textContent=name;entry.append(label);
      if(!protectedUser)entry.append(button('Quitar acceso a empresa',`¿Quitar a ${user.login_key} el acceso a ${name}? Sus sesiones perderán acceso en la próxima solicitud. Se conservan los datos del negocio y el acceso a otras empresas.`,
        `/api/admin/users/${encodeURIComponent(user.user_id)}/companies/${encodeURIComponent(membership.companyId)}`,{method:'DELETE'}));
      main.append(entry);
    }
    if(!(user.companies||[]).length){const label=document.createElement('small');label.textContent=protectedUser?'Acceso global de superadministrador':'Sin empresas asignadas';main.append(label);}
    if(!protectedUser){
      const controls=document.createElement('div');controls.style.cssText='margin-top:12px;display:flex;flex-wrap:wrap;gap:8px';
      controls.append(button(user.active?'Suspender usuario':'Reactivar usuario',user.active?`¿Suspender a ${user.login_key}? No podrá ingresar a ninguna empresa y sus sesiones serán rechazadas en la próxima solicitud. Se conservan los datos.`:`¿Reactivar a ${user.login_key}? Recuperará acceso a las empresas que todavía tenga asignadas.`,
        `/api/admin/users/${encodeURIComponent(user.user_id)}/active`,{method:'POST',body:JSON.stringify({active:!user.active})}));main.append(controls);
    }
  }
};
