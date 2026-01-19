// ==================== FIXES MODULE ====================
// Correções para: categorias, pedidos, telefone, etc.

(function() {
    'use strict';

    // ===== FIX: Busca telefone do usuário se não estiver no pedido =====
    window.fetchUserPhone = async function(userId) {
        if (!userId) {
            console.log('fetchUserPhone: userId não fornecido');
            return null;
        }
        
        // Verifica se db existe
        if (typeof db === 'undefined') {
            console.log('fetchUserPhone: db não disponível');
            return null;
        }
        
        try {
            console.log('fetchUserPhone: buscando para userId:', userId);
            const doc = await db.collection('users').doc(userId).get();
            if (doc.exists) {
                const phone = doc.data()?.phone || null;
                console.log('fetchUserPhone: telefone encontrado:', phone);
                return phone;
            } else {
                console.log('fetchUserPhone: documento não existe para userId:', userId);
            }
        } catch (err) {
            console.error('fetchUserPhone: erro:', err);
        }
        return null;
    };

    // ===== FIX: Categorias com contagem correta =====
    window.renderCategoriesFixed = function() {
        if (!window.categories || !window.products) return;
        
        const container = document.getElementById('categoriesList');
        if (!container) return;
        
        if (categories.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📁</div>
                    <div class="empty-state-title">Nenhuma categoria</div>
                </div>`;
            return;
        }
        
        container.innerHTML = categories.map(c => {
            // Conta produtos com essa categoria (case-insensitive)
            const count = products.filter(p => 
                (p.category || '').toLowerCase().trim() === c.toLowerCase().trim()
            ).length;
            
            return `
                <div class="card" style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${escapeHtml(c)}</strong>
                        <div style="color:var(--text-muted);font-size:0.9rem;">
                            ${count} produto${count !== 1 ? 's' : ''}
                        </div>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="confirmDeleteCategory('${escapeHtml(c)}')">🗑️</button>
                </div>`;
        }).join('');
    };

    // Sobrescreve a função original
    if (typeof window.renderCategories === 'function') {
        window._originalRenderCategories = window.renderCategories;
        window.renderCategories = window.renderCategoriesFixed;
    }

    // ===== FIX: Pedido com nome como título e telefone após aceitar =====
    // Cache de telefones para evitar múltiplas buscas
    const phoneCache = {};

    // Função para atualizar telefone no DOM
    function updatePhoneInDOM(orderId, phone) {
        const phoneEl = document.getElementById(`phone-${orderId}`);
        if (phoneEl && phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            phoneEl.innerHTML = `
                <span class="order-detail-label">Telefone</span>
                <a href="tel:${phone}" class="order-detail-value order-phone">${formatPhone(phone)}</a>
                <a href="https://wa.me/55${cleanPhone}" target="_blank" class="btn-whatsapp" title="WhatsApp">💬</a>
            `;
        }
    }

    // Busca telefone e atualiza DOM (chamada após render)
    async function loadPhoneForOrder(order) {
        if (!order.userId) return;
        
        // Verifica cache
        if (phoneCache[order.userId]) {
            updatePhoneInDOM(order.id, phoneCache[order.userId]);
            return;
        }
        
        // Busca do Firestore
        const phone = await fetchUserPhone(order.userId);
        if (phone) {
            phoneCache[order.userId] = phone;
            updatePhoneInDOM(order.id, phone);
        } else {
            // Sem telefone cadastrado
            const phoneEl = document.getElementById(`phone-${order.id}`);
            if (phoneEl) {
                phoneEl.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem;">📱 Telefone não cadastrado</span>`;
            }
        }
    }

    window.renderOrderCardFixed = function(order) {
        const date = order.createdAt?.toDate?.() || new Date(order.createdAt);
        const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const isPending = order.status === 'pending';
        const isAccepted = ['confirmed', 'preparing', 'ready', 'delivering', 'delivered'].includes(order.status);
        
        const customerName = order.userName || order.customerName || 'Cliente';
        let customerPhone = order.userPhone || order.phone || '';
        const customerCpf = order.userCpf || order.cpf || '';
        const orderId = order.id.slice(-6).toUpperCase();

        // Se pedido aceito, agenda busca do telefone após render
        if (isAccepted && !customerPhone && order.userId) {
            // Usa cache se disponível
            if (phoneCache[order.userId]) {
                customerPhone = phoneCache[order.userId];
            } else {
                // Agenda busca para após o DOM ser atualizado
                setTimeout(() => loadPhoneForOrder(order), 100);
            }
        }
        
        const addr = order.address || {};
        const fullAddress = [
            addr.street,
            addr.number ? `nº ${addr.number}` : '',
            addr.complement || '',
            addr.neighborhood || '',
        ].filter(Boolean).join(', ');
        const reference = addr.reference || '';
        
        const paymentLabels = {
            pix: '💠 PIX', credit: '💳 Crédito', debit: '💳 Débito',
            cash: '💵 Dinheiro', picpay: '💚 PicPay', food_voucher: '🎫 Vale Alimentação'
        };
        const paymentMethod = paymentLabels[order.paymentMethod] || order.paymentMethod || 'Não informado';
        const needChange = order.needChange && order.changeFor ? `Troco para ${formatCurrency(order.changeFor)}` : '';
        const deliveryMode = order.deliveryMode === 'pickup' ? '🏃 Retirada' : '🛵 Entrega';
        const deliveryFee = order.deliveryFee || 0;
        const subtotal = (order.total || 0) - deliveryFee;
        const notes = order.notes || order.observation || '';

        // Helper para sanitizar adicionais
        const sanitizeAddons = (addons) => {
            if (!Array.isArray(addons)) return [];
            return addons.filter(a => a && typeof a === 'object')
                .map((a, i) => ({ name: String(a.name || '').trim(), price: parseFloat(a.price) || 0 }))
                .filter(a => a.name);
        };

        return `
        <div class="order-card ${isPending ? 'new-order' : ''}">
            <div class="order-header" onclick="toggleOrder('${order.id}')">
                <div>
                    <!-- NOME como título principal -->
                    <div class="order-customer-name" style="font-weight:600;font-size:1.05rem;">${escapeHtml(customerName)}</div>
                    <div class="order-meta" style="display:flex;gap:12px;color:var(--text-muted);font-size:0.8rem;margin-top:4px;">
                        <span>#${orderId}</span>
                        <span>${dateStr} ${timeStr}</span>
                        <span>${deliveryMode}</span>
                    </div>
                </div>
                <span class="order-status status-${order.status}">${getStatusLabel(order.status)}</span>
            </div>
            <div class="order-body" id="order-${order.id}">
                ${isAccepted ? `
                <div class="order-section">
                    <div class="order-section-title">👤 Cliente</div>
                    <div class="order-section-content">
                        <div class="order-detail-row">
                            <span class="order-detail-label">Nome</span>
                            <span class="order-detail-value">${escapeHtml(customerName)}</span>
                        </div>
                        <div class="order-detail-row" id="phone-${order.id}">
                            ${customerPhone ? `
                            <span class="order-detail-label">Telefone</span>
                            <a href="tel:${customerPhone}" class="order-detail-value order-phone">${formatPhone(customerPhone)}</a>
                            <a href="https://wa.me/55${customerPhone.replace(/\D/g, '')}" target="_blank" class="btn-whatsapp" title="WhatsApp">💬</a>
                            ` : `<span style="color:var(--text-muted);font-size:0.85rem;">⏳ Carregando telefone...</span>`}
                        </div>
                        ${customerCpf ? `
                        <div class="order-detail-row">
                            <span class="order-detail-label">CPF</span>
                            <span class="order-detail-value">${customerCpf}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : `
                <div class="order-section">
                    <div class="order-section-title">👤 Cliente</div>
                    <div class="order-section-content" style="color:var(--text-muted);font-size:0.85rem;">
                        📱 Telefone disponível após aceitar o pedido
                    </div>
                </div>
                `}
                
                <div class="order-section">
                    <div class="order-section-title">${deliveryMode === '🏃 Retirada' ? '🏪 Retirada' : '📍 Endereço'}</div>
                    <div class="order-section-content">
                        ${order.deliveryMode !== 'pickup' && fullAddress ? `
                        <div class="order-address-text">${escapeHtml(fullAddress)}</div>
                        ${reference ? `<div class="order-address-ref" style="color:var(--text-muted);font-size:0.85rem;margin-top:4px;">📍 ${escapeHtml(reference)}</div>` : ''}
                        ` : `<div style="color:var(--text-muted);">Cliente retira no local</div>`}
                    </div>
                </div>
                
                <div class="order-section">
                    <div class="order-section-title">🛒 Itens</div>
                    <div class="order-items">
                        ${(order.items || []).map(i => {
                            const addons = sanitizeAddons(i.addons || []);
                            const addonTotal = addons.reduce((s, a) => s + (a.price || 0), 0);
                            const itemTotal = (i.price + addonTotal) * i.qty;
                            return `
                            <div class="order-item">
                                <span class="order-item-qty">${i.qty}x</span>
                                <span class="order-item-name">
                                    ${escapeHtml(i.name)}
                                    ${addons.length > 0 ? `<small class="order-item-addons">(${addons.map(a => a.name).join(', ')})</small>` : ''}
                                    ${i.observation ? `<small class="order-item-obs">Obs: ${escapeHtml(i.observation)}</small>` : ''}
                                </span>
                                <span class="order-item-price">${formatCurrency(itemTotal)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
                
                ${notes ? `
                <div class="order-section">
                    <div class="order-section-title">📝 Observações</div>
                    <div class="order-notes">${escapeHtml(notes)}</div>
                </div>
                ` : ''}
                
                <div class="order-section">
                    <div class="order-section-title">💰 Pagamento</div>
                    <div class="order-totals">
                        <div class="order-total-row"><span>Forma</span><span>${paymentMethod}</span></div>
                        ${needChange ? `<div class="order-total-row"><span>Troco</span><span>${needChange}</span></div>` : ''}
                        <div class="order-total-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
                        ${deliveryFee > 0 ? `<div class="order-total-row"><span>Entrega</span><span>${formatCurrency(deliveryFee)}</span></div>` : ''}
                        <div class="order-total-row total"><span>Total</span><span>${formatCurrency(order.total)}</span></div>
                    </div>
                </div>
                
                <div class="order-actions">${getOrderActions(order)}</div>
            </div>
        </div>`;
    };

    // Sobrescreve renderOrderCard se existir, ou aguarda
    function patchRenderOrderCard() {
        if (typeof window.renderOrderCard === 'function' && window.renderOrderCard !== window.renderOrderCardFixed) {
            window._originalRenderOrderCard = window.renderOrderCard;
            window.renderOrderCard = window.renderOrderCardFixed;
            console.log('✅ renderOrderCard substituído');
        } else if (!window._originalRenderOrderCard) {
            // Aguarda a função original ser definida
            setTimeout(patchRenderOrderCard, 200);
        }
    }
    
    // Inicia tentativa de patch
    patchRenderOrderCard();
    
    // Também expõe para uso direto
    window.renderOrderCardFixed = window.renderOrderCardFixed;

    // ===== Helper: escapeHtml =====
    window.escapeHtml = window.escapeHtml || function(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // ===== Helper: formatPhone =====
    window.formatPhone = window.formatPhone || function(phone) {
        if (!phone) return '';
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11) return `(${cleaned.slice(0,2)}) ${cleaned.slice(2,7)}-${cleaned.slice(7)}`;
        if (cleaned.length === 10) return `(${cleaned.slice(0,2)}) ${cleaned.slice(2,6)}-${cleaned.slice(6)}`;
        return phone;
    };

    console.log('✅ Fixes module loaded');
})();