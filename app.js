// ── Firebase ──
const firebaseConfig = {
    apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
    authDomain: "pedrad-814d0.firebaseapp.com",
    projectId: "pedrad-814d0",
    storageBucket: "pedrad-814d0.appspot.com",
    messagingSenderId: "293587190550",
    appId: "1:293587190550:web:80c9399f82847c80e20637"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
firebase.firestore().settings({ experimentalAutoDetectLongPolling: true, useFetchStreams: false });

const auth = firebase.auth();
const db = firebase.firestore();

// ── State ──
let currentUser = null;
let currentStore = null;
let activeOrders = [];     // pedidos com status ativo (snapshot)
let historyOrders = [];    // pedidos do histórico (get paginado)
let knownOrderIds = new Set();
let historyFilter = 'all';

// Listeners cleanup
let _unsubOrders = null;
let _unsubPendingOrders = null;
let _unsubStore = null;

// Notification
let _notifInterval = null;
let _pendingAlerts = new Set();

// Phone cache
const _phoneCache = {};
let houseCustomersIndex = new Map();
let houseCustomerAliases = new Map();
const HOUSE_CUSTOMERS_STORAGE_PREFIX = 'pedrad_house_customers_v1:';
const HOUSE_CUSTOMERS_ALIASES_STORAGE_PREFIX = 'pedrad_house_customer_aliases_v1:';

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════

function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
}

function formatCurrency(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function formatPhone(phone) {
    if (!phone) return '';
    const c = phone.replace(/\D/g, '');
    if (c.length === 11) return `(${c.slice(0,2)}) ${c.slice(2,7)}-${c.slice(7)}`;
    if (c.length === 10) return `(${c.slice(0,2)}) ${c.slice(2,6)}-${c.slice(6)}`;
    return phone;
}

function toDate(v) {
    if (!v) return new Date(0);
    return v.toDate ? v.toDate() : new Date(v);
}

function getStatusLabel(s) {
    return { pending:'Pendente', confirmed:'Confirmado', preparing:'Preparando',
             ready:'Pronto', delivering:'Em entrega', delivered:'Entregue',
             cancelled:'Cancelado' }[s] || s;
}

const ACTIVE_STATUSES = ['pending','confirmed','preparing','ready','delivering'];
const STATUS_FLOW = ['pending','confirmed','preparing','ready','delivering','delivered'];
const STATUS_FORWARD_LABELS = {
    confirmed: '✓ Aceitar',
    preparing: '🍳 Preparar',
    ready: '✓ Pronto',
    delivering: '🛵 Saiu',
    delivered: '✓ Entregue'
};

function getUniversalStoreId() {
    return currentStore?.id || localStorage.getItem('currentStoreId') || null;
}

function getHouseCustomersStorageKey(storeId = getUniversalStoreId()) {
    return storeId ? `${HOUSE_CUSTOMERS_STORAGE_PREFIX}${storeId}` : '';
}

function getHouseCustomerAliasesStorageKey(storeId = getUniversalStoreId()) {
    return storeId ? `${HOUSE_CUSTOMERS_ALIASES_STORAGE_PREFIX}${storeId}` : '';
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits : '';
}

function normalizeName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function extractCustomerKeys(order) {
    if (!order) return [];
    const keys = [];
    const uid = String(order.userId || '').trim();
    if (uid) keys.push(`uid:${uid}`);

    const phone = normalizePhone(order.userPhone || order.phone || order.customerPhone);
    if (phone) keys.push(`phone:${phone}`);

    const name = normalizeName(order.userName || order.customerName);
    if (name) keys.push(`name:${name}`);
    return [...new Set(keys)];
}

function isEligibleHousePurchase(order) {
    return !!order && order.status !== 'pending' && order.status !== 'cancelled';
}

function houseCustomersApi() {
    return window.PedraElectron?.customers || null;
}

function saveHouseCustomersIndex() {
    const storeId = getUniversalStoreId();
    if (!storeId) return;
    const data = Object.fromEntries(houseCustomersIndex.entries());
    const api = houseCustomersApi();
    if (api?.set) {
        Promise.resolve(api.set({ storeId, customers: data }))
            .catch(err => console.warn('saveHouseCustomersIndex (pc):', err));
        return;
    }
    try {
        const key = getHouseCustomersStorageKey(storeId);
        if (key) localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
        console.warn('saveHouseCustomersIndex:', err);
    }
}

async function loadHouseCustomersIndex() {
    houseCustomersIndex = new Map();
    const storeId = getUniversalStoreId();
    if (!storeId) return;
    const api = houseCustomersApi();
    if (api?.get) {
        try {
            const resp = await api.get({ storeId });
            const parsed = resp?.customers || {};
            Object.entries(parsed).forEach(([k, v]) => { if (k) houseCustomersIndex.set(k, v || {}); });
            // Migração única: importa dados antigos do localStorage para o PC.
            if (!houseCustomersIndex.size) {
                const migrated = readLegacyHouseStorage(getHouseCustomersStorageKey(storeId));
                if (migrated) {
                    Object.entries(migrated).forEach(([k, v]) => { if (k) houseCustomersIndex.set(k, v || {}); });
                    saveHouseCustomersIndex();
                }
            }
            return;
        } catch (err) {
            console.warn('loadHouseCustomersIndex (pc):', err);
        }
    }
    const legacy = readLegacyHouseStorage(getHouseCustomersStorageKey(storeId));
    if (legacy) Object.entries(legacy).forEach(([k, v]) => { if (k) houseCustomersIndex.set(k, v || {}); });
}

function readLegacyHouseStorage(key) {
    try {
        const raw = key ? localStorage.getItem(key) : null;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (err) {
        console.warn('readLegacyHouseStorage:', err);
        return null;
    }
}

function saveHouseCustomerAliases() {
    const storeId = getUniversalStoreId();
    if (!storeId) return;
    const data = Object.fromEntries(houseCustomerAliases.entries());
    const api = houseCustomersApi();
    if (api?.set) {
        Promise.resolve(api.set({ storeId, aliases: data }))
            .catch(err => console.warn('saveHouseCustomerAliases (pc):', err));
        return;
    }
    try {
        const key = getHouseCustomerAliasesStorageKey(storeId);
        if (key) localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
        console.warn('saveHouseCustomerAliases:', err);
    }
}

async function loadHouseCustomerAliases() {
    houseCustomerAliases = new Map();
    const storeId = getUniversalStoreId();
    if (!storeId) return;
    const api = houseCustomersApi();
    if (api?.get) {
        try {
            const resp = await api.get({ storeId });
            const parsed = resp?.aliases || {};
            Object.entries(parsed).forEach(([k, v]) => { if (k) houseCustomerAliases.set(k, String(v || '')); });
            if (!houseCustomerAliases.size) {
                const migrated = readLegacyHouseStorage(getHouseCustomerAliasesStorageKey(storeId));
                if (migrated) {
                    Object.entries(migrated).forEach(([k, v]) => { if (k) houseCustomerAliases.set(k, String(v || '')); });
                    saveHouseCustomerAliases();
                }
            }
            return;
        } catch (err) {
            console.warn('loadHouseCustomerAliases (pc):', err);
        }
    }
    const legacy = readLegacyHouseStorage(getHouseCustomerAliasesStorageKey(storeId));
    if (legacy) Object.entries(legacy).forEach(([k, v]) => { if (k) houseCustomerAliases.set(k, String(v || '')); });
}

function touchHouseCustomer(order) {
    if (!isEligibleHousePurchase(order)) return false;
    const keys = extractCustomerKeys(order);
    if (!keys.length) return false;
    const nowIso = new Date().toISOString();
    const displayName = order.userName || order.customerName || 'Cliente';
    let changed = false;

    keys.forEach(key => {
        const prev = houseCustomersIndex.get(key) || {};
        houseCustomersIndex.set(key, {
            name: displayName,
            firstOrderAt: prev.firstOrderAt || nowIso,
            lastOrderAt: nowIso,
            orderCount: (Number(prev.orderCount) || 0) + 1
        });
        changed = true;
    });
    return changed;
}

function rebuildHouseCustomersFromOrders(orders) {
    // Preserva clientes cadastrados manualmente (sem pedido no período) ao
    // recalcular as contagens a partir dos pedidos recentes.
    const manualEntries = new Map(houseCustomersIndex);
    houseCustomersIndex = new Map();
    (orders || []).forEach(order => {
        if (isEligibleHousePurchase(order)) touchHouseCustomer(order);
    });
    manualEntries.forEach((value, key) => {
        if (!houseCustomersIndex.has(key)) houseCustomersIndex.set(key, value);
    });
    saveHouseCustomersIndex();
}

function isHouseCustomer(order) {
    const keys = extractCustomerKeys(order);
    return keys.some(key => houseCustomersIndex.has(key));
}

function getHouseCustomerAlias(order) {
    const keys = extractCustomerKeys(order);
    for (const key of keys) {
        const alias = String(houseCustomerAliases.get(key) || '').trim();
        if (alias) return alias;
    }
    return '';
}

// ── Toast ──
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showComingSoon() {
    showToast('Disponivel em breve!');
    closeSidebar();
}

// ── Confirm Modal ──
function showConfirm(title, text, onOk, okText = 'Confirmar') {
    const el = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = text;
    const btn = document.getElementById('confirmOk');
    btn.textContent = okText;
    btn.onclick = () => { closeModal('confirmModal'); onOk(); };
    el.classList.add('active');
}

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

// ══════════════════════════════════════════════
//  NOTIFICATION SOUND
// ══════════════════════════════════════════════

function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        function beep(f, dur, t) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = f; o.type = 'sine';
            g.gain.setValueAtTime(0.4, t);
            g.gain.exponentialRampToValueAtTime(0.01, t + dur);
            o.start(t); o.stop(t + dur);
        }
        const n = ctx.currentTime;
        beep(600, .12, n); beep(800, .12, n+.15); beep(1000, .2, n+.3);
    } catch(e) {}
    if (navigator.vibrate) navigator.vibrate([300,100,300,100,300]);
}

