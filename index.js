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
let orderFilter = 'all';
let storeImageData = null;
let knownOrderIds = new Set();

// ==================== NOTIFICATION SYSTEM ====================

let notificationInterval = null;
let pendingAlertOrders = new Set();

function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function beep(frequency, duration, startTime) {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.4, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        }
        
        const now = audioCtx.currentTime;
        beep(600, 0.12, now);
        beep(800, 0.12, now + 0.15);
        beep(1000, 0.2, now + 0.3);
        
    } catch (e) {
        console.log('Erro ao tocar som:', e);
    }
    
    if (navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 300]);
    }
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
    const pendingOrderIds = orders.filter(o => o.status === 'pending').map(o => o.id);
    pendingAlertOrders.forEach(orderId => {
        if (!pendingOrderIds.includes(orderId)) {
            clearOrderAlert(orderId);
        }
    });
}

function showNotificationPopup(orderId, customerName, total) {
    const popup = document.getElementById('notificationPopup');
    const body = document.getElementById('notificationPopupBody');
    body.textContent = `#${orderId.slice(-6).toUpperCase()} - ${customerName} - ${formatCurrency(total)}`;
    popup.classList.add('show');
    popup.dataset.orderId = orderId;
}

function closeNotificationPopup() {
    const popup = document.getElementById('notificationPopup');
    popup.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
    const popup = document.getElementById('notificationPopup');
    if (popup) {
        popup.addEventListener('click', (e) => {
            if (e.target.classList.contains('notification-popup-close')) return;
            const orderId = popup.dataset.orderId;
            if (orderId) {
                showPage('orders');
                setTimeout(() => {
                    const orderEl = document.getElementById(`order-${orderId}`);
                    if (orderEl) {
                        orderEl.classList.add('expanded');
                        orderEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    if (data.orderId) {
        showNotificationPopup(data.orderId, data.customerName || 'Cliente', parseFloat(data.total) || 0);
    }
}

async function requestNotificationPermission() {
    if (!currentStore) {
        showToast('Faça login primeiro');
        return;
    }
    
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
    
    const result = await setupStorePushNotifications(currentStore.id);
    
    if (Notification.permission === 'granted') {
        showToast('🔔 Notificações ativadas!');
    } else {
        showToast('Permissão negada');
    }
    
    updateNotificationButton();
}

function updateNotificationButton() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    
    if (Notification.permission === 'granted') {
        btn.textContent = '🔔';
        btn.title = 'Notificações ativas';
        btn.classList.add('active');
    } else if (Notification.permission === 'denied') {
        btn.textContent = '🔕';
        btn.title = 'Notificações bloqueadas';
    } else {
        btn.textContent = '🔔';
        btn.title = 'Clique para ativar notificações';
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
            if (currentStore && Notification.permission === 'default') {
                requestNotificationPermission();
            }
        }, 1000);
    } catch (err) {
        showToast('Erro: ' + err.message);
    }
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
    openModal('confirmModal');
}

function showAuthPage() {
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    // Desabilita botões até loja carregar
    disableProductButtons();
}

function disableProductButtons() {
    const buttons = document.querySelectorAll('[onclick*="openProductModal"], [onclick*="editProduct"]');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.title = 'Carregando loja...';
    });
}

function enableProductButtons() {
    const buttons = document.querySelectorAll('[onclick*="openProductModal"], [onclick*="editProduct"]');
    buttons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.title = '';
    });
}

// ==================== DATA ====================

async function loadStoreData() {
    try {
        let snapshot = await db.collection('stores').where('ownerEmail', '==', currentUser.email).limit(1).get();
        
        if (snapshot.empty) {
            snapshot = await db.collection('stores').where('ownerId', '==', currentUser.uid).limit(1).get();
        }
        
        if (!snapshot.empty) {
            currentStore = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            
            // SALVA STOREID NO LOCALSTORAGE
            localStorage.setItem('currentStoreId', currentStore.id);
            console.log('✅ StoreId salvo no localStorage:', currentStore.id);
            
            updateStoreUI();
            enableProductButtons(); // Habilita botões quando loja carrega
            console.log('✅ Loja carregada:', currentStore.id);
        }
    } catch (err) {
        console.error('Error loading store:', err);
    }
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
        document.getElementById('storeImageUpload').classList.add('has-image');
        document.getElementById('storeImageUpload').innerHTML = `<img src="${currentStore.imageUrl}" alt="Logo"><input type="file" id="storeImageInput" accept="image/*" onchange="handleStoreImageUpload(event)">`;
    }
    
    selectDeliveryType(currentStore.deliveryType || 'app', false);
}

