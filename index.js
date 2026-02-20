// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
    authDomain: "pedrad-814d0.firebaseapp.com",
    projectId: "pedrad-814d0",
    storageBucket: "pedrad-814d0.appspot.com",
    messagingSenderId: "293587190550",
    appId: "1:293587190550:web:80c9399f82847c80e20637"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// State
let currentUser = null;
let currentStore = null;
let orders = [];
let products = [];
let categories = [];
let storeImageData = null;
let knownOrderIds = new Set();
let historyFilter = 'all';

// ==================== NOTIFICATION SYSTEM ====================

let notificationInterval = null;
let pendingAlertOrders = new Set();

function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        function beep(freq, dur, start) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.4, start);
            gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
            osc.start(start);
            osc.stop(start + dur);
        }
        const now = audioCtx.currentTime;
        beep(600, 0.12, now);
        beep(800, 0.12, now + 0.15);
        beep(1000, 0.2, now + 0.3);
    } catch (e) { console.log('Audio error:', e); }

    if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
}

function getUniversalStoreId() {
    return window.storeId || localStorage.getItem('currentStoreId') || localStorage.getItem('CURRENT_STORE_ID') || localStorage.getItem('storeId') || null;
}

function startNotificationLoop(orderId) {
    pendingAlertOrders.add(orderId);
    if (notificationInterval) return;
    playNotificationSound();
    notificationInterval = setInterval(() => {
        if (pendingAlertOrders.size > 0) {
            playNotificationSound();
        } else {
            stopNotificationLoop();
        }
    }, 5000);
}

function stopNotificationLoop() {
    if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
    }
}

function clearOrderAlert(orderId) {
    pendingAlertOrders.delete(orderId);
    if (pendingAlertOrders.size === 0) {
        stopNotificationLoop();
        closeNotificationPopup();
    }
}

function checkAndClearAlerts() {
    const pendingIds = orders.filter(o => o.status === 'pending').map(o => o.id);
    pendingAlertOrders.forEach(id => {
        if (!pendingIds.includes(id)) clearOrderAlert(id);
    });
}

function showNotificationPopup(orderId, customerName, total) {
    const popup = document.getElementById('notificationPopup');
    const body = document.getElementById('notificationPopupBody');
    body.textContent = `#${orderId.slice(-6).toUpperCase()} — ${customerName} — ${formatCurrency(total)}`;
    popup.classList.add('show');
    popup.dataset.orderId = orderId;
}

function closeNotificationPopup() {
    document.getElementById('notificationPopup').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
    const popup = document.getElementById('notificationPopup');
    if (popup) {
        popup.addEventListener('click', (e) => {
            if (e.target.classList.contains('notification-popup-close')) return;
            const orderId = popup.dataset.orderId;
            if (orderId) {
                showPage('dashboard');
                setTimeout(() => {
                    const body = document.getElementById(`ao-${orderId}`);
                    if (body) {
                        body.classList.add('expanded');
                        body.closest('.active-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 300);
            }
            closeNotificationPopup();
        });
    }
});

function handleNewOrderNotification(data, message) {
    playNotificationSound();
    showToast('🔔 ' + (message || 'Novo pedido recebido!'));
    if (data.orderId) showNotificationPopup(data.orderId, data.customerName || 'Cliente', parseFloat(data.total) || 0);
}

async function requestNotificationPermission() {
    if (!currentStore) { showToast('Faça login primeiro'); return; }
    if (Notification.permission === 'granted') {
        showToast('Notificações já ativas!');
        await setupStorePushNotifications(currentStore.id);
        updateNotificationButton();
        return;
    }
    if (Notification.permission === 'denied') {
        showToast('Notificações bloqueadas. Libere nas configurações do navegador.');
        return;
    }
    await setupStorePushNotifications(currentStore.id);
    showToast(Notification.permission === 'granted' ? '🔔 Notificações ativadas!' : 'Permissão negada');
    updateNotificationButton();
}

function updateNotificationButton() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    if (Notification.permission === 'granted') {
        btn.textContent = '🔔'; btn.title = 'Notificações ativas'; btn.classList.add('active');
    } else if (Notification.permission === 'denied') {
        btn.textContent = '🔕'; btn.title = 'Notificações bloqueadas';
    } else {
        btn.textContent = '🔔'; btn.title = 'Clique para ativar notificações';
    }
}

// ==================== AUTH ====================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        await loadStoreData();
        if (currentStore) {
            showMainApp();
            await loadAllData();
            setupRealtimeListeners();
            updateNotificationButton();
        } else {
            showToast('Loja não encontrada para este usuário');
            auth.signOut();
        }
    } else {
        showAuthPage();
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        await auth.signInWithEmailAndPassword(email, password);
        setTimeout(() => {
            if (currentStore && Notification.permission === 'default') requestNotificationPermission();
        }, 1000);
    } catch (err) { showToast('Erro: ' + err.message); }
}