function startNotifLoop(orderId) {
    _pendingAlerts.add(orderId);
    if (_notifInterval) return;
    playNotifSound();
    _notifInterval = setInterval(() => {
        if (_pendingAlerts.size > 0) playNotifSound();
        else stopNotifLoop();
    }, 5000);
}

function stopNotifLoop() {
    if (_notifInterval) { clearInterval(_notifInterval); _notifInterval = null; }
}

function clearAlert(orderId) {
    _pendingAlerts.delete(orderId);
    if (_pendingAlerts.size === 0) {
        stopNotifLoop();
        hideNotifPopup();
    }
}

function showNotifPopup(orderId, name, total) {
    const el = document.getElementById('notifPopup');
    document.getElementById('notifBody').textContent =
        `#${orderId.slice(-6).toUpperCase()} — ${name} — ${formatCurrency(total)}`;
    el.dataset.orderId = orderId;
    el.classList.add('show');
}

function hideNotifPopup() {
    document.getElementById('notifPopup').classList.remove('show');
}

function sendBrowserNotif(order) {
    if (Notification.permission !== 'granted') return;
    const n = new Notification('🔔 Novo Pedido!', {
        body: `#${order.id.slice(-6).toUpperCase()} — ${order.userName || 'Cliente'} — ${formatCurrency(order.total)}`,
        icon: 'icon-192.png', tag: order.id, requireInteraction: true
    });
    n.onclick = () => { window.focus(); navigateTo('dashboard'); n.close(); };
}

async function publishStoreContext() {
    if (!currentStore?.id) return;
    try {
        const pcBaseUrl = await resolvePcBaseUrl();
        await fetch('/__pedra/store-context', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                storeId: currentStore.id,
                pcBaseUrl
            })
        });
    } catch (err) {
        console.warn('Não foi possível publicar contexto da loja para o servidor local:', err);
    }
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════

auth.onAuthStateChanged(async user => {
    if (user) {
        currentUser = user;
        await loadStore();
        if (currentStore) {
            publishStoreContext();
            showApp();
            startOrdersListener();
            loadHistory();
            updateNotifBtn();
            checkSuspension();
        } else {
            showToast('Loja não encontrada');
            auth.signOut();
        }
    } else {
        cleanup();
        showAuth();
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pw = document.getElementById('loginPassword').value;
    try {
        await auth.signInWithEmailAndPassword(email, pw);
    } catch(err) { showToast('Erro: ' + err.message); }
}

function handleLogout() {
    showConfirm('Sair da conta?', 'Você será desconectado.', () => {
        if (window.Android) Android.clearStoreId();
        cleanup();
        auth.signOut();
    }, 'Sair');
}

function showAuth() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('mainApp').classList.add('hidden');
}

function showApp() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('mainApp').classList.remove('hidden');
    updateStoreUI();
}

// ══════════════════════════════════════════════
//  CLEANUP (unsub todos os listeners)
// ══════════════════════════════════════════════

function cleanup() {
    if (_unsubPendingOrders) { _unsubPendingOrders(); _unsubPendingOrders = null; }
    if (_unsubOrders) { _unsubOrders(); _unsubOrders = null; }
    if (_unsubStore) { _unsubStore(); _unsubStore = null; }
    stopNotifLoop();
    _pendingAlerts.clear();
    activeOrders = [];
    historyOrders = [];
    knownOrderIds.clear();
    houseCustomersIndex = new Map();
    houseCustomerAliases = new Map();
    currentStore = null;
    currentUser = null;
}

// ══════════════════════════════════════════════
//  STORE DATA
// ══════════════════════════════════════════════

async function loadStore() {
    try {
        let snap = await db.collection('stores')
            .where('ownerEmail', '==', currentUser.email).limit(1).get();
        if (snap.empty) {
            snap = await db.collection('stores')
                .where('ownerId', '==', currentUser.uid).limit(1).get();
        }
        if (!snap.empty) {
            currentStore = { id: snap.docs[0].id, ...snap.docs[0].data() };
            localStorage.setItem('currentStoreId', currentStore.id);
            localStorage.setItem('currentStoreName', currentStore.name || '');
            await loadHouseCustomersIndex();
            await loadHouseCustomerAliases();
        }
    } catch(err) { console.error('loadStore:', err); }
}