async function loadAllData() {
    await Promise.all([loadOrders(), loadProducts(), loadCategories()]);
    updateDashboard();
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
        
        renderOrders();
        updatePendingBadge();
    } catch (err) {
        console.error('Error loading orders:', err);
    }
}

async function loadProducts() {
    try {
        const snapshot = await db.collection('products').where('storeId', '==', currentStore.id).get();
        products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name));
        renderProducts();
    } catch (err) {
        console.error('Error loading products:', err);
    }
}

async function loadCategories() {
    // Carrega categorias salvas + extrai dos produtos
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
                        
                        if (Notification.permission === 'granted') {
                            const notif = new Notification('🔔 Novo Pedido!', {
                                body: `#${order.id.slice(-6).toUpperCase()} - ${order.userName || 'Cliente'} - ${formatCurrency(order.total)}`,
                                icon: '/pedeai/icon-192.png',
                                tag: order.id,
                                requireInteraction: true
                            });
                            
                            notif.onclick = () => {
                                window.focus();
                                showPage('orders');
                                setTimeout(() => {
                                    const el = document.getElementById(`order-${order.id}`);
                                    if (el) {
                                        el.classList.add('expanded');
                                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }
                                }, 300);
                                notif.close();
                            };
                        }
                    }
                }
            } else if (change.type === 'modified') {
                const idx = orders.findIndex(o => o.id === order.id);
                if (idx !== -1) {
                    const oldStatus = orders[idx].status;
                    orders[idx] = order;
                    if (oldStatus === 'pending' && order.status !== 'pending') {
                        clearOrderAlert(order.id);
                    }
                }
            } else if (change.type === 'removed') {
                orders = orders.filter(o => o.id !== order.id);
                knownOrderIds.delete(order.id);
                clearOrderAlert(order.id);
            }
        });
        
        checkAndClearAlerts();
        renderOrders();
        updateDashboard();
        updatePendingBadge();
    });
}

// ==================== NAVIGATION ====================

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById(`${page}Page`).classList.add('active');
    document.getElementById('pageTitle').textContent = { dashboard: 'Dashboard', orders: 'Pedidos', products: 'Produtos', categories: 'Categorias', store: 'Minha Loja', settings: 'Configurações' }[page] || page;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.textContent.toLowerCase().includes(page) || (page === 'dashboard' && item.textContent.includes('Dashboard'))) item.classList.add('active');
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

function updateDashboard() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter(o => (o.createdAt?.toDate?.() || new Date(o.createdAt)) >= today);
    
    document.getElementById('statPending').textContent = orders.filter(o => o.status === 'pending').length;
    document.getElementById('statToday').textContent = todayOrders.length;
    document.getElementById('statRevenue').textContent = formatCurrency(todayOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0));
    document.getElementById('statProducts').textContent = products.filter(p => p.active !== false).length;
    
    const container = document.getElementById('recentOrders');
    const recent = orders.slice(0, 5);
    container.innerHTML = recent.length === 0 
        ? '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">Nenhum pedido ainda</div></div>'
        : recent.map(o => renderOrderCard(o, true)).join('');
}

function updatePendingBadge() {
    const pending = orders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'block' : 'none';
}

// ==================== ORDERS ====================

function filterOrders(filter) {
    orderFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    renderOrders();
}

function renderOrders() {
    const filtered = orderFilter === 'all' ? orders : orders.filter(o => o.status === orderFilter);
    const container = document.getElementById('ordersList');
    container.innerHTML = filtered.length === 0 
        ? '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">Nenhum pedido</div></div>'
        : filtered.map(o => renderOrderCard(o)).join('');
}

// Helper para sanitizar adicionais
function sanitizeAddons(addons) {
    if (!Array.isArray(addons)) return [];
    
    return addons
        .filter(a => a && typeof a === 'object')
        .map((a, index) => ({
            name: String(a.name || '').trim(),
            price: parseFloat(a.price) || 0,
            order: typeof a.order === 'number' ? a.order : index
        }))
        .filter(a => a.name);
}