function handleLogout() {
    showConfirmModal('Deseja sair?', 'Você será desconectado do painel.', () => auth.signOut());
}

function showConfirmModal(title, text, onConfirm, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalText').textContent = text;
    document.getElementById('confirmModalBtn').textContent = confirmText;
    document.getElementById('confirmModalCancel').textContent = cancelText;
    document.getElementById('confirmModalBtn').onclick = () => {
        closeModal('confirmModal');
        if (onConfirm) onConfirm();
    };
    openModal('confirmModal'); // FIX: era Modal('confirmModal')
}

function showAuthPage() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
}

// ==================== DATA ====================

async function loadStoreData() {
    try {
        let snapshot = await db.collection('stores').where('ownerEmail', '==', currentUser.email).limit(1).get();
        if (snapshot.empty) snapshot = await db.collection('stores').where('ownerId', '==', currentUser.uid).limit(1).get();
        if (!snapshot.empty) {
            currentStore = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            localStorage.setItem('currentStoreId', currentStore.id);
            updateStoreUI();
        }
    } catch (err) { console.error('Error loading store:', err); }
}

function updateStoreUI() {
    document.getElementById('sidebarStoreName').textContent = currentStore.name || 'Minha Loja';
    document.getElementById('sidebarAvatar').innerHTML = currentStore.imageUrl
        ? `<img src="${currentStore.imageUrl}" alt="Logo">`
        : (currentStore.emoji || '🏪');

    const isOpen = currentStore.open !== false;
    document.getElementById('sidebarStatus').textContent = isOpen ? '🟢 Aberto' : '🔴 Fechado';
    document.getElementById('sidebarStatus').className = 'store-status' + (isOpen ? '' : ' closed');
    document.getElementById('storeToggle').className = 'toggle' + (isOpen ? ' active' : '');

    document.getElementById('storeName').value = currentStore.name || '';
    document.getElementById('storeCategory').value = currentStore.category || 'Hambúrgueres';
    document.getElementById('storeDescription').value = currentStore.description || '';
    document.getElementById('storeDeliveryTime').value = currentStore.deliveryTime || '';
    document.getElementById('storeDeliveryFee').value = currentStore.deliveryFee || '';
    document.getElementById('storeAddress').value = currentStore.address || '';
    document.getElementById('storePhone').value = currentStore.phone || '';

    if (currentStore.imageUrl) {
        const el = document.getElementById('storeImageUpload');
        el.classList.add('has-image');
        el.innerHTML = `<img src="${currentStore.imageUrl}" alt="Logo"><input type="file" id="storeImageInput" accept="image/*" onchange="handleStoreImageUpload(event)">`;
    }

    selectDeliveryType(currentStore.deliveryType || 'app', false);
}

async function loadAllData() {
    await Promise.all([loadOrders(), loadProducts(), loadCategories()]);
    updateDashboard();
    renderHistory();
}

async function loadOrders() {
    try {
        const snapshot = await db.collection('orders').where('storeId', '==', currentStore.id).get();
        orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
            return dateB - dateA;
        });
        orders.forEach(o => knownOrderIds.add(o.id));
    } catch (err) { console.error('Error loading orders:', err); }
}

async function loadProducts() {
    try {
        const snapshot = await db.collection('products').where('storeId', '==', currentStore.id).get();
        products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
        renderProducts();
    } catch (err) { console.error('Error loading products:', err); }
}

