/**
 * update-guard.js — STUB para a versão WEB (pedrad-web).
 *
 * No app de PC (Electron) este módulo bloqueava o boot quando a versão
 * instalada era menor que a mínima publicada. Na web não existe "versão
 * instalada" (o app é sempre a última carregada do Hosting), então a checagem
 * de atualização obrigatória não se aplica.
 *
 * Mantemos o mesmo contrato (`window.PedraPcUpdateGuard.checkAndBlockIfNeeded`)
 * porque `legacy/app.js` faz `if (!canBootApp) return;` — retornar `true`
 * garante que o painel web inicie normalmente.
 */
const PedraPcUpdateGuard = (() => {
  'use strict';
  async function checkAndBlockIfNeeded() {
    return true; // web: nunca bloqueia
  }
  return { checkAndBlockIfNeeded };
})();

window.PedraPcUpdateGuard = PedraPcUpdateGuard;