function renderOrderCard(order) {
    const date = order.createdAt?.toDate?.() || new Date(order.createdAt);
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const isPending = order.status === 'pending';
    
    const customerName = order.userName || order.customerName || 'Cliente';
    const customerPhone = order.userPhone || order.phone || '';
    const customerCpf = order.userCpf || order.cpf || '';
    
    const addr = order.address || {};
    const fullAddress = [
        addr.street,
        addr.number ? `nº ${addr.number}` : '',
        addr.complement || '',
        addr.neighborhood || '',
        addr.city || '',
        addr.cep ? `CEP: ${addr.cep}` : ''
    ].filter(Boolean).join(', ');
    const reference = addr.reference || '';
    
    const paymentLabels = {
        pix: '💠 PIX',
        credit: '💳 Crédito',
        debit: '💳 Débito',
        cash: '💵 Dinheiro',
        picpay: '💚 PicPay',
        food_voucher: '🎫 Vale Alimentação'
    };
    const paymentMethod = paymentLabels[order.paymentMethod] || order.paymentMethod || 'Não informado';
    const needChange = order.needChange && order.changeFor ? `Troco para ${formatCurrency(order.changeFor)}` : '';
    
    const deliveryMode = order.deliveryMode === 'pickup' ? '🏃 Retirada no local' : '🛵 Entrega';
    const deliveryFee = order.deliveryFee || 0;
    const subtotal = (order.total || 0) - deliveryFee;
    const notes = order.notes || order.observation || '';
    
    return `<div class="order-card ${isPending ? 'new-order' : ''}">
        <div class="order-header" onclick="toggleOrder('${order.id}')">
            <div>
                <div class="order-id">#${order.id.slice(-6).toUpperCase()}</div>
                <div class="order-time">${dateStr} ${timeStr}</div>
            </div>
            <span class="order-status status-${order.status}">${getStatusLabel(order.status)}</span>
        </div>
        <div class="order-body" id="order-${order.id}">
            <div class="order-section">
                <div class="order-section-title">👤 Cliente</div>
                <div class="order-section-content">
                    <div class="order-detail-row">
                        <span class="order-detail-label">Nome</span>
                        <span class="order-detail-value">${customerName}</span>
                    </div>
                    ${customerPhone ? `
                    <div class="order-detail-row">
                        <span class="order-detail-label">Telefone</span>
                        <a href="tel:${customerPhone}" class="order-detail-value order-phone">${formatPhone(customerPhone)}</a>
                        <a href="https://wa.me/55${customerPhone.replace(/\D/g, '')}" target="_blank" class="btn-whatsapp" title="Abrir WhatsApp">💬</a>
                    </div>
                    ` : ''}
                    ${customerCpf ? `
                    <div class="order-detail-row">
                        <span class="order-detail-label">CPF</span>
                        <span class="order-detail-value">${customerCpf}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="order-section">
                <div class="order-section-title">${deliveryMode}</div>
                <div class="order-section-content">
                    ${order.deliveryMode !== 'pickup' ? `
                    <div class="order-address-full">
                        <div class="order-address-label">${addr.label || 'Endereço'}</div>
                        <div class="order-address-text">${fullAddress || 'Não informado'}</div>
                        ${reference ? `<div class="order-address-ref">📍 Ref: ${reference}</div>` : ''}
                    </div>
                    ` : `
                    <div class="order-pickup-info">Cliente irá retirar no estabelecimento</div>
                    `}
                </div>
            </div>
            
            <div class="order-section">
                <div class="order-section-title">🛒 Itens do Pedido</div>
                <div class="order-items">
                    ${(order.items || []).map(i => {
                        const addons = sanitizeAddons(i.addons || []);
                        const addonTotal = addons.reduce((s, a) => s + (a.price || 0), 0);
                        const itemTotal = (i.price + addonTotal) * i.qty;
                        
                        return `
                        <div class="order-item">
                            <span class="order-item-qty">${i.qty}x</span>
                            <span class="order-item-name">
                                ${i.name}
                                ${addons.length > 0 ? `<small class="order-item-addons">(${addons.map(a => a.name).join(', ')})</small>` : ''}
                                ${i.observation ? `<small class="order-item-obs">Obs: ${i.observation}</small>` : ''}
                            </span>
                            <span class="order-item-price">${formatCurrency(itemTotal)}</span>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
            
            ${notes ? `
            <div class="order-section">
                <div class="order-section-title">📝 Observações</div>
                <div class="order-notes">${notes}</div>
            </div>
            ` : ''}
            
            <div class="order-section">
                <div class="order-section-title">💰 Pagamento</div>
                <div class="order-section-content">
                    <div class="order-detail-row">
                        <span class="order-detail-label">Forma</span>
                        <span class="order-detail-value">${paymentMethod}</span>
                    </div>
                    ${needChange ? `
                    <div class="order-detail-row">
                        <span class="order-detail-label">Troco</span>
                        <span class="order-detail-value">${needChange}</span>
                    </div>
                    ` : ''}
                    <div class="order-totals">
                        <div class="order-total-row">
                            <span>Subtotal</span>
                            <span>${formatCurrency(subtotal)}</span>
                        </div>
                        ${deliveryFee > 0 ? `
                        <div class="order-total-row">
                            <span>Taxa de entrega</span>
                            <span>${formatCurrency(deliveryFee)}</span>
                        </div>
                        ` : ''}
                        <div class="order-total-row total">
                            <span>Total</span>
                            <span>${formatCurrency(order.total)}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="order-actions">${getOrderActions(order)}</div>
        </div>
    </div>`;
}

function formatPhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
        return `(${cleaned.slice(0,2)}) ${cleaned.slice(2,7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0,2)}) ${cleaned.slice(2,6)}-${cleaned.slice(6)}`;
    }
    return phone;
}

function getOrderActions(order) {
    const actions = {
        pending: `<button class="btn btn-success btn-sm" onclick="updateOrderStatus('${order.id}', 'confirmed')">✓ Aceitar</button><button class="btn btn-danger btn-sm" onclick="updateOrderStatus('${order.id}', 'cancelled')">✗ Recusar</button>`,
        confirmed: `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${order.id}', 'preparing')">🍳 Iniciar Preparo</button>`,
        preparing: `<button class="btn btn-warning btn-sm" onclick="updateOrderStatus('${order.id}', 'ready')">✓ Pronto</button>`,
        ready: `<button class="btn btn-success btn-sm" onclick="updateOrderStatus('${order.id}', 'delivering')">🛵 Saiu para Entrega</button>`,
        delivering: `<button class="btn btn-success btn-sm" onclick="updateOrderStatus('${order.id}', 'delivered')">✓ Entregue</button>`
    };
    return actions[order.status] || '';
}

function toggleOrder(orderId) { document.getElementById(`order-${orderId}`).classList.toggle('expanded'); }

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
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-state-icon">🍽️</div><div class="empty-state-title">Nenhum produto</div><button class="btn btn-primary" onclick="openProductModal()">+ Adicionar</button></div>';
        enableProductButtons(); // Habilita botão mesmo sem produtos
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
    
    enableProductButtons(); // Habilita botões de editar
}