async function loadCategories() {
    const savedCats = currentStore.categories || [];
    const productCats = [...new Set(products.map(p => p.category).filter(Boolean))];
    categories = [...new Set([...savedCats, ...productCats])].sort();
    renderCategories();
}

// ==================== REAL-TIME ====================

function setupRealtimeListeners() {
    db.collection('orders').where('storeId', '==', currentStore.id).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const order = { id: change.doc.id, ...change.doc.data() };

            if (change.type === 'added') {
                const isNew = !knownOrderIds.has(order.id);
                if (isNew) {
                    knownOrderIds.add(order.id);
                    orders.unshift(order);
                    if (order.status === 'pending') {
                        startNotificationLoop(order.id);
                        showNotificationPopup(order.id, order.userName || 'Cliente', order.total || 0);
                        showToast('🔔 Novo pedido recebido!');
                        sendBrowserNotification(order);
                    }
                }
            } else if (change.type === 'modified') {
                const idx = orders.findIndex(o => o.id === order.id);
                if (idx !== -1) {
                    const oldStatus = orders[idx].status;
                    orders[idx] = order;
                    if (oldStatus === 'pending' && order.status !== 'pending') clearOrderAlert(order.id);
                }
            } else if (change.type === 'removed') {
                orders = orders.filter(o => o.id !== order.id);
                knownOrderIds.delete(order.id);
                clearOrderAlert(order.id);
            }
        });

        checkAndClearAlerts();
        updateDashboard();
        renderHistory();
    });
}