function updateStoreUI() {
    if (!currentStore) return;
    document.getElementById('sidebarStoreName').textContent = currentStore.name || 'Minha Loja';

    const av = document.getElementById('sidebarAvatar');
    av.innerHTML = currentStore.imageUrl
        ? `<img src="${esc(currentStore.imageUrl)}" alt="">`
        : (currentStore.emoji || '🏪');

    const open = currentStore.open !== false;
    document.getElementById('sidebarStatus').textContent = open ? '🟢 Aberto' : '🔴 Fechado';
    const tog = document.getElementById('storeToggle');
    tog.className = 'toggle' + (open ? ' active' : '');
}

async function toggleStoreStatus() {
    if (!currentStore) return;
    const wantsOpen = currentStore.open === false;

    if (wantsOpen && currentStore.suspended) {
        showToast('Loja suspensa — não é possível abrir');
        checkSuspension();
        return;
    }

    try {
        await db.collection('stores').doc(currentStore.id).update({ open: wantsOpen });
        currentStore.open = wantsOpen;
        updateStoreUI();
        showToast(wantsOpen ? 'Aberta!' : 'Fechada!');
    } catch(err) { showToast('Erro ao alterar status'); }
}

function checkSuspension() {
    if (!currentStore?.suspended) {
        document.getElementById('suspendOverlay')?.remove();
        return;
    }
    if (document.getElementById('suspendOverlay')) return;

    const reason = esc(currentStore.suspendReason || 'Pendência administrativa');
    const el = document.createElement('div');
    el.id = 'suspendOverlay';
    el.className = 'suspend-overlay';
    el.innerHTML = `
        <div class="suspend-box">
            <div class="suspend-icon">⚠️</div>
            <div class="suspend-title">Loja Suspensa</div>
            <div class="suspend-reason">${reason}</div>
            <div class="suspend-note">
                ✅ Editar produtos, configurações e histórico.<br>
                ❌ Abrir loja ou receber pedidos.<br><br>
                Contate a administração do Aplicativo.
            </div>
            <button class="btn btn-primary" onclick="this.closest('.suspend-overlay').remove()">Entendi</button>
        </div>`;
    document.body.appendChild(el);
}

// ══════════════════════════════════════════════
//  ORDERS — REALTIME LISTENERS
// ══════════════════════════════════════════════

function upsertActiveOrder(order) {
    const idx = activeOrders.findIndex(o => o.id === order.id);
    if (idx === -1) activeOrders.unshift(order);
    else activeOrders[idx] = order;
}

function removeActiveOrder(orderId) {
    activeOrders = activeOrders.filter(o => o.id !== orderId);
}

function handlePendingOrder(order) {
    const isNew = !knownOrderIds.has(order.id);
    knownOrderIds.add(order.id);
    upsertActiveOrder(order);

    if (isNew) {
        startNotifLoop(order.id);
        showNotifPopup(order.id, order.userName || 'Cliente', order.total || 0);
        showToast('Novo pedido recebido!');
        sendBrowserNotif(order);
    }
}

function startOrdersListener() {
    if (!currentStore?.id) return;
    if (_unsubPendingOrders) _unsubPendingOrders();
    if (_unsubOrders) _unsubOrders();

    if (window.Android) Android.setStoreId(currentStore.id);

    // Listener prioritário: consulta pequena, dedicada só a pedido novo pendente.
    _unsubPendingOrders = db.collection('orders')
        .where('storeId', '==', currentStore.id)
        .where('status', '==', 'pending')
        .onSnapshot(snap => {
            let changed = false;

            snap.docChanges().forEach(ch => {
                const order = { id: ch.doc.id, ...ch.doc.data() };

                if (ch.type === 'added') {
                    handlePendingOrder(order);
                    changed = true;
                } else if (ch.type === 'modified') {
                    upsertActiveOrder(order);
                    changed = true;
                } else if (ch.type === 'removed') {
                    clearAlert(order.id);
                }
            });

            if (changed) renderDashboard();
        }, err => {
            console.error('pendingOrdersSnapshot:', err);
            showToast('Erro no listener de pedidos novos');
        });

    // Listener geral: mantém a tela sincronizada quando o status muda.
    _unsubOrders = db.collection('orders')
        .where('storeId', '==', currentStore.id)
        .where('status', 'in', ACTIVE_STATUSES)
        .onSnapshot(snap => {
            snap.docChanges().forEach(ch => {
                const order = { id: ch.doc.id, ...ch.doc.data() };

                if (ch.type === 'added') {
                    if (order.status !== 'pending') knownOrderIds.add(order.id);
                    upsertActiveOrder(order);
                } else if (ch.type === 'modified') {
                    const idx = activeOrders.findIndex(o => o.id === order.id);
                    if (idx !== -1) {
                        const old = activeOrders[idx].status;
                        upsertActiveOrder(order);
                        if (old === 'pending' && order.status !== 'pending') clearAlert(order.id);
                    } else {
                        upsertActiveOrder(order);
                    }
                } else if (ch.type === 'removed') {
                    removeActiveOrder(order.id);
                    clearAlert(order.id);
                }
            });

            renderDashboard();
        }, err => {
            console.error('ordersSnapshot:', err);
            showToast('Erro ao sincronizar pedidos');
        });
}

// ══════════════════════════════════════════════
//  HISTORY — GET com filtro de 7 dias
// ══════════════════════════════════════════════

async function loadHistory() {
    if (!currentStore) return;
    const sevenDays = new Date();
    sevenDays.setDate(sevenDays.getDate() - 7);
    sevenDays.setHours(0, 0, 0, 0);

    try {
        const snap = await db.collection('orders')
            .where('storeId', '==', currentStore.id)
            .where('createdAt', '>=', sevenDays)
            .orderBy('createdAt', 'desc')
            .get();

        historyOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildHouseCustomersFromOrders(historyOrders);
        await persistHistoryOrdersLocal(historyOrders);
        historyOrders
            .filter(o => o.status !== 'pending')
            .forEach(o => knownOrderIds.add(o.id));
        renderHistory();
    } catch(err) { console.error('loadHistory:', err); }
}

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════

let currentPage = 'dashboard';
function isPcApp(){return !!window.PedraElectron?.sales?.add}
function safeIso(v){
    try{
        const d=toDate(v);
        return Number.isNaN(d?.getTime?.())?new Date(0).toISOString():d.toISOString();
    }catch(e){
        return new Date(0).toISOString();
    }
}
async function mirrorOrderToLocal(order){
    if(!isPcApp()||!order?.id||!currentStore?.id)return;
    try{
        await window.PedraElectron.sales.add({
            externalOrderId:order.id,
            storeId:currentStore.id,
            source:order.source||'delivery',
            sourceDetail:order.sourceDetail||'app',
            status:order.status,
            paymentMethod:order.paymentMethod||'',
            userName:order.userName||order.customerName||'Cliente',
            tableNumber:order.tableNumber||null,
            subtotal:order.subtotal??order.total??0,
            total:order.total??0,
            items:Array.isArray(order.items)?order.items:[],
            kind:'history',
            persistedIn:'local-db',
            syncedFrom:'firestore',
            createdAtServer:safeIso(order.createdAt),
            updatedAtServer:safeIso(order.updatedAt||order.createdAt)
        });
    }catch(e){console.error('mirrorOrderToLocal:',e)}
}

