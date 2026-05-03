(function () {
  if (document.getElementById('internalBottomNav')) return;

  const nav = document.createElement('nav');
  nav.id = 'internalBottomNav';
  nav.className = 'internal-bottom-nav';
  const cfg = window.internalNavConfig || {};

  if (cfg.single) {
    nav.classList.add('single');
    nav.innerHTML = `
      <button class="internal-nav-btn" onclick="${cfg.singleAction || 'window.internalActionOne?.()'}" title="${cfg.singleTitle || cfg.singleLabel || 'Salvar'}">
        <span>${cfg.singleIcon || '✓'}</span>
        <small>${cfg.singleLabel || 'Salvar'}</small>
      </button>
    `;
  } else {
    nav.innerHTML = `
      <button class="internal-nav-btn" onclick="history.back()" title="${cfg.backTitle || cfg.backLabel || 'Voltar'}">
      <span>${cfg.backIcon || '←'}</span>
      <small>${cfg.backLabel || 'Voltar'}</small>
      </button>

      <button class="internal-nav-btn" onclick="window.internalActionOne?.()" title="${cfg.actionOneTitle || cfg.actionOneLabel || 'Ação 1'}">
      <span>${cfg.actionOneIcon || '＋'}</span>
      <small>${cfg.actionOneLabel || 'Ação 1'}</small>
      </button>

      <button class="internal-nav-btn" onclick="window.internalActionTwo?.()" title="${cfg.actionTwoTitle || cfg.actionTwoLabel || 'Ação 2'}">
      <span>${cfg.actionTwoIcon || '⋯'}</span>
      <small>${cfg.actionTwoLabel || 'Ação 2'}</small>
      </button>
    `;
  }

  document.body.appendChild(nav);
  document.body.classList.add('has-internal-bottom-nav');
})();