function sendBrowserNotification(order) {
    if (Notification.permission !== 'granted') return;
    const notif = new Notification('🔔 Novo Pedido!', {
        body: `#${order.id.slice(-6).toUpperCase()} — ${order.userName || 'Cliente'} — ${formatCurrency(order.total)}`,
        icon: '/pedeai/icon-192.png',
        tag: order.id,
        requireInteraction: true
    });
    notif.onclick = () => {
        window.focus();
        showPage('dashboard');
        setTimeout(() => {
            const body = document.getElementById(`ao-${order.id}`);
            if (body) {
                body.classList.add('expanded');
                body.closest('.active-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
        notif.close();
    };
}

// ==================== NAVIGATION ====================

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById(`${page}Page`);
    if (pageEl) pageEl.classList.add('active');

    const titles = { dashboard: 'Painel Central', history: 'Histórico', products: 'Produtos', categories: 'Categorias', store: 'Minha Loja', settings: 'Configurações' };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    const navMap = { dashboard: 'Painel Central', history: 'Histórico', products: 'Produtos', categories: 'Categorias', store: 'Minha Loja', settings: 'Configurações' };
    document.querySelectorAll('.nav-item').forEach(item => {
        const txt = item.textContent.trim();
        if (navMap[page] && txt.includes(navMap[page])) item.classList.add('active');
    });

    closeSidebar();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('show');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
}

// ==================== DASHBOARD ====================

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivering'];

function updateDashboard() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter(o => (o.createdAt?.toDate?.() || new Date(o.createdAt)) >= today);
    const activeOrders = orders.filter(o => ACTIVE_STATUSES.includes(o.status));

    // Stats
    document.getElementById('statPending').textContent = orders.filter(o => o.status === 'pending').length;
    document.getElementById('statActive').textContent = activeOrders.length;
    document.getElementById('statToday').textContent = todayOrders.length;
    document.getElementById('statRevenue').textContent = formatCurrency(
        todayOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0)
    );

    // Active count badge
    const countEl = document.getElementById('activeCount');
    countEl.textContent = activeOrders.length;
    countEl.style.display = activeOrders.length > 0 ? 'inline-block' : 'none';

    // Pending badge on sidebar
    const pending = orders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('historyBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'block' : 'none'; }

    // Render active orders
    const container = document.getElementById('activeOrdersList');
    if (activeOrders.length === 0) {
        container.innerHTML = `<div class="dash-empty"><div class="dash-empty-icon">✨</div><div class="dash-empty-text">Nenhum pedido ativo no momento</div></div>`;
        return;
    }

    container.innerHTML = activeOrders.map(o => renderActiveOrderCard(o)).join('');
}

function renderActiveOrderCard(order) {
    const date = order.createdAt?.toDate?.() || new Date(order.createdAt);
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const isPending = order.status === 'pending';
    const customerName = order.userName || order.customerName || 'Cliente';

    const addr = order.address || {};
    const fullAddress = [addr.street, addr.number ? `nº ${addr.number}` : '', addr.complement, addr.neighborhood].filter(Boolean).join(', ');
    const reference = addr.reference || '';

    const paymentLabels = { pix: '💠 PIX', credit: '💳 Crédito', debit: '💳 Débito', cash: '💵 Dinheiro', picpay: '💚 PicPay', food_voucher: '🎫 Vale Alimentação' };
    const paymentMethod = paymentLabels[order.paymentMethod] || order.paymentMethod || '—';
    const needChange = order.needChange && order.changeFor ? `Troco p/ ${formatCurrency(order.changeFor)}` : '';

    const deliveryFee = order.deliveryFee || 0;
    const subtotal = (order.total || 0) - deliveryFee;
    const notes = order.notes || order.observation || '';

    return `<div class="active-order ${isPending ? 'is-pending' : ''}">
        <div class="ao-header" onclick="toggleActiveOrder('${order.id}')">
            <div class="ao-left">
                <div class="ao-id">#${order.id.slice(-6).toUpperCase()}</div>
                <div class="ao-meta">
                    <span>${customerName}</span>
                    <span>•</span>
                    <span>${timeStr}</span>
                    <span>•</span>
                    <span>${formatCurrency(order.total)}</span>
                </div>
            </div>
            <span class="ao-status ao-status-${order.status}">${getStatusLabel(order.status)}</span>
        </div>
        <div class="ao-body" id="ao-${order.id}">
            <div class="ao-body-inner">
                <!-- Delivery / Pickup -->
                <div class="ao-section">
                    <div class="ao-section-label">${order.deliveryMode === 'pickup' ? '🏃 Retirada' : '🛵 Entrega'}</div>
                    ${order.deliveryMode !== 'pickup'
                        ? `<div class="ao-address"><strong>${fullAddress || 'Não informado'}</strong>${reference ? `<br>📍 ${reference}` : ''}</div>`
                        : `<div class="ao-pickup">Cliente retira no local</div>`}
                </div>

                ${['confirmed','preparing','ready','delivering'].includes(order.status) && (order.userPhone || order.phone) ? `
                <div class="ao-section" style="padding:8px 0">
                    <a href="https://wa.me/55${(order.userPhone || order.phone).replace(/\D/g, '')}" target="_blank" rel="noopener"
                       style="display:flex;align-items:center;gap:10px;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.25);border-radius:10px;padding:10px 14px;text-decoration:none;color:#25D366;font-size:0.82rem;font-weight:500;transition:background 0.2s">
                        💬 WhatsApp do cliente
                    </a>
                </div>` : ''}

                <!-- Items -->
                <div class="ao-section">
                    <div class="ao-section-label">🛒 Itens</div>
                    ${(order.items || []).map(i => {
                        const addons = sanitizeAddons(i.addons || []);
                        const addonTotal = addons.reduce((s, a) => s + (a.price || 0), 0);
                        const itemTotal = (i.price + addonTotal) * i.qty;
                        return `<div class="ao-item">
                            <span class="ao-item-qty">${i.qty}x</span>
                            <div class="ao-item-info">
                                <div class="ao-item-name">${i.name}</div>
                                ${addons.length ? `<div class="ao-item-addons">${addons.map(a => a.name).join(', ')}</div>` : ''}
                                ${i.observation ? `<div class="ao-item-obs">Obs: ${i.observation}</div>` : ''}
                            </div>
                            <span class="ao-item-price">${formatCurrency(itemTotal)}</span>
                        </div>`;
                    }).join('')}
                </div>

                ${notes ? `<div class="ao-section"><div class="ao-section-label">📝 Obs</div><div class="ao-notes">${notes}</div></div>` : ''}

                <!-- Totals -->
                <div class="ao-section">
                    <div class="ao-section-label">💰 Pagamento — ${paymentMethod}</div>
                    ${needChange ? `<div style="font-size:0.78rem;color:var(--accent-orange);margin-bottom:6px">${needChange}</div>` : ''}
                    <div class="ao-totals">
                        <div class="ao-total-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
                        ${deliveryFee > 0 ? `<div class="ao-total-row"><span>Entrega</span><span>${formatCurrency(deliveryFee)}</span></div>` : ''}
                        <div class="ao-total-row final"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="ao-actions">${getOrderActions(order)}</div>
            </div>
        </div>
    </div>`;
}

function toggleActiveOrder(orderId) {
    document.getElementById(`ao-${orderId}`)?.classList.toggle('expanded');
}

// ==================== HISTORY (últimos 7 dias) ====================

function setHistoryFilter(filter, el) {
    historyFilter = filter;
    document.querySelectorAll('.history-filters .filter-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const search = (document.getElementById('historySearch')?.value || '').toLowerCase();

    let filtered = orders.filter(o => {
        const d = o.createdAt?.toDate?.() || new Date(o.createdAt);
        return d >= sevenDaysAgo;
    });

    if (historyFilter === 'delivered') filtered = filtered.filter(o => o.status === 'delivered');
    else if (historyFilter === 'cancelled') filtered = filtered.filter(o => o.status === 'cancelled');

    if (search) {
        filtered = filtered.filter(o => {
            const name = (o.userName || o.customerName || '').toLowerCase();
            const id = o.id.toLowerCase();
            return name.includes(search) || id.includes(search);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="dash-empty"><div class="dash-empty-icon">📋</div><div class="dash-empty-text">Nenhum pedido encontrado</div></div>`;
        return;
    }

    // Group by date
    const groups = {};
    filtered.forEach(o => {
        const d = o.createdAt?.toDate?.() || new Date(o.createdAt);
        const key = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
        if (!groups[key]) groups[key] = [];
        groups[key].push(o);
    });

    let html = '';
    for (const [dateLabel, group] of Object.entries(groups)) {
        html += `<div class="history-date-group">${dateLabel}</div>`;
        html += group.map(o => renderHistoryCard(o)).join('');
    }

    container.innerHTML = html;
}

function renderHistoryCard(order) {
    const date = order.createdAt?.toDate?.() || new Date(order.createdAt);
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const customerName = order.userName || order.customerName || 'Cliente';
    const statusClass = order.status === 'cancelled' ? 'cancelled' : 'delivered';
    const statusLabel = getStatusLabel(order.status);

    const deliveryFee = order.deliveryFee || 0;
    const subtotal = (order.total || 0) - deliveryFee;

    const paymentLabels = { pix: '💠 PIX', credit: '💳 Crédito', debit: '💳 Débito', cash: '💵 Dinheiro', picpay: '💚 PicPay', food_voucher: '🎫 Vale Alimentação' };
    const paymentMethod = paymentLabels[order.paymentMethod] || order.paymentMethod || '—';

    return `<div class="history-card">
        <div class="hc-header" onclick="toggleHistoryCard('${order.id}')">
            <div class="hc-left">
                <div class="hc-id">#${order.id.slice(-6).toUpperCase()} — ${customerName}</div>
                <div class="hc-meta">
                    <span>${timeStr}</span>
                    <span>•</span>
                    <span>${order.deliveryMode === 'pickup' ? 'Retirada' : 'Entrega'}</span>
                    <span>•</span>
                    <span>${(order.items || []).length} itens</span>
                </div>
            </div>
            <div class="hc-right">
                <div class="hc-total">${formatCurrency(order.total)}</div>
                <span class="hc-status hc-status-${statusClass}">${statusLabel}</span>
            </div>
        </div>
        <div class="hc-body" id="hc-${order.id}">
            <div class="hc-body-inner">
                <div class="ao-section">
                    <div class="ao-section-label">🛒 Itens</div>
                    ${(order.items || []).map(i => {
                        const addons = sanitizeAddons(i.addons || []);
                        const addonTotal = addons.reduce((s, a) => s + (a.price || 0), 0);
                        const itemTotal = (i.price + addonTotal) * i.qty;
                        return `<div class="ao-item">
                            <span class="ao-item-qty">${i.qty}x</span>
                            <div class="ao-item-info">
                                <div class="ao-item-name">${i.name}</div>
                                ${addons.length ? `<div class="ao-item-addons">${addons.map(a => a.name).join(', ')}</div>` : ''}
                            </div>
                            <span class="ao-item-price">${formatCurrency(itemTotal)}</span>
                        </div>`;
                    }).join('')}
                </div>
                <div class="ao-section">
                    <div class="ao-section-label">💰 ${paymentMethod}</div>
                    <div class="ao-totals">
                        <div class="ao-total-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
                        ${deliveryFee > 0 ? `<div class="ao-total-row"><span>Entrega</span><span>${formatCurrency(deliveryFee)}</span></div>` : ''}
                        <div class="ao-total-row final"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function toggleHistoryCard(orderId) {
    document.getElementById(`hc-${orderId}`)?.classList.toggle('expanded');
}

// ==================== ORDER ACTIONS ====================

function getOrderActions(order) {
    const actions = {
        pending: `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'confirmed')">✓ Aceitar</button><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'cancelled')">✗ Recusar</button>`,
        confirmed: `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'preparing')">🍳 Iniciar Preparo</button>`,
        preparing: `<button class="btn btn-warning btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'ready')">✓ Pronto</button>`,
        ready: `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'delivering')">🛵 Saiu p/ Entrega</button>`,
        delivering: `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();updateOrderStatus('${order.id}', 'delivered')">✓ Entregue</button>`
    };
    return actions[order.status] || '';
}

async function updateOrderStatus(orderId, status) {
    try {
        const timeline = orders.find(o => o.id === orderId)?.timeline || [];
        timeline.push({ status, timestamp: new Date().toISOString(), message: getStatusLabel(status) });
        await db.collection('orders').doc(orderId).update({ status, timeline, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        clearOrderAlert(orderId);
        showToast(`Pedido: ${getStatusLabel(status)}`);
    } catch (err) { showToast('Erro ao atualizar'); }
}

// ==================== PRODUCTS ====================

function renderProducts() {
    const search = document.getElementById('productSearch')?.value?.toLowerCase() || '';
    const filtered = search ? products.filter(p => p.name.toLowerCase().includes(search)) : products;
    const container = document.getElementById('productsList');

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">🍽️</div><div class="empty-state-title">Nenhum produto</div><button class="btn btn-primary" onclick="openProductModal()">+ Adicionar</button></div>';
        return;
    }

    container.innerHTML = filtered.map(p => `<div class="product-card">
        <div class="product-image">${p.imageUrl ? `<img src="${p.imageUrl}">` : (p.emoji || '🍽️')}<span class="product-badge ${p.active !== false ? 'active' : 'inactive'}">${p.active !== false ? 'Ativo' : 'Inativo'}</span></div>
        <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="product-category">${p.category || 'Sem categoria'}${p.addons?.length ? ` • ${p.addons.length} adicionais` : ''}</div>
            <div class="product-price">${formatCurrency(p.price)}</div>
            <div class="product-actions"><button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="confirmDeleteProduct('${p.id}')">🗑️</button></div>
        </div>
    </div>`).join('');
}

function filterProductsList() { renderProducts(); }

// ==================== PRODUCT EDITOR ====================

function openProductModal() { openProductEditor(); }
function editProduct(productId) { openProductEditor(productId); }

function openProductEditor(productId = null) {
    if (!currentStore?.id) { showToast('❌ Loja não carregada. Aguarde...'); return; }
    const url = productId
        ? `product-editor.html?storeId=${currentStore.id}&productId=${productId}`
        : `product-editor.html?storeId=${currentStore.id}`;
    const w = 900, h = 800;
    window.open(url, 'ProductEditor', `width=${w},height=${h},left=${(screen.width-w)/2},top=${(screen.height-h)/2},resizable=yes,scrollbars=yes`);
}

window.addEventListener('message', async (event) => {
    if (event.data.type === 'productSaved') {
        await loadProducts();
        await loadCategories();
        showToast('Produtos atualizados!');
    }
});

function confirmDeleteProduct(productId) {
    const p = products.find(x => x.id === productId);
    showConfirmModal('Excluir produto?', `"${p?.name || 'Produto'}" será removido permanentemente.`, () => deleteProduct(productId), 'Excluir');
}

async function deleteProduct(productId) {
    try { await db.collection('products').doc(productId).delete(); await loadProducts(); showToast('Excluído'); }
    catch (err) { showToast('Erro'); }
}

// ==================== CATEGORIES ====================

function renderCategories() {
    const container = document.getElementById('categoriesList');
    container.innerHTML = categories.length === 0
        ? '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-title">Nenhuma categoria</div></div>'
        : categories.map(c => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${c}</strong><div style="color:var(--text-muted);font-size:0.9rem;">${products.filter(p => p.category === c).length} produtos</div></div><button class="btn btn-danger btn-sm" onclick="confirmDeleteCategory('${c}')">🗑️</button></div>`).join('');
}

function openCategoryModal() { document.getElementById('categoryName').value = ''; openModal('categoryModal'); }

async function saveCategory() {
    const name = document.getElementById('categoryName').value.trim();
    if (!name) { showToast('Digite o nome'); return; }
    if (categories.includes(name)) { showToast('Já existe'); return; }
    categories.push(name);
    await db.collection('stores').doc(currentStore.id).update({ categories });
    currentStore.categories = categories;
    renderCategories();
    closeModal('categoryModal');
    showToast('Criada');
}

function confirmDeleteCategory(cat) {
    const count = products.filter(p => p.category === cat).length;
    if (count > 0) { showToast(`Remova ${count} produtos primeiro`); return; }
    showConfirmModal('Excluir categoria?', `"${cat}" será removida.`, () => deleteCategory(cat), 'Excluir');
}

async function deleteCategory(cat) {
    categories = categories.filter(c => c !== cat);
    await db.collection('stores').doc(currentStore.id).update({ categories });
    currentStore.categories = categories;
    renderCategories();
    showToast('Removida');
}

// ==================== STORE ====================

async function handleStoreImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    storeImageData = await compressImageSquare(file, 400, 0.8);
    const el = document.getElementById('storeImageUpload');
    el.classList.add('has-image');
    el.innerHTML = `<img src="${storeImageData}"><input type="file" id="storeImageInput" accept="image/*" onchange="handleStoreImageUpload(event)">`;
}

async function saveStoreInfo() {
    try {
        const data = {
            name: document.getElementById('storeName').value,
            category: document.getElementById('storeCategory').value,
            description: document.getElementById('storeDescription').value,
            deliveryTime: document.getElementById('storeDeliveryTime').value,
            deliveryFee: parseFloat(document.getElementById('storeDeliveryFee').value) || 0,
            address: document.getElementById('storeAddress').value,
            phone: document.getElementById('storePhone').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (storeImageData?.startsWith('data:')) data.imageUrl = storeImageData;
        await db.collection('stores').doc(currentStore.id).update(data);
        currentStore = { ...currentStore, ...data };
        updateStoreUI();
        showToast('Salvo!');
    } catch (err) { console.error(err); showToast('Erro'); }
}

async function toggleStoreStatus() {
    const storeRef = db.collection('stores').doc(currentStore.id);
    try {
        const snap = await storeRef.get();
        if (!snap.exists) { showToast('Loja não encontrada'); return; }
        const data = snap.data() || {};
        const isOpen = data.open === true;
        const wantsToOpen = !isOpen;
        if (wantsToOpen && data.suspended) {
            if (typeof checkStoreSuspension === 'function') checkStoreSuspension(data);
            showToast('Loja suspensa — não é possível abrir');
            return;
        }
        await storeRef.update({ open: wantsToOpen });
        currentStore.open = wantsToOpen;
        currentStore.suspended = !!data.suspended;
        updateStoreUI();
        showToast(wantsToOpen ? 'Aberta!' : 'Fechada!');
    } catch (err) { console.error(err); showToast('Erro'); }
}

// ==================== SETTINGS ====================

function selectDeliveryType(type, save = true) {
    ['deliveryApp', 'deliveryOwn', 'deliveryBoth'].forEach(id => document.getElementById(id)?.classList.remove('selected'));
    const el = document.getElementById(type === 'app' ? 'deliveryApp' : type === 'own' ? 'deliveryOwn' : 'deliveryBoth');
    if (el) el.classList.add('selected');
    if (save) currentStore.deliveryType = type;
}

function toggleSetting(setting) { document.getElementById(`${setting}Toggle`)?.classList.toggle('active'); }

async function saveSettings() {
    try {
        const deliveryType = document.getElementById('deliveryApp').classList.contains('selected') ? 'app' : document.getElementById('deliveryOwn').classList.contains('selected') ? 'own' : 'both';
        await db.collection('stores').doc(currentStore.id).update({
            deliveryType,
            settings: {
                soundEnabled: document.getElementById('soundToggle').classList.contains('active'),
                autoAccept: document.getElementById('autoAcceptToggle').classList.contains('active'),
                weekdayOpen: document.getElementById('weekdayOpen').value,
                weekdayClose: document.getElementById('weekdayClose').value,
                weekendOpen: document.getElementById('weekendOpen').value,
                weekendClose: document.getElementById('weekendClose').value
            }
        });
        showToast('Salvo!');
    } catch (err) { showToast('Erro'); }
}

// ==================== UTILITIES ====================

function sanitizeAddons(addons) {
    if (!Array.isArray(addons)) return [];
    return addons.filter(a => a && typeof a === 'object')
        .map((a, i) => ({ name: String(a.name || '').trim(), price: parseFloat(a.price) || 0, order: typeof a.order === 'number' ? a.order : i }))
        .filter(a => a.name);
}

function compressImageSquare(file, maxSize, quality) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const srcSize = Math.min(img.width, img.height);
                const cropX = (img.width - srcSize) / 2;
                const cropY = (img.height - srcSize) / 2;
                const finalSize = Math.min(srcSize, maxSize);
                canvas.width = finalSize; canvas.height = finalSize;
                canvas.getContext('2d').drawImage(img, cropX, cropY, srcSize, srcSize, 0, 0, finalSize, finalSize);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
function getStatusLabel(s) { return { pending: 'Pendente', confirmed: 'Confirmado', preparing: 'Preparando', ready: 'Pronto', delivering: 'Em entrega', delivered: 'Entregue', cancelled: 'Cancelado' }[s] || s; }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); }));
});

function openProductsPage() {
    const sid = getUniversalStoreId();
    if (!sid) return showToast("StoreId não encontrado");
    window.location.href = `feed.html?storeId=${encodeURIComponent(sid)}`;
}

function closeProductsModal() {
    const frame = document.getElementById('productsFrame');
    if (frame) frame.src = 'about:blank';
    const modal = document.getElementById('modalProducts');
    if (modal) modal.style.display = 'none';
}

function checkStoreSuspension(storeDoc) {
    if (!storeDoc || !storeDoc.suspended) {
        const existing = document.getElementById('suspendPopupOverlay');
        if (existing) existing.remove();
        return;
    }
    if (document.getElementById('suspendPopupOverlay')) return;
    const reason = storeDoc.suspendReason || 'Pendência administrativa';
    const overlay = document.createElement('div');
    overlay.id = 'suspendPopupOverlay';
    overlay.className = 'suspend-popup-overlay';
    overlay.innerHTML = `
        <div class="suspend-popup">
            <div class="suspend-popup-icon">⚠️</div>
            <div class="suspend-popup-title">Loja Temporariamente Suspensa</div>
            <div class="suspend-popup-text">Sua loja está suspensa e não pode abrir para receber novos pedidos no momento.</div>
            <div class="suspend-popup-reason"><strong>Motivo:</strong> ${reason}</div>
            <div class="suspend-popup-note">
                ✅ Você ainda pode editar produtos, configurações e visualizar histórico.<br>
                ❌ Não é possível abrir a loja ou receber novos pedidos.<br><br>
                Para regularizar, entre em contato com a administração do Pedrad.
            </div>
            <button class="suspend-popup-btn" onclick="this.closest('.suspend-popup-overlay').remove()">Entendi</button>
        </div>`;
    document.body.appendChild(overlay);
}
