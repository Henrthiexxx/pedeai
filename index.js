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
const storage = firebase.storage();

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

const foodEmojis = ['🍔', '🍕', '🍟', '🌭', '🍗', '🥓', '🍖', '🥩', '🍝', '🍜', '🍲', '🥗', '🌮', '🌯', '🥙', '🧆', '🍣', '🍤', '🍱', '🥡', '🍚', '🍛', '🍙', '🥟', '🍰', '🎂', '🍮', '🍩', '🍪', '🍫', '🍬', '🍭', '🍦', '🍨', '🍧', '🥤', '🧃', '🍺', '🍷', '☕', '🧋', '🥛', '💧', '🍇', '🍉', '🍊', '🍋', '🍌', '🍎', '🍒', '🥑', '🥕', '🌽', '🥔', '🧀', '🥚', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇'];

// ==================== AUTH ====================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        await loadStoreData();
        if (currentStore) {
            showMainApp();
            await loadAllData();
            setupRealtimeListeners();
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
    } catch (err) {
        showToast('Erro: ' + err.message);
    }
}

function handleLogout() {
    if (confirm('Deseja sair?')) auth.signOut();
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
                if (!orders.find(o => o.id === order.id)) {
                    orders.unshift(order);
                    if (order.status === 'pending') {
                        playNotificationSound();
                        showToast('🔔 Novo pedido recebido!');
                    }
                }
            } else if (change.type === 'modified') {
                const idx = orders.findIndex(o => o.id === order.id);
                if (idx !== -1) orders[idx] = order;
            }
        });
        renderOrders();
        updateDashboard();
        updatePendingBadge();
    });
}

function playNotificationSound() {
    try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkpqWko+C').play().catch(() => {}); } catch (e) {}
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
    
    return `<div class="order-card">
        <div class="order-header" onclick="toggleOrder('${order.id}')">
            <div><div class="order-id">#${order.id.slice(-6).toUpperCase()}</div><div class="order-time">${timeStr} - ${order.userName || 'Cliente'}</div></div>
            <span class="order-status status-${order.status}">${getStatusLabel(order.status)}</span>
        </div>
        <div class="order-body" id="order-${order.id}">
            <div class="order-items">
                ${order.items.map(i => `<div class="order-item"><span>${i.qty}x ${i.name}</span><span>${formatCurrency(i.price * i.qty)}</span></div>`).join('')}
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
            <div class="product-category">${p.category || 'Sem categoria'}</div>
            <div class="product-price">${formatCurrency(p.price)}</div>
            <div class="product-actions"><button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">🗑️</button></div>
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
    document.getElementById('productImagePlaceholder').innerHTML = `<span>📷</span><div>Clique para enviar</div>`;
}

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
    document.getElementById('productImagePlaceholder').innerHTML = `<span>📷</span><div>Clique para enviar</div>`;
    selectedEmoji = '🍔';
    initEmojiPicker();
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
    }
    
    selectedEmoji = p.emoji || '🍔';
    initEmojiPicker();
    openModal('productModal');
}

async function handleProductImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    productImageData = await compressImage(file, 800, 0.7);
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
            storeId: currentStore.id,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (productImageData?.startsWith('data:')) data.imageUrl = productImageData;
        
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

async function deleteProduct(productId) {
    if (!confirm('Excluir?')) return;
    try { await db.collection('products').doc(productId).delete(); await loadProducts(); showToast('Excluído'); } catch (err) { showToast('Erro'); }
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
        : categories.map(c => `<div class="card" style="display: flex; justify-content: space-between; align-items: center;"><div><strong>${c}</strong><div style="color: var(--text-muted); font-size: 0.9rem;">${products.filter(p => p.category === c).length} produtos</div></div><button class="btn btn-danger btn-sm" onclick="deleteCategory('${c}')">🗑️</button></div>`).join('');
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

async function deleteCategory(cat) {
    const count = products.filter(p => p.category === cat).length;
    if (count > 0) { showToast(`Remova ${count} produtos primeiro`); return; }
    categories = categories.filter(c => c !== cat);
    renderCategories();
    updateCategorySelect();
    showToast('Removida');
}

// ==================== STORE ====================

async function handleStoreImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    storeImageData = await compressImage(file, 400, 0.8);
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
        if (storeImageData?.startsWith('data:')) data.imageUrl = storeImageData;
        
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

function compressImage(file, maxWidth, quality) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
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