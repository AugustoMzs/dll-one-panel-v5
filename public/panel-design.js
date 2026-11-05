/* Progressive presentation only: retain original controls, IDs, fieldsets and access checks. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const card = id => byId(id)?.closest('.card');
  function tabs(sectionId, groups) {
    const section = byId(sectionId);
    if (!section || section.dataset.organized) return;
    section.dataset.organized = 'true';
    const nav = document.createElement('div');
    nav.className = 'section-tabs'; nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Secciones de ' + section.querySelector('h1').textContent);
    const entries = groups.map(([label, nodes]) => {
      const panel = document.createElement('div'); panel.className = 'design-pane';
      panel.id = sectionId + '-pane-' + nav.children.length;
      panel.setAttribute('role', 'tabpanel');
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = label; button.id = panel.id + '-tab';
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
      panel.setAttribute('aria-labelledby', button.id);
      for (const node of nodes.filter(Boolean)) panel.append(node);
      nav.append(button); section.append(panel);
      return {button, panel};
    });
    const select = index => entries.forEach(({button, panel}, i) => {
      panel.hidden = i !== index; button.tabIndex = i === index ? 0 : -1;
      button.setAttribute('aria-selected', String(i === index));
    });
    entries.forEach(({button}, i) => {
      button.addEventListener('click', () => select(i));
      button.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (i + 1) % entries.length;
        if (event.key === 'ArrowLeft') next = (i + entries.length - 1) % entries.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = entries.length - 1;
        if (next === undefined) return;
        event.preventDefault(); select(next); entries[next].button.focus();
      });
    });
    section.querySelector('.hero').after(nav); select(0);
  }
  // Save covers the same business fields irrespective of the visible subsection.
  const business = byId('business');
  if (business) {
    const cards = [card('bizName'), card('bizWelcome'), card('botInstructionsText'), byId('businessAdmin'), byId('moduleAssignmentCard'), card('orderHoursFields'), card('payFields')];
    tabs('business', [
      ['Datos y atención', [cards[0], cards[1], cards[4]]], ['Asistente IA', [cards[2]]],
      ['Locales y servicio', [cards[3]]], ['Horarios', [cards[5]]],
      ['Pagos', [cards[6]]]
    ]);
    const bar = document.createElement('div'); bar.className = 'design-save';
    const note = document.createElement('p'); note.textContent = 'Datos, atención y módulo se guardan juntos. Las demás secciones tienen su propio botón para guardar.';
    const save = byId('saveBusinessButton'); save.textContent = 'Guardar datos del negocio';
    bar.append(note, save); business.querySelector('.section-tabs').after(bar);
    bar.after(byId('businessSaveStatus'));
  }
  tabs('admin', [
    ['Empresas', [card('adminCompanyName'), card('companyServiceList')]],
    ['Usuarios y accesos', [card('adminUserName'), card('adminUsersList')]],
    ['WhatsApp', [card('nativePhone')]], ['Migración', [card('migrationAuditResults')]]
  ]);
  const healthDate = byId('healthDate')?.closest('.form-field');
  if (healthDate) { healthDate.classList.add('health-shared-date'); byId('health').querySelector('.hero').after(healthDate); }
  tabs('health', [
    ['Agenda', [card('healthAgenda')]], ['Recepción', [card('healthBookDoctor')]],
    ['Especialistas', [card('healthDoctorEdit')]], ['Prueba del bot', [card('healthChatLog')]]
  ]);
  // Preserve disabled fieldset ancestry in Gastro: collapsible subsections inside it.
  const settings = byId('gSettingsFields');
  if (settings) {
    for (const id of ['gImagesHeading', 'gPaymentsHeading', 'gZonesHeading']) {
      const heading = byId(id), content = heading?.nextElementSibling;
      if (!heading || !content) continue;
      const details = document.createElement('details'); details.className = 'design-details';
      const summary = document.createElement('summary'); summary.textContent = heading.textContent;
      heading.before(details); details.append(summary, heading, content);
      heading.hidden = true;
      document.querySelectorAll('#gastro .actions-row button').forEach(button => {
        if (button.getAttribute('onclick')?.includes("getElementById('" + id + "')")) {
          button.removeAttribute('onclick');
          button.addEventListener('click', () => { details.open = true; details.scrollIntoView({behavior:'smooth', block:'start'}); });
        }
      });
    }
    const migration = card('gMigrationStatus');
    if (migration) {
      const details = document.createElement('details'); details.className = 'design-details';
      const summary = document.createElement('summary'); summary.textContent = 'Importación del panel anterior';
      migration.before(details); details.append(summary, migration);
    }
  }
  // Remove layout shells emptied by moving real controls, without replacing them.
  document.querySelectorAll('#business > .section-grid,#admin > .section-grid,#health > .grid-2').forEach(grid => {
    if (!grid.querySelector('input,button,select,textarea,.card')) grid.remove();
  });
})();
