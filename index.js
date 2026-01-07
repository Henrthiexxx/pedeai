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
let selectedEmoji = '🍔';
let productImageData = null;
let storeImageData = null;
let productAddons = [];
let knownOrderIds = new Set(); // Para não notificar pedidos já carregados
let notificationAudio = null;

const foodEmojis = ['🍔', '🍕', '🍟', '🌭', '🍗', '🥓', '🍖', '🥩', '🍝', '🍜', '🍲', '🥗', '🌮', '🌯', '🥙', '🧆', '🍣', '🍤', '🍱', '🥡', '🍚', '🍛', '🍙', '🥟', '🍰', '🎂', '🍮', '🍩', '🍪', '🍫', '🍬', '🍭', '🍦', '🍨', '🍧', '🥤', '🧃', '🍺', '🍷', '☕', '🧋', '🥛', '💧', '🍇', '🍉', '🍊', '🍋', '🍌', '🍎', '🍒', '🥑', '🥕', '🌽', '🥔', '🧀', '🥚', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇'];

// ==================== NOTIFICATION SYSTEM ====================

function initNotificationAudio() {
    // Cria áudio de notificação (som embutido base64)
    notificationAudio = new Audio('data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4T/////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQZB8P8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV');
    notificationAudio.volume = 0.7;
}

function playNotificationSound() {
    try {
        // Tenta tocar arquivo externo primeiro
        const audio = new Audio('notification.mp3');
        audio.volume = 0.8;
        audio.play().catch(() => {
            // Fallback para som embutido
            if (notificationAudio) {
                notificationAudio.currentTime = 0;
                notificationAudio.play().catch(() => {});
            }
        });
    } catch (e) {
        // Fallback
        if (notificationAudio) {
            notificationAudio.currentTime = 0;
            notificationAudio.play().catch(() => {});
        }
    }
    
    // Vibração
    if (navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 300]);
    }
}

function showNotificationPopup(orderId, customerName, total) {
    const popup = document.getElementById('notificationPopup');
    const body = document.getElementById('notificationPopupBody');
    
    body.textContent = `#${orderId.slice(-6).toUpperCase()} - ${customerName} - ${formatCurrency(total)}`;
    
    popup.classList.add('show');
    popup.dataset.orderId = orderId;
    
    // Auto-hide após 15 segundos
    setTimeout(() => {
        closeNotificationPopup();
    }, 15000);
}

function closeNotificationPopup() {
    const popup = document.getElementById('notificationPopup');
    popup.classList.remove('show');
}

// Clique no popup leva ao pedido
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

// Função chamada pelo FCM quando chega notificação
function handleNewOrderNotification(data, message) {
    playNotificationSound();
    showToast('🔔 ' + (message || 'Novo pedido recebido!'));
    
    if (data.orderId) {
        showNotificationPopup(data.orderId, data.customerName || 'Cliente', parseFloat(data.total) || 0);
    }
}

// Solicitar permissão de notificação (chamado por botão)
async function requestNotificationPermission() {
    if (!currentStore) {
        showToast('Faça login primeiro');
        return;
    }
    
    if (Notification.permission === 'granted') {
        showToast('Notificações já ativas!');
        // Tenta registrar token mesmo assim
        await setupStorePushNotifications(currentStore.id);
        updateNotificationButton();
        return;
    }
    
    if (Notification.permission === 'denied') {
        showToast('Notificações bloqueadas. Libere nas configurações do navegador.');
        return;
    }
    
    // Solicita permissão
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
            initNotificationAudio();
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
        // Após login bem-sucedido, solicita permissão de notificação
        // Isso é feito APÓS interação do usuário (submit do form)
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
    initEmojiPicker();
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
            updateStoreUI();
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
        
        // Marca pedidos existentes como conhecidos (não notificar na carga inicial)
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
    categories = [...new Set(products.map(p => p.category).filter(Boolean))];
    renderCategories();
    updateCategorySelect();
}

// ==================== REAL-TIME ====================