async function persistHistoryOrdersLocal(orders){
    if(!isPcApp()||!Array.isArray(orders)||!orders.length)return;
    await Promise.allSettled(orders.map(o=>mirrorOrderToLocal(o)));
}

function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${page}Page`)?.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

    const titles = { dashboard:'Painel Central', history:'Historico' };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    closeSidebar();

    if (page === 'history') loadHistory();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('show');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
}

// ══════════════════════════════════════════════
//  DASHBOARD RENDER
// ══════════════════════════════════════════════

function renderDashboard() {
    // Stats (usa activeOrders + historyOrders combinados)
    const allOrders = mergeOrders();
    const today = new Date(); today.setHours(0,0,0,0);
    const todayOrders = allOrders.filter(o => toDate(o.createdAt) >= today);

    document.getElementById('statPending').textContent =
        activeOrders.filter(o => o.status === 'pending').length;
    document.getElementById('statActive').textContent = activeOrders.length;
    document.getElementById('statToday').textContent = todayOrders.length;
    document.getElementById('statRevenue').textContent = formatCurrency(
        todayOrders.filter(o => o.status !== 'cancelled')
            .reduce((s, o) => s + (o.total || 0), 0)
    );

    // Badge
    const pending = activeOrders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }

    const countEl = document.getElementById('activeCount');
    countEl.textContent = activeOrders.length;
    countEl.style.display = activeOrders.length > 0 ? '' : 'none';

    // Active orders list
    const container = document.getElementById('activeOrdersList');
    if (activeOrders.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">✨</div><div class="empty-text">Nenhum pedido ativo</div></div>`;
        return;
    }

    const sorted = [...activeOrders].sort((a,b) => {
        const pri = { pending:0, confirmed:1, preparing:2, ready:3, delivering:4 };
        return (pri[a.status]||5) - (pri[b.status]||5);
    });

    container.innerHTML = sorted.map(o => renderOrderCard(o)).join('');

    // Busca telefones para pedidos aceitos
    sorted.forEach(o => {
        if (o.status !== 'pending' && o.userId && !o.userPhone && !o.phone) {
            fetchPhoneLazy(o);
        }
    });
}

// Merge sem duplicar
function mergeOrders() {
    const map = new Map();
    historyOrders.forEach(o => map.set(o.id, o));
    activeOrders.forEach(o => map.set(o.id, o));
    return [...map.values()];
}

// ══════════════════════════════════════════════
//  ORDER CARD (sanitizado)
// ══════════════════════════════════════════════

