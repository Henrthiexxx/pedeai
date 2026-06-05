(function () {
  'use strict';

  if (window.PedraSecurityMonitor) return;

  const CONFIG = {
    flagRefreshMs: 5 * 60 * 1000,
    heartbeatMs: 60 * 1000,
    clickWindowMs: 60 * 1000,
    autoFlagScore: 70,
    lightBanScore: 120,
    maxPages: 30
  };

  const state = {
    started: false,
    uid: null,
    email: '',
    sessionId: '',
    flag: null,
    flagLoadedAt: 0,
    currentPage: location.pathname || '/',
    pageStartedAt: Date.now(),
    clicks: [],
    totalClicks: 0,
    suspiciousScore: 0,
    pages: {},
    dirty: false,
    heartbeatTimer: null,
    flagTimer: null,
    lightBanOverlay: null
  };

  function auth() {
    return window.firebase?.auth?.();
  }

  function db() {
    return window.firebase?.firestore?.();
  }

  function serverTimestamp() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  function nowMs() {
    return Date.now();
  }

  function makeSessionId(uid) {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `${uid}_${Date.now()}_${suffix}`;
  }

  function cleanPath(path) {
    return String(path || '/').split('?')[0].split('#')[0] || '/';
  }

  function currentPath() {
    return cleanPath(location.pathname || '/');
  }

  function ensurePage(path) {
    const key = cleanPath(path);
    if (!state.pages[key]) {
      const keys = Object.keys(state.pages);
      if (keys.length >= CONFIG.maxPages) delete state.pages[keys[0]];
      state.pages[key] = { seconds: 0, clicks: 0, visits: 0, lastSeenAtMs: nowMs() };
    }
    return state.pages[key];
  }

  function updatePageTime() {
    const now = nowMs();
    const path = state.currentPage;
    const elapsed = Math.max(0, Math.round((now - state.pageStartedAt) / 1000));
    if (elapsed > 0) {
      const page = ensurePage(path);
      page.seconds += elapsed;
      page.lastSeenAtMs = now;
      state.pageStartedAt = now;
      state.dirty = true;
    }
  }

  function changePage(nextPath) {
    const next = cleanPath(nextPath);
    if (next === state.currentPage) return;
    updatePageTime();
    state.currentPage = next;
    state.pageStartedAt = nowMs();
    ensurePage(next).visits += 1;
    state.dirty = true;
    if (isWatching()) {
      createAlert('page_change', `Usuario observado abriu ${next}`, 0).catch(() => {});
      flush('page_change').catch(() => {});
    }
  }

  function isWatching() {
    return state.flag?.enabled === true || state.suspiciousScore >= CONFIG.autoFlagScore;
  }

  function lightBanUntilMs() {
    const value = state.flag?.lightBannedUntil;
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isLightBanned() {
    return state.flag?.status === 'light_banned' && lightBanUntilMs() > nowMs();
  }

  function showLightBanOverlay() {
    if (!isLightBanned()) {
      if (state.lightBanOverlay) state.lightBanOverlay.remove();
      state.lightBanOverlay = null;
      return;
    }
    if (state.lightBanOverlay) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px 14px;font:600 13px system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 18px 45px rgba(0,0,0,.28);max-width:calc(100vw - 24px);text-align:center';
    el.textContent = 'Sessao temporariamente limitada. Tente novamente mais tarde.';
    document.body.appendChild(el);
    state.lightBanOverlay = el;
  }

  function blockWhenLightBanned(event) {
    if (!isLightBanned()) return;
    const target = event.target;
    if (!target) return;
    if (event.type === 'submit' || target.closest?.('button,a,input,select,textarea,[role="button"]')) {
      event.preventDefault();
      event.stopPropagation();
      showLightBanOverlay();
    }
  }

  async function loadFlag(force) {
    if (!state.uid || !db()) return null;
    const now = nowMs();
    if (!force && state.flagLoadedAt && now - state.flagLoadedAt < CONFIG.flagRefreshMs) return state.flag;
    const doc = await db().collection('securityFlags').doc(state.uid).get();
    state.flag = doc.exists ? doc.data() : null;
    state.flagLoadedAt = now;
    showLightBanOverlay();
    return state.flag;
  }

  function addScore(type, points, details) {
    state.suspiciousScore = Math.min(250, state.suspiciousScore + points);
    state.dirty = true;
    if (state.suspiciousScore >= CONFIG.lightBanScore) {
      createAlert('light_ban', `Pontuacao suspeita atingiu ${state.suspiciousScore}`, state.suspiciousScore, details).catch(() => {});
    } else if (state.suspiciousScore >= CONFIG.autoFlagScore) {
      createAlert('auto_flag', `Pontuacao suspeita atingiu ${state.suspiciousScore}`, state.suspiciousScore, details).catch(() => {});
    } else if (points >= 40) {
      createAlert('suspicious_activity', `${type}: +${points}`, state.suspiciousScore, details).catch(() => {});
    }
  }

  function handleClick() {
    if (!state.started) return;
    const now = nowMs();
    state.clicks.push(now);
    state.clicks = state.clicks.filter(ts => now - ts <= CONFIG.clickWindowMs);
    state.totalClicks += 1;
    ensurePage(state.currentPage).clicks += 1;
    state.dirty = true;

    if (state.clicks.length >= 250) addScore('click_burst_extreme', 70, { clicksLastMinute: state.clicks.length });
    else if (state.clicks.length >= 180) addScore('click_burst', 35, { clicksLastMinute: state.clicks.length });
    else if (state.clicks.length >= 120) addScore('click_burst_light', 20, { clicksLastMinute: state.clicks.length });
  }

  function handlePotentialPermissionDenied(reason) {
    const code = reason?.code || reason?.name || '';
    const message = String(reason?.message || reason || '');
    if (code === 'permission-denied' || code === 'PERMISSION_DENIED' || message.includes('permission-denied') || message.includes('Missing or insufficient permissions')) {
      addScore('permission_denied', 40, { code, message: message.slice(0, 180), page: state.currentPage });
      createAlert('permission_denied', 'Acao negada por permissao', state.suspiciousScore, { code, page: state.currentPage }).catch(() => {});
    }
  }

  async function createAlert(type, message, score, details) {
    if (!state.uid || !db()) return;
    if (!isWatching() && !['auto_flag', 'light_ban', 'permission_denied'].includes(type)) return;
    await db().collection('securityAlerts').add({
      uid: state.uid,
      email: state.email || '',
      sessionId: state.sessionId,
      type,
      message,
      page: state.currentPage,
      score: score || state.suspiciousScore || 0,
      details: details || null,
      createdAt: serverTimestamp(),
      read: false
    });
  }

  async function flush(reason) {
    if (!state.uid || !state.sessionId || !db()) return;
    await loadFlag(false).catch(() => null);
    if (!isWatching() && !state.dirty) return;
    if (!isWatching() && state.suspiciousScore < 20) return;

    updatePageTime();
    const totalActiveSeconds = Object.values(state.pages).reduce((sum, page) => sum + (page.seconds || 0), 0);
    const payload = {
      sessionId: state.sessionId,
      uid: state.uid,
      email: state.email || '',
      lastSeenAt: serverTimestamp(),
      currentPage: state.currentPage,
      totalActiveSeconds,
      totalClicks: state.totalClicks,
      suspiciousScore: state.suspiciousScore,
      flagEnabled: state.flag?.enabled === true,
      lightBanned: isLightBanned(),
      pages: state.pages,
      lastFlushReason: reason || 'heartbeat',
      updatedAt: serverTimestamp()
    };
    if (!state.hasFlushedSession) {
      payload.startedAt = serverTimestamp();
      state.hasFlushedSession = true;
    }
    await db().collection('securitySessions').doc(state.sessionId).set(payload, { merge: true });
    state.dirty = false;
  }

  function patchHistory() {
    if (history.__pedraSecurityPatched) return;
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    history.pushState = function () {
      const result = pushState.apply(this, arguments);
      setTimeout(() => changePage(currentPath()), 0);
      return result;
    };
    history.replaceState = function () {
      const result = replaceState.apply(this, arguments);
      setTimeout(() => changePage(currentPath()), 0);
      return result;
    };
    history.__pedraSecurityPatched = true;
  }

  async function startForUser(user) {
    if (!user || state.started) return;
    state.started = true;
    state.uid = user.uid;
    state.email = user.email || '';
    state.sessionId = makeSessionId(user.uid);
    state.currentPage = currentPath();
    state.pageStartedAt = nowMs();
    state.pages = {};
    ensurePage(state.currentPage).visits += 1;
    state.hasFlushedSession = false;

    await loadFlag(true).catch(err => console.warn('[SecurityMonitor] flag read failed:', err?.code || err?.message || err));
    if (isWatching()) createAlert('online', 'Usuario observado iniciou sessao', 0).catch(() => {});

    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', blockWhenLightBanned, true);
    document.addEventListener('click', blockWhenLightBanned, true);
    window.addEventListener('popstate', () => changePage(currentPath()));
    window.addEventListener('hashchange', () => changePage(currentPath()));
    window.addEventListener('beforeunload', () => {
      updatePageTime();
      if (navigator.sendBeacon && isWatching()) {
        try {
          const payload = JSON.stringify({
            uid: state.uid,
            sessionId: state.sessionId,
            page: state.currentPage,
            at: Date.now()
          });
          navigator.sendBeacon('/__security/unload', payload);
        } catch (_) {}
      }
    });
    window.addEventListener('unhandledrejection', event => handlePotentialPermissionDenied(event.reason));
    window.addEventListener('error', event => handlePotentialPermissionDenied(event.error || event.message));
    patchHistory();

    state.heartbeatTimer = setInterval(() => flush('heartbeat').catch(() => {}), CONFIG.heartbeatMs);
    state.flagTimer = setInterval(() => loadFlag(true).catch(() => {}), CONFIG.flagRefreshMs);
    flush('start').catch(() => {});
  }

  function stop() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.flagTimer) clearInterval(state.flagTimer);
    state.heartbeatTimer = null;
    state.flagTimer = null;
    state.started = false;
  }

  function boot() {
    const instance = auth();
    if (!instance) return;
    instance.onAuthStateChanged(user => {
      if (user) startForUser(user);
      else stop();
    });
    if (instance.currentUser) startForUser(instance.currentUser);
  }

  window.PedraSecurityMonitor = {
    boot,
    flush,
    report(type, points, details) {
      addScore(type || 'manual_signal', Number(points) || 0, details || null);
    },
    refreshFlag() {
      return loadFlag(true);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
