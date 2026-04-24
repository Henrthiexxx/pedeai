(function () {
  if (document.getElementById('internalBottomNav')) return;

  const nav = document.createElement('nav');
  nav.id = 'internalBottomNav';
  nav.className = 'internal-bottom-nav';

  nav.innerHTML = `
    <button class="internal-nav-btn" onclick="history.back()">
      <span>←</span>
      <small>Voltar</small>
    </button>

    <button class="internal-nav-btn" onclick="window.internalActionOne?.()">
      <span>＋</span>
      <small>Ação 1</small>
    </button>

    <button class="internal-nav-btn" onclick="window.internalActionTwo?.()">
      <span>⋯</span>
      <small>Ação 2</small>
    </button>
  `;

  document.body.appendChild(nav);
  document.body.classList.add('has-internal-bottom-nav');
})();