function renderOrderCard(order) {
    const date = toDate(order.createdAt);
    const time = date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const isPending = order.status === 'pending';
    const customer = order.userName || order.customerName || 'Cliente';
    const customerDisplay = getHouseCustomerAlias(order) || customer;
    const houseBadge = isHouseCustomer(order)
        ? '<span class="hc-badge service-local" title="Cliente que já comprou nesta loja">Cliente da casa</span>'
        : '';
    const shortId = order.id.slice(-6).toUpperCase();

    const addr = order.address || {};
    const fullAddr = [addr.street, addr.number ? 'nº ' + addr.number : '', addr.complement, addr.neighborhood].filter(Boolean).join(', ');
    const ref = addr.reference || '';

    const isLocal = order.deliveryMode === 'local' || order.orderType === 'local' || order.noDelivery === true || order.sourceDetail === 'table';
    const isDelivery = !isLocal && order.deliveryMode !== 'pickup';
    const payLabels = { pix:'💠 PIX', credit:'💳 Crédito', debit:'💳 Débito',
                        cash:'💵 Dinheiro', picpay:'💚 PicPay', food_voucher:'🎫 Vale Alimentação', local:'💵 Dinheiro' };
    const payMethod = payLabels[order.paymentMethod] || order.paymentMethod || (isLocal ? '💵 Dinheiro' : '—');
    const change = order.needChange && order.changeFor ? 'Troco p/ ' + formatCurrency(order.changeFor) : '';
    const sub = order.subtotal ?? order.total ?? 0;
    const notes = order.notes || order.observation || '';
    const isPickup = order.deliveryMode === 'pickup';
    const serviceLabel = isPickup ? 'Retirada' : (isLocal ? 'Local' : 'Entrega');

    // Phone
    const rawPhone = order.userPhone || order.phone || order.customerPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const showWA = !isPending && cleanPhone.length >= 10;

    // Items
    const itemsHtml = (order.items || []).map(i => {
        const addons = sanitizeAddons(i.addons);
        const addonSum = addons.reduce((s,a) => s + (a.price||0), 0);
        const total = (i.price + addonSum) * i.qty;
        return `<div class="order-item">
            <span class="order-item-qty">${i.qty}x</span>
            <div class="order-item-info">
                <div class="order-item-name">${esc(i.name)}</div>
                ${addons.length ? `<div class="order-item-addons">${addons.map(a => esc(a.name) + (a.price > 0 ? ' (+' + formatCurrency(a.price) + ')' : '')).join(', ')}</div>` : ''}
                ${i.description || i.descricao ? `<div class="order-item-addons">${esc(i.description || i.descricao)}</div>` : ''}
                ${i.observation ? `<div class="order-item-obs">Obs: ${esc(i.observation)}</div>` : ''}
            </div>
            <span class="order-item-price">${formatCurrency(total)}</span>
        </div>`;
    }).join('');

    return `<div class="order-card ${isPending ? 'pending' : ''}">
        <div class="order-header" onclick="toggleOrder('${order.id}')">
            <div>
                <div class="order-id">#${shortId}</div>
                <div class="order-customer">${esc(customerDisplay)}</div>
                <div class="order-meta">
                    <span>${time}</span>
                    <span>${serviceLabel}</span>
                    <span>${formatCurrency(order.total)}</span>
                    ${houseBadge}
                </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <span class="order-status s-${order.status}">${getStatusLabel(order.status)}</span>
                <div class="order-actions-inline">${getOrderActions(order)}</div>
            </div>
        </div>
        <div class="order-body" id="ob-${order.id}">
            <div class="order-body-inner">
                <div class="order-section">
                    <div class="order-section-label">${isPickup ? 'Retirada no local' : 'Endereço de entrega'}</div>
                    ${!isPickup && fullAddr
                        ? `<div class="order-address">${esc(fullAddr)}</div>${ref ? `<div class="order-address-ref">📍 ${esc(ref)}</div>` : ''}`
                        : `<div class="text-muted text-sm">Cliente retira no local</div>`}
                </div>

                ${showWA ? `<a href="https://wa.me/55${cleanPhone}" target="_blank" rel="noopener" class="order-wa">WhatsApp do cliente</a>` : ''}
                ${!isPending && !rawPhone ? `<div class="phone-row" id="ph-${order.id}"><span class="text-muted text-sm">Buscando telefone...</span></div>` : ''}

                <div class="order-section">
                    <div class="order-section-label">Itens do pedido</div>
                    ${itemsHtml}
                </div>

                ${notes ? `<div class="order-section"><div class="order-section-label">Observações</div><div class="order-notes">${esc(notes)}</div></div>` : ''}

                <div class="order-section">
                    <div class="order-section-label">Pagamento</div>
                    <div class="order-payment-label">${payMethod}</div>
                    ${change ? `<div class="order-change">${change}</div>` : ''}
                    <div class="order-totals">
                        <div class="order-total-row"><span>Subtotal</span><span>${formatCurrency(sub)}</span></div>
                        <div class="order-total-row final"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function sanitizeAddons(addons) {
    if (!Array.isArray(addons)) return [];
    return addons.filter(a => a && typeof a === 'object')
        .map((a, i) => ({ name: String(a.name||'').trim(), price: parseFloat(a.price)||0, order: a.order ?? i }))
        .filter(a => a.name)
        .sort((a,b) => a.order - b.order);
}

function toggleOrder(id) {
    document.getElementById(`ob-${id}`)?.classList.toggle('open');
}

// ══════════════════════════════════════════════
//  ORDER ACTIONS
// ══════════════════════════════════════════════

function getOrderActions(order) {
    const id = order.id;
    const b = (cls, label, status) =>
        `<button class="btn ${cls} btn-sm" onclick="event.stopPropagation();updateOrder('${id}','${status}')">${label}</button>`;
    const currentIdx = STATUS_FLOW.indexOf(order.status);
    if (currentIdx === -1 || order.status === 'delivered' || order.status === 'cancelled') return '';
    if (order.status === 'pending') {
        return b('btn-success','✓ Aceitar','confirmed') + b('btn-danger','✗ Recusar','cancelled');
    }

    const next = STATUS_FLOW[currentIdx + 1];
    if (!next || next === 'pending') return '';
    const label = STATUS_FORWARD_LABELS[next];
    if (!label) return '';
    const cls = next === 'delivered' ? 'btn-success' : next === 'delivering' ? 'btn-success' : next === 'ready' ? 'btn-warning' : 'btn-primary';
    return b(cls, label, next);
}

async function updateOrder(orderId, status) {
    try {
        const order = activeOrders.find(o => o.id === orderId);
        const timeline = order?.timeline || [];
        timeline.push({ status, timestamp: new Date().toISOString(), message: getStatusLabel(status) });

        await db.collection('orders').doc(orderId).update({
            status,
            timeline,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const updatedOrder = activeOrders.find(o => o.id === orderId) || historyOrders.find(o => o.id === orderId);
        if (touchHouseCustomer({ ...(updatedOrder || { id: orderId }), status })) {
            saveHouseCustomersIndex();
        }
        if ((status === 'delivered' || status === 'cancelled') && isPcApp()) {
            const base = activeOrders.find(o => o.id === orderId) || historyOrders.find(o => o.id === orderId) || { id: orderId };
            await mirrorOrderToLocal({ ...base, status, updatedAt: new Date().toISOString() });
        }

        clearAlert(orderId);
        showToast(`Pedido: ${getStatusLabel(status)}`);
    } catch(err) { showToast('Erro ao atualizar'); console.error(err); }
}

// ══════════════════════════════════════════════
//  PHONE LAZY FETCH
// ══════════════════════════════════════════════

async function fetchPhoneLazy(order) {
    if (!order.userId) return;
    const cacheKey = order.userId;
    if (_phoneCache[cacheKey] !== undefined) {
        updatePhoneDOM(order.id, _phoneCache[cacheKey]);
        return;
    }
    if (_phoneCache['_l_' + cacheKey]) return; // loading
    _phoneCache['_l_' + cacheKey] = true;

    try {
        const doc = await db.collection('users').doc(order.userId).get();
        const phone = doc.exists ? (doc.data()?.phone || null) : null;
        _phoneCache[cacheKey] = phone;
        delete _phoneCache['_l_' + cacheKey];
        updatePhoneDOM(order.id, phone);
    } catch(err) {
        delete _phoneCache['_l_' + cacheKey];
    }
}

function updatePhoneDOM(orderId, phone) {
    const el = document.getElementById(`ph-${orderId}`);
    if (!el) return;
    if (phone) {
        const clean = phone.replace(/\D/g, '');
        el.innerHTML = `
            <a href="tel:${esc(phone)}" class="text-sm" style="color:var(--blue);text-decoration:none;">${formatPhone(phone)}</a>
            <a href="https://wa.me/55${clean}" target="_blank" rel="noopener" class="order-wa" style="margin:0;padding:4px 10px;font-size:.75rem;">💬</a>`;
    } else {
        el.innerHTML = `<span class="text-muted text-sm">Telefone não cadastrado</span>`;
    }
}

// ══════════════════════════════════════════════
//  HISTORY RENDER
// ══════════════════════════════════════════════

function renderHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;
    if (isPcApp()) { persistHistoryOrdersLocal(historyOrders); }

    const search = (document.getElementById('historySearch')?.value || '').toLowerCase();

    let filtered = [...historyOrders];
    if (historyFilter === 'delivered') filtered = filtered.filter(o => o.status === 'delivered');
    else if (historyFilter === 'cancelled') filtered = filtered.filter(o => o.status === 'cancelled');

    if (search) {
        filtered = filtered.filter(o => {
            const name = (o.userName || o.customerName || '').toLowerCase();
            return name.includes(search) || o.id.toLowerCase().includes(search);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Nenhum pedido encontrado</div></div>`;
        return;
    }

    // Agrupa por data
    const groups = {};
    filtered.forEach(o => {
        const d = toDate(o.createdAt);
        const key = d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit' });
        if (!groups[key]) groups[key] = [];
        groups[key].push(o);
    });

    let html = '';
    for (const [dateLabel, group] of Object.entries(groups)) {
        html += `<div class="history-date">${esc(dateLabel)}</div>`;
        html += group.map(o => renderHistoryCard(o)).join('');
    }
    container.innerHTML = html;
}