function filterProductsList() { renderProducts(); }

// ==================== PRODUCT EDITOR INTEGRATION ====================

function openProductModal() {
    openProductEditor();
}

function editProduct(productId) {
    openProductEditor(productId);
}

function openProductEditor(productId = null) {
    console.log('openProductEditor chamado');
    console.log('currentStore:', currentStore);
    console.log('productId:', productId);
    
    if (!currentStore) {
        showToast('❌ Loja não carregada. Aguarde...');
        console.error('currentStore está undefined');
        return;
    }

    if (!currentStore.id) {
        showToast('❌ ID da loja não encontrado');
        console.error('currentStore.id está undefined');
        return;
    }

    const url = productId 
        ? `product-editor.html?storeId=${currentStore.id}&productId=${productId}`
        : `product-editor.html?storeId=${currentStore.id}`;

    console.log('Abrindo URL:', url);

    const width = 900;
    const height = 800;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;

    window.open(
        url,
        'ProductEditor',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
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
    try { 
        await db.collection('products').doc(productId).delete(); 
        await loadProducts(); 
        showToast('Excluído'); 
    } catch (err) { 
        showToast('Erro'); 
    }
}

// ==================== CATEGORIES ====================

function renderCategories() {
    const container = document.getElementById('categoriesList');
    container.innerHTML = categories.length === 0 
        ? '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-title">Nenhuma categoria</div></div>'
        : categories.map(c => `<div class="card" style="display: flex; justify-content: space-between; align-items: center;"><div><strong>${c}</strong><div style="color: var(--text-muted); font-size: 0.9rem;">${products.filter(p => p.category === c).length} produtos</div></div><button class="btn btn-danger btn-sm" onclick="confirmDeleteCategory('${c}')">🗑️</button></div>`).join('');
}

function openCategoryModal() { document.getElementById('categoryName').value = ''; openModal('categoryModal'); }

async function saveCategory() {
    const name = document.getElementById('categoryName').value.trim();
    if (!name) { showToast('Digite o nome'); return; }
    if (categories.includes(name)) { showToast('Já existe'); return; }
    
    categories.push(name);
    
    // Salva no Firestore
    await db.collection('stores').doc(currentStore.id).update({ 
        categories: categories 
    });
    currentStore.categories = categories;
    
    renderCategories();
    closeModal('categoryModal');
    showToast('Criada');
}

function confirmDeleteCategory(cat) {
    const count = products.filter(p => p.category === cat).length;
    if (count > 0) { 
        showToast(`Remova ${count} produtos primeiro`); 
        return; 
    }
    showConfirmModal('Excluir categoria?', `"${cat}" será removida.`, () => deleteCategory(cat), 'Excluir');
}

async function deleteCategory(cat) {
    categories = categories.filter(c => c !== cat);
    
    // Salva no Firestore
    await db.collection('stores').doc(currentStore.id).update({ 
        categories: categories 
    });
    currentStore.categories = categories;
    
    renderCategories();
    showToast('Removida');
}

// ==================== STORE ====================

async function handleStoreImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    storeImageData = await compressImageSquare(file, 400, 0.8);
    document.getElementById('storeImageUpload').classList.add('has-image');
    document.getElementById('storeImageUpload').innerHTML = `<img src="${storeImageData}"><input type="file" id="storeImageInput" accept="image/*" onchange="handleStoreImageUpload(event)">`;
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
        
        if (storeImageData?.startsWith('data:')) {
            data.imageUrl = storeImageData;
        }
        
        await db.collection('stores').doc(currentStore.id).update(data);
        currentStore = { ...currentStore, ...data };
        updateStoreUI();
        showToast('Salvo!');
    } catch (err) { console.error(err); showToast('Erro'); }
}