function setupRealtimeListeners() {
    db.collection('orders').where('storeId', '==', currentStore.id).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const order = { id: change.doc.id, ...change.doc.data() };
            
            if (change.type === 'added') {
                // Verifica se é pedido novo (não estava na lista)
                const isNew = !knownOrderIds.has(order.id);
                
                if (isNew) {
                    knownOrderIds.add(order.id);
                    orders.unshift(order);
                    
                    // Notifica apenas pedidos pendentes (novos)
                    if (order.status === 'pending') {
                        // Notificação local
                        playNotificationSound();
                        showNotificationPopup(order.id, order.userName || 'Cliente', order.total || 0);
                        showToast('🔔 Novo pedido recebido!');
                        
                        // Notificação do sistema (se permitido)
                        if (Notification.permission === 'granted') {
                            const notif = new Notification('🔔 Novo Pedido!', {
                                body: `#${order.id.slice(-6).toUpperCase()} - ${order.userName || 'Cliente'} - ${formatCurrency(order.total)}`,
                                icon: '/icon-192.png',
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
                if (idx !== -1) orders[idx] = order;
            } else if (change.type === 'removed') {
                orders = orders.filter(o => o.id !== order.id);
                knownOrderIds.delete(order.id);
            }
        });
        
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

function renderOrderCard(order) {
    const date = order.createdAt?.toDate?.() || new Date(order.createdAt);
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const isPending = order.status === 'pending';
    
    return `<div class="order-card ${isPending ? 'new-order' : ''}">
        <div class="order-header" onclick="toggleOrder('${order.id}')">
            <div><div class="order-id">#${order.id.slice(-6).toUpperCase()}</div><div class="order-time">${timeStr} - ${order.userName || 'Cliente'}</div></div>
            <span class="order-status status-${order.status}">${getStatusLabel(order.status)}</span>
        </div>
        <div class="order-body" id="order-${order.id}">
            <div class="order-items">
                ${order.items.map(i => `
                    <div class="order-item">
                        <span>${i.qty}x ${i.name}${i.addons?.length ? ` <small style="color:var(--text-muted);">(${i.addons.map(a => a.name).join(', ')})</small>` : ''}</span>
                        <span>${formatCurrency((i.price + (i.addons?.reduce((s,a) => s + a.price, 0) || 0)) * i.qty)}</span>
                    </div>
                `).join('')}
                <div class="order-item" style="font-weight: 600;"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
            </div>
            <div class="order-customer"><div class="order-customer-name">📍 ${order.address?.label || 'Endereço'}</div><div class="order-customer-address">${order.address?.street}, ${order.address?.number} - ${order.address?.neighborhood}</div></div>
            <div class="order-actions">${getOrderActions(order)}</div>
        </div>
    </div>`;
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

function initEmojiPicker() {
    document.getElementById('emojiPicker').innerHTML = foodEmojis.map(e => `<div class="emoji-item ${e === selectedEmoji ? 'selected' : ''}" onclick="selectEmoji('${e}')">${e}</div>`).join('');
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    document.querySelectorAll('.emoji-item').forEach(el => el.classList.toggle('selected', el.textContent === emoji));
    productImageData = null;
    document.getElementById('productImageUpload').classList.remove('has-image');
    document.getElementById('productImagePlaceholder').innerHTML = `<span>📷</span><div>Clique para enviar (quadrada)</div>`;
}

// ==================== ADDONS ====================

function renderAddons() {
    const container = document.getElementById('addonsList');
    if (productAddons.length === 0) {
        container.innerHTML = '<div class="addon-empty">Nenhum adicional cadastrado</div>';
        return;
    }
    container.innerHTML = productAddons.map((addon, idx) => `
        <div class="addon-item" draggable="true" ondragstart="dragAddon(event, ${idx})" ondragover="event.preventDefault()" ondrop="dropAddon(event, ${idx})">
            <span class="addon-drag">⋮⋮</span>
            <input type="text" class="form-input addon-name" value="${addon.name}" onchange="updateAddon(${idx}, 'name', this.value)">
            <input type="number" class="form-input addon-price" value="${addon.price}" step="0.50" onchange="updateAddon(${idx}, 'price', parseFloat(this.value) || 0)">
            <button type="button" class="btn btn-danger btn-sm" onclick="removeAddon(${idx})">×</button>
        </div>
    `).join('');
}

function addAddon() {
    const nameInput = document.getElementById('newAddonName');
    const priceInput = document.getElementById('newAddonPrice');
    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value) || 0;
    
    if (!name) { showToast('Digite o nome do adicional'); return; }
    
    productAddons.push({ name, price, order: productAddons.length });
    nameInput.value = '';
    priceInput.value = '';
    renderAddons();
}

function updateAddon(idx, field, value) {
    productAddons[idx][field] = value;
}

function removeAddon(idx) {
    productAddons.splice(idx, 1);
    productAddons.forEach((a, i) => a.order = i);
    renderAddons();
}

let draggedAddonIdx = null;
function dragAddon(e, idx) { draggedAddonIdx = idx; }
function dropAddon(e, targetIdx) {
    e.preventDefault();
    if (draggedAddonIdx === null || draggedAddonIdx === targetIdx) return;
    const [item] = productAddons.splice(draggedAddonIdx, 1);
    productAddons.splice(targetIdx, 0, item);
    productAddons.forEach((a, i) => a.order = i);
    renderAddons();
    draggedAddonIdx = null;
}

// ==================== PRODUCT MODAL ====================

function openProductModal() {
    document.getElementById('productId').value = '';
    document.getElementById('productName').value = '';
    document.getElementById('productDescription').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productCategory').value = categories[0] || '';
    document.getElementById('productActiveToggle').classList.add('active');
    document.getElementById('productModalTitle').textContent = 'Novo Produto';
    productImageData = null;
    document.getElementById('productImageUpload').classList.remove('has-image');
    document.getElementById('productImagePlaceholder').innerHTML = `<span>📷</span><div>Clique para enviar (quadrada)</div>`;
    selectedEmoji = '🍔';
    productAddons = [];
    initEmojiPicker();
    renderAddons();
    openModal('productModal');
}

function editProduct(productId) {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    
    document.getElementById('productId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productDescription').value = p.description || '';
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productCategory').value = p.category || '';
    document.getElementById('productModalTitle').textContent = 'Editar Produto';
    document.getElementById('productActiveToggle').classList.toggle('active', p.active !== false);
    
    if (p.imageUrl) {
        document.getElementById('productImageUpload').classList.add('has-image');
        document.getElementById('productImageUpload').innerHTML = `<img src="${p.imageUrl}"><input type="file" id="productImageInput" accept="image/*" onchange="handleProductImageUpload(event)">`;
    } else {
        document.getElementById('productImageUpload').classList.remove('has-image');
        document.getElementById('productImagePlaceholder').innerHTML = `<span>📷</span><div>Clique para enviar (quadrada)</div>`;
    }
    
    selectedEmoji = p.emoji || '🍔';
    productAddons = (p.addons || []).map((a, i) => ({ ...a, order: a.order ?? i }));
    productAddons.sort((a, b) => a.order - b.order);
    initEmojiPicker();
    renderAddons();
    openModal('productModal');
}

async function handleProductImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    productImageData = await compressImageSquare(file, 480, 0.75);
    document.getElementById('productImageUpload').classList.add('has-image');
    document.getElementById('productImageUpload').innerHTML = `<img src="${productImageData}"><input type="file" id="productImageInput" accept="image/*" onchange="handleProductImageUpload(event)">`;
}

async function saveProduct() {
    const id = document.getElementById('productId').value;
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    
    if (!name || !price) { showToast('Preencha nome e preço'); return; }
    
    try {
        const data = {
            name,
            description: document.getElementById('productDescription').value.trim(),
            price,
            category: document.getElementById('productCategory').value,
            active: document.getElementById('productActiveToggle').classList.contains('active'),
            emoji: selectedEmoji,
            addons: productAddons.map((a, i) => ({ name: a.name, price: a.price, order: i })),
            storeId: currentStore.id,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (productImageData?.startsWith('data:')) {
            data.imageUrl = productImageData;
        }
        
        if (id) {
            await db.collection('products').doc(id).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('products').add(data);
        }
        
        closeModal('productModal');
        await loadProducts();
        loadCategories();
        showToast('Produto salvo!');
    } catch (err) { console.error(err); showToast('Erro ao salvar'); }
}

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

function updateCategorySelect() {
    document.getElementById('productCategory').innerHTML = categories.length > 0 
        ? categories.map(c => `<option value="${c}">${c}</option>`).join('')
        : '<option value="">Adicione categoria primeiro</option>';
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
    renderCategories();
    updateCategorySelect();
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
    renderCategories();
    updateCategorySelect();
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