function renderHistoryCard(order) {
    const date = toDate(order.createdAt);
    const time = date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const customer = order.userName || order.customerName || 'Cliente';
    const customerDisplay = getHouseCustomerAlias(order) || customer;
    const houseBadge = isHouseCustomer(order) ? '<span class="hc-badge service-local">Cliente da casa</span>' : '';
    const sClass = order.status === 'cancelled' ? 'cancelled' : 'delivered';
    const sub = order.subtotal ?? order.total ?? 0;
    const isLocal = order.deliveryMode === 'local' || order.orderType === 'local' || order.noDelivery === true || order.sourceDetail === 'table';
    const payLabels = { pix:'💠 PIX', credit:'💳 Crédito', debit:'💳 Débito',
                        cash:'💵 Dinheiro', picpay:'💚 PicPay', food_voucher:'🎫 Vale Alimentação', local:'💵 Dinheiro' };
    const pay = payLabels[order.paymentMethod] || order.paymentMethod || (isLocal ? '💵 Dinheiro' : '—');

    const items = order.items || [];
    const itemCount = items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0);
    const previewItems = items.slice(0, 3).map(i => {
        const q = parseInt(i.qty, 10) || 0;
        return `${q}x ${i.name || 'Item'}`;
    }).join(' • ');
    const tableOrCustomer = order.tableNumber ? `Mesa ${order.tableNumber}` : customerDisplay;
    const service = order.deliveryMode === 'pickup' ? 'Retirada' : (isLocal ? 'Local' : 'Entrega');
    const serviceClass = service === 'Local' ? 'service-local' : service === 'Retirada' ? 'service-pickup' : 'service-delivery';

    const itemsHtml = items.map(i => {
        const addons = sanitizeAddons(i.addons);
        const addonSum = addons.reduce((s,a) => s + (a.price||0), 0);
        const total = (i.price + addonSum) * i.qty;
        return `<div class="order-item">
            <span class="order-item-qty">${i.qty}x</span>
            <div class="order-item-info">
                <div class="order-item-name">${esc(i.name)}</div>
                ${addons.length ? `<div class="order-item-addons">${addons.map(a => esc(a.name)).join(', ')}</div>` : ''}
            </div>
            <span class="order-item-price">${formatCurrency(total)}</span>
        </div>`;
    }).join('');

    return `<div class="history-card">
        <div class="history-header" onclick="toggleHistory('${order.id}')">
            <div class="hc-main">
                <div class="hc-id-row">
                    <div class="hc-id">#${order.id.slice(-6).toUpperCase()}</div>
                    <span class="hc-badge ${sClass}">${getStatusLabel(order.status)}</span>
                    <span class="hc-badge ${serviceClass}">${service}</span>
                    <span class="hc-badge neutral">${pay.replace(/[💠💳💵💚🎫]\s*/g,'')}</span>
                </div>
                <div class="hc-customer">${esc(tableOrCustomer)}</div>
                <div class="hc-meta">
                    <span>${time}</span>
                    <span>•</span>
                    <span>${itemCount} itens</span>
                    ${previewItems ? `<span>•</span><span>${esc(previewItems)}</span>` : ''}
                    ${houseBadge ? `<span>•</span>${houseBadge}` : ''}
                </div>
            </div>
            <div style="text-align:right">
                <div class="hc-total">${formatCurrency(order.total)}</div>
                <div class="hc-status ${sClass}">${esc(customerDisplay)}</div>
            </div>
        </div>
        <div class="history-body" id="hb-${order.id}">
            <div class="history-body-inner">
                <div class="order-section">
                    <div class="order-section-label">Itens do pedido</div>
                    ${itemsHtml}
                </div>
                <div class="order-section">
                    <div class="order-section-label">Pagamento · ${pay}</div>
                    <div class="order-totals">
                        <div class="order-total-row"><span>Subtotal</span><span>${formatCurrency(sub)}</span></div>
                        <div class="order-total-row final"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function toggleHistory(id) {
    document.getElementById(`hb-${id}`)?.classList.toggle('open');
}

function setHistoryFilter(filter, el) {
    historyFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderHistory();
}

// ══════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ══════════════════════════════════════════════

async function requestNotifPermission() {
    if (!currentStore) { showToast('Faça login primeiro'); return; }
    if (Notification.permission === 'granted') {
        showToast('Notificações já ativas!');
        if (typeof setupStorePushNotifications === 'function') {
            await setupStorePushNotifications(currentStore.id);
        }
        updateNotifBtn();
        return;
    }
    if (Notification.permission === 'denied') {
        showToast('Bloqueadas. Libere nas config. do navegador.');
        return;
    }
    if (typeof setupStorePushNotifications === 'function') {
        await setupStorePushNotifications(currentStore.id);
    }
    updateNotifBtn();
}

function updateNotifBtn() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    if (Notification.permission === 'granted') {
        btn.textContent = '🔔'; btn.title = 'Notificações ativas';
    } else if (Notification.permission === 'denied') {
        btn.textContent = '🔕'; btn.title = 'Bloqueadas';
    } else {
        btn.textContent = '🔔'; btn.title = 'Ativar notificações';
    }
}

// ══════════════════════════════════════════════
//  POPUP / IFRAME SYSTEM
// ══════════════════════════════════════════════

function savedPcBaseUrl() {
    const value = localStorage.getItem('pedrad_pc_base_url') || '';
    return isNetworkBaseUrl(value) ? value : '';
}

function isNetworkBaseUrl(value) {
    try {
        const host = new URL(value).hostname;
        return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
    } catch (e) {
        return false;
    }
}

async function resolvePcBaseUrl() {
    if (window.PedraElectron?.getServerInfo) {
        try {
            const info = await window.PedraElectron.getServerInfo();
            if (info?.baseUrl && isNetworkBaseUrl(info.baseUrl)) {
                localStorage.setItem('pedrad_pc_base_url', info.baseUrl);
                return info.baseUrl;
            }
        } catch (e) {
            console.warn('Servidor local não informado pelo Electron:', e);
        }
    }
    return savedPcBaseUrl();
}

function buildPopupUrl(page, pcBaseUrl = savedPcBaseUrl()) {
    const url = new URL(page, location.href);
    const file = url.pathname.split('/').pop() || page;
    const sid = getUniversalStoreId();
    const tablePages = new Set(['mesas.html', 'funcionarios.html', 'garcom.html']);

    if (sid && !url.searchParams.has('storeId')) {
        url.searchParams.set('storeId', sid);
    }

    if (tablePages.has(file) && pcBaseUrl) {
        url.searchParams.set('pcBaseUrl', pcBaseUrl);
    }

    return `${file}${url.search}${url.hash}`;
}

function openPopup(page) {
    const modal = document.getElementById('iframeModal');
    const frame = document.getElementById('popupFrame');
    modal.classList.add('show');

    const file = new URL(page, location.href).pathname.split('/').pop() || page;
    const tablePages = new Set(['mesas.html', 'funcionarios.html', 'garcom.html']);
    if (!tablePages.has(file)) {
        frame.src = buildPopupUrl(page);
    }

    resolvePcBaseUrl().then(baseUrl => {
        const nextSrc = buildPopupUrl(page, baseUrl);
        if (!frame.src || frame.src !== new URL(nextSrc, location.href).href) {
            frame.src = nextSrc;
        }
    });
}

function closePopup() {
    document.getElementById('iframeModal').classList.remove('show');
    document.getElementById('popupFrame').src = '';
}

function openProductsPage() {
    const sid = getUniversalStoreId();
    if (!sid) return showToast('StoreId não encontrado');
    openPopup(`products.html?storeId=${encodeURIComponent(sid)}`);
}

function openBatchEditor() {
    const sid = getUniversalStoreId();
    if (!sid) return showToast('StoreId não encontrado');
    openPopup(`batch-editor.html?storeId=${encodeURIComponent(sid)}`);
}

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Notif popup click
    const np = document.getElementById('notifPopup');
    if (np) {
        np.addEventListener('click', e => {
            if (e.target.classList.contains('notif-popup-close')) { hideNotifPopup(); return; }
            const oid = np.dataset.orderId;
            if (oid) {
                navigateTo('dashboard');
                setTimeout(() => {
                    const body = document.getElementById(`ob-${oid}`);
                    if (body) {
                        body.classList.add('open');
                        body.closest('.order-card')?.scrollIntoView({ behavior:'smooth', block:'center' });
                    }
                }, 200);
            }
            hideNotifPopup();
        });
    }

    // Modal backdrop close
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
    });

    // PostMessage listener (subpages)
    window.addEventListener('message', e => {
        if (e.data === 'closePopup') closePopup();
        if (e.data?.type === 'productSaved') {
            showToast('Produtos atualizados!');
        }
        if (e.data?.type === 'pdvSale') {
            loadHistory(true).then(() => renderDashboard());
        }
        if (e.data?.type === 'historyOpenDashboard') {
            closePopup();
            navigateTo('dashboard');
        }
    });
});

// Expose para FCM module callback
function handleNewOrderNotification(data, message) {
    playNotifSound();
    showToast(message || 'Novo pedido recebido!');
    if (data.orderId) showNotifPopup(data.orderId, data.customerName || 'Cliente', parseFloat(data.total) || 0);
}

// ══════════════════════════════════════════════
//  THEME TOGGLE
// ══════════════════════════════════════════════

function getTheme() {
    return localStorage.getItem('pedrad-theme') || 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '◐';
    localStorage.setItem('pedrad-theme', theme);
}

function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
}

// Apply saved theme immediately
applyTheme(getTheme());

// ══════════════════════════════════════════════
//  PDV LOCAL (popup)
// ══════════════════════════════════════════════

function openPDV() {
    const sid = getUniversalStoreId();
    if (!sid) return showToast('StoreId não encontrado');

    openPopup(`pdv.html?storeId=${encodeURIComponent(sid)}`);
}

async function validateLocalPersistence() {
    if (!isPcApp()) {
        showToast('Validação local disponível apenas no app de PC');
        return;
    }
    try {
        const sid = getUniversalStoreId();
        const resp = await window.PedraElectron.sales.list({ storeId: sid || '', limit: 5000 });
        const total = Number(resp?.total || 0);
        showToast(`Banco local OK: ${total} registro(s) desta loja`);
    } catch (err) {
        console.error('validateLocalPersistence:', err);
        showToast('Falha ao validar persistência local');
    }
}

async function verifyAccountPassword(password) {
    if (!currentUser || !currentUser.email) throw new Error('Usuário não autenticado');
    if (!password || !String(password).trim()) throw new Error('Senha obrigatória');
    const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, String(password));
    await currentUser.reauthenticateWithCredential(cred);
    return true;
}

// ══════════════════════════════════════════════
//  KEYBOARD SHORTCUTS (F1-F8)
// ══════════════════════════════════════════════

document.addEventListener('keydown', e => {
    // Ignora se estiver digitando em input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Ignora se iframe/modal aberto (exceto Escape)
    const iframeOpen = document.getElementById('iframeModal')?.classList.contains('show');
    if (iframeOpen && e.key !== 'Escape') return;

    switch (e.key) {
        case 'F1':
            e.preventDefault();
            // Aceitar primeiro pedido pendente
            const pending = activeOrders.find(o => o.status === 'pending');
            if (pending) {
                updateOrder(pending.id, 'confirmed');
            } else {
                navigateTo('dashboard');
            }
            break;
        case 'F2':
            e.preventDefault();
            navigateTo('history');
            break;
        case 'F3':
            e.preventDefault();
            openProductsPage();
            break;
        case 'F4':
            e.preventDefault();
            openPopup('config.html');
            break;
        case 'F5':
            e.preventDefault();
            openPDV();
            break;
        case 'F6':
            e.preventDefault();
            toggleTheme();
            break;
        case 'F7':
            e.preventDefault();
            toggleStoreStatus();
            break;
        case 'F8':
            e.preventDefault();
            requestNotifPermission();
            break;
    }
});

// ══════════════════════════════════════════════
//  HISTORY CACHE (evita re-leitura a cada navegação)
// ══════════════════════════════════════════════

let _historyCacheTime = 0;
const HISTORY_CACHE_TTL = 60000; // 60s

const _origLoadHistory = loadHistory;
loadHistory = async function(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && historyOrders.length > 0 && (now - _historyCacheTime) < HISTORY_CACHE_TTL) {
        renderHistory();
        return;
    }
    await _origLoadHistory();
    _historyCacheTime = Date.now();
};

// Quando a janela ganha foco (ex: voltou do PDV), recarrega histórico e atualiza stats
window.addEventListener('focus', () => {
    if (!currentStore) return;
    loadHistory(true).then(() => renderDashboard());
});

// Controle input

(() => {
    if (window.__pedraGamepadNavV2) return;
    window.__pedraGamepadNavV2 = true;

    const CFG = {
        deadzone: 0.35,
        firstRepeat: 240,
        nextRepeat: 140,
        focusClass: "gp-focus"
    };

    let activeGamepadIndex = null;
    let lastFocused = null;
    let prevButtonState = {};
    let hold = { dir: null, since: 0, last: 0 };

    injectStyle();

    window.addEventListener("gamepadconnected", (e) => {
        console.log("[gamepad-nav] Controle conectado:", e.gamepad.id, "index:", e.gamepad.index);
        if (activeGamepadIndex === null) {
            activeGamepadIndex = e.gamepad.index;
        }
    });

    window.addEventListener("gamepaddisconnected", (e) => {
        console.log("[gamepad-nav] Controle desconectado:", e.gamepad.id, "index:", e.gamepad.index);
        if (activeGamepadIndex === e.gamepad.index) {
            activeGamepadIndex = null;
        }
        delete prevButtonState[e.gamepad.index];
    });

    requestAnimationFrame(loop);

    function loop(now) {
        const gp = getPreferredGamepad();
        if (!gp) {
            requestAnimationFrame(loop);
            return;
        }

        handleButtons(gp);
        handleDirection(gp, now);

        requestAnimationFrame(loop);
    }

    function injectStyle() {
        const style = document.createElement("style");
        style.textContent = `
            .${CFG.focusClass}{
                outline: 3px solid #fff !important;
                outline-offset: 2px !important;
                box-shadow: 0 0 0 4px rgba(59,130,246,.35) !important;
                border-radius: 10px !important;
            }
        `;
        document.head.appendChild(style);
    }

    function getAllGamepads() {
        const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        return pads.filter(Boolean).filter(p => p.connected);
    }

    function gamepadHasActivity(gp) {
        if (!gp) return false;

        for (const b of gp.buttons) {
            if (b.pressed || b.value > 0.5) return true;
        }

        for (const a of gp.axes) {
            if (Math.abs(a) > 0.5) return true;
        }

        return false;
    }

    function getPreferredGamepad() {
        const pads = getAllGamepads();
        if (!pads.length) return null;

        // Se algum controle teve atividade real, ele vira o ativo
        for (const gp of pads) {
            if (gamepadHasActivity(gp)) {
                if (activeGamepadIndex !== gp.index) {
                    activeGamepadIndex = gp.index;
                    console.log("[gamepad-nav] Controle ativo:", gp.id, "index:", gp.index);
                }
                return gp;
            }
        }

        // Se já existe um ativo anterior, mantém
        if (activeGamepadIndex !== null) {
            const found = pads.find(p => p.index === activeGamepadIndex);
            if (found) return found;
        }

        // Fallback
        activeGamepadIndex = pads[0].index;
        return pads[0];
    }

    function getPrevButtons(index, count) {
        if (!prevButtonState[index]) {
            prevButtonState[index] = new Array(count).fill(false);
        }
        return prevButtonState[index];
    }

    function handleButtons(gp) {
        const prev = getPrevButtons(gp.index, gp.buttons.length);
        const current = gp.buttons.map(b => !!b.pressed);

        const justPressed = (i) => current[i] && !prev[i];

        // Confirmar:
        // 0 = A / Cross
        if (justPressed(0)) {
            ensureFocus();
            confirmCurrent();
        }

        // Cancelar:
        // 1 = B / Circle
        if (justPressed(1)) {
            cancelCurrent();
        }

        // Ombro esquerdo/direito também navegam entre elementos, útil em UI ruim
        if (justPressed(4)) moveFocus("prev");
        if (justPressed(5)) moveFocus("next");

        prevButtonState[gp.index] = current;
    }

    function handleDirection(gp, now) {
        const dir = readDirection(gp);

        if (!dir) {
            hold.dir = null;
            hold.since = 0;
            hold.last = 0;
            return;
        }

        ensureFocus();

        if (hold.dir !== dir) {
            hold.dir = dir;
            hold.since = now;
            hold.last = now;
            moveFocus(mapDirToLinear(dir));
            return;
        }

        if ((now - hold.since) >= CFG.firstRepeat && (now - hold.last) >= CFG.nextRepeat) {
            hold.last = now;
            moveFocus(mapDirToLinear(dir));
        }
    }

    function readDirection(gp) {
        const b = gp.buttons;
        if (b[12]?.pressed) return "up";
        if (b[13]?.pressed) return "down";
        if (b[14]?.pressed) return "left";
        if (b[15]?.pressed) return "right";

        const x = gp.axes[0] || 0;
        const y = gp.axes[1] || 0;

        if (Math.abs(x) < CFG.deadzone && Math.abs(y) < CFG.deadzone) return null;

        if (Math.abs(x) > Math.abs(y)) {
            return x > 0 ? "right" : "left";
        }

        return y > 0 ? "down" : "up";
    }

    function mapDirToLinear(dir) {
        if (dir === "left" || dir === "up") return "prev";
        return "next";
    }

    function ensureFocus() {
        const candidates = getCandidates();
        if (!candidates.length) return;

        const current = getCurrentFocused(candidates);
        if (current) return;

        focusElement(candidates[0]);
    }

    function getCurrentScope() {
        const iframeModal = document.getElementById("iframeModal");
        const confirmModal = document.getElementById("confirmModal");
        const notifPopup = document.getElementById("notifPopup");
        const sidebar = document.getElementById("sidebar");

        if (isVisible(iframeModal)) return iframeModal;
        if (isVisible(confirmModal)) return confirmModal;
        if (isVisible(notifPopup)) return notifPopup;
        if (sidebar && sidebar.classList.contains("open")) return sidebar;

        return document;
    }

    function getCandidates() {
        const root = getCurrentScope();

        const selectors = [
            "button",
            "input",
            "select",
            "textarea",
            "a[href]",
            "[onclick]",
            ".nav-item",
            ".filter-chip",
            ".history-link",
            ".toggle",
            ".menu-toggle",
            ".theme-btn",
            ".topbar-btn",
            ".notif-popup-close"
        ].join(",");

        let els = Array.from(root.querySelectorAll(selectors))
            .filter(isValidCandidate)
            .filter(isVisible)
            .filter(el => !isInsideHiddenPage(el));

        els = [...new Set(els)];

        els.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();

            const rowDiff = Math.abs(ra.top - rb.top);
            if (rowDiff > 12) return ra.top - rb.top;
            return ra.left - rb.left;
        });

        for (const el of els) {
            if (!el.hasAttribute("tabindex")) {
                el.setAttribute("tabindex", "-1");
            }
        }

        return els;
    }

    function isValidCandidate(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.hidden) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;

        const tag = el.tagName.toLowerCase();
        if (tag === "input" && el.type === "hidden") return false;

        return true;
    }

    function isVisible(el) {
        if (!el) return false;
        const st = getComputedStyle(el);

        if (st.display === "none") return false;
        if (st.visibility === "hidden") return false;
        if (parseFloat(st.opacity || "1") === 0) return false;
        if (el.getClientRects().length === 0) return false;

        return true;
    }

    function isInsideHiddenPage(el) {
        const page = el.closest(".page");
        if (!page) return false;
        return !page.classList.contains("active");
    }

    function getCurrentFocused(candidates) {
        const active = document.activeElement;
        if (active && candidates.includes(active)) return active;
        if (lastFocused && candidates.includes(lastFocused)) return lastFocused;
        return null;
    }

    function focusElement(el) {
        if (!el) return;

        if (lastFocused && lastFocused !== el) {
            lastFocused.classList.remove(CFG.focusClass);
        }

        lastFocused = el;
        el.classList.add(CFG.focusClass);

        try {
            el.focus({ preventScroll: true });
        } catch (_) {
            try { el.focus(); } catch (__){}
        }

        try {
            el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        } catch (_) {}
    }

    function moveFocus(direction) {
        const candidates = getCandidates();
        if (!candidates.length) return;

        const current = getCurrentFocused(candidates);

        if (!current) {
            focusElement(candidates[0]);
            return;
        }

        let idx = candidates.indexOf(current);
        if (idx === -1) {
            focusElement(candidates[0]);
            return;
        }

        if (direction === "next") {
            idx = (idx + 1) % candidates.length;
        } else {
            idx = (idx - 1 + candidates.length) % candidates.length;
        }

        focusElement(candidates[idx]);
    }

    function confirmCurrent() {
        const candidates = getCandidates();
        if (!candidates.length) return;

        const current = getCurrentFocused(candidates) || candidates[0];
        if (!current) return;

        focusElement(current);

        const tag = current.tagName.toLowerCase();
        const type = (current.type || "").toLowerCase();

        if (tag === "input" && !["checkbox", "radio", "button", "submit"].includes(type)) {
            current.focus();
            return;
        }

        if (typeof current.click === "function") {
            current.click();
        }
    }

    function cancelCurrent() {
        const iframeModal = document.getElementById("iframeModal");
        const confirmModal = document.getElementById("confirmModal");
        const notifPopup = document.getElementById("notifPopup");
        const sidebar = document.getElementById("sidebar");

        if (isVisible(iframeModal)) {
            if (typeof window.closePopup === "function") {
                window.closePopup();
                return;
            }

            const btn = iframeModal.querySelector("button");
            if (btn) {
                btn.click();
                return;
            }
        }

        if (isVisible(confirmModal)) {
            const buttons = Array.from(confirmModal.querySelectorAll("button"));
            const cancelBtn = buttons.find(b => /cancelar|fechar|voltar/i.test((b.textContent || "").trim()));

            if (cancelBtn) {
                cancelBtn.click();
                return;
            }

            if (typeof window.closeModal === "function") {
                window.closeModal("confirmModal");
                return;
            }
        }

        if (isVisible(notifPopup)) {
            const closeBtn = notifPopup.querySelector(".notif-popup-close");
            if (closeBtn) {
                closeBtn.click();
                return;
            }
        }

        if (sidebar && sidebar.classList.contains("open")) {
            if (typeof window.toggleSidebar === "function") {
                window.toggleSidebar();
                return;
            }
        }

        const active = document.activeElement;
        if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
            active.blur();
            return;
        }

        if (typeof window.navigateTo === "function") {
            try {
                window.navigateTo("dashboard");
            } catch (_) {}
        }
    }
})();