async function toggleStoreStatus() {
    const newStatus = currentStore.open === false;
    try {
        await db.collection('stores').doc(currentStore.id).update({ open: newStatus });
        currentStore.open = newStatus;
        updateStoreUI();
        showToast(newStatus ? 'Aberta!' : 'Fechada!');
    } catch (err) { showToast('Erro'); }
}

// ==================== SETTINGS ====================

function selectDeliveryType(type, save = true) {
    ['deliveryApp', 'deliveryOwn', 'deliveryBoth'].forEach(id => document.getElementById(id).classList.remove('selected'));
    document.getElementById(type === 'app' ? 'deliveryApp' : type === 'own' ? 'deliveryOwn' : 'deliveryBoth').classList.add('selected');
    if (save) currentStore.deliveryType = type;
}

function toggleSetting(setting) { document.getElementById(`${setting}Toggle`).classList.toggle('active'); }

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
                canvas.width = finalSize;
                canvas.height = finalSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, cropX, cropY, srcSize, srcSize, 0, 0, finalSize, finalSize);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
function getStatusLabel(s) { return { pending: 'Pendente', confirmed: 'Confirmado', preparing: 'Preparando', ready: 'Pronto', delivering: 'Em entrega', delivered: 'Entregue', cancelled: 'Cancelado' }[s] || s; }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); }));
});

function openProductsPage() {
  const url = new URL(window.location.href);

  const storeId =
    url.searchParams.get("storeId") ||
    window.currentStoreId ||
    localStorage.getItem("currentStoreId") ||
    localStorage.getItem("CURRENT_STORE_ID") ||
    localStorage.getItem("storeId") ||
    localStorage.getItem("STORE_ID") ||
    null;

  if (!storeId) {
    showToast("❌ StoreId não encontrado.");
    return;
  }

  // garante que salva o certo pro resto do sistema
  localStorage.setItem("currentStoreId", storeId);

  window.location.href = `feed.html?storeId=${encodeURIComponent(storeId)}`;
}


