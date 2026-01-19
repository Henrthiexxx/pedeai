// ==================== BILLING SUMMARY SYSTEM ====================
// Cria resumos mensais de faturamento e limpa pedidos antigos (>60 dias)

const BillingSystem = {
    RETENTION_DAYS: 60,
    SUMMARY_COLLECTION: 'billing_summaries',

    // Gera resumo mensal
    async generateMonthlySummary(storeId, year, month) {
        if (!storeId || !db) return null;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);

        try {
            const snapshot = await db.collection('orders')
                .where('storeId', '==', storeId)
                .where('createdAt', '>=', startDate)
                .where('createdAt', '<=', endDate)
                .get();

            const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            
            const summary = {
                storeId,
                year,
                month,
                period: `${year}-${String(month).padStart(2, '0')}`,
                generatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                
                // Totais
                totalOrders: orders.length,
                totalRevenue: 0,
                totalDeliveryFees: 0,
                totalCancelled: 0,
                
                // Por status
                byStatus: {
                    pending: 0, confirmed: 0, preparing: 0,
                    ready: 0, delivering: 0, delivered: 0, cancelled: 0
                },
                
                // Por método de pagamento
                byPayment: {},
                
                // Por dia da semana
                byDayOfWeek: [0, 0, 0, 0, 0, 0, 0],
                
                // Produtos mais vendidos (top 10)
                topProducts: [],
                
                // Métricas
                avgOrderValue: 0,
                avgDeliveryTime: 0
            };

            const productCount = {};
            let deliveryTimeTotal = 0;
            let deliveryTimeCount = 0;

            orders.forEach(order => {
                const status = order.status || 'pending';
                summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

                if (status === 'cancelled') {
                    summary.totalCancelled++;
                } else {
                    summary.totalRevenue += (order.total || 0);
                    summary.totalDeliveryFees += (order.deliveryFee || 0);
                }

                // Pagamento
                const payment = order.paymentMethod || 'outros';
                summary.byPayment[payment] = (summary.byPayment[payment] || 0) + 1;

                // Dia da semana
                const orderDate = order.createdAt?.toDate?.() || new Date(order.createdAt);
                summary.byDayOfWeek[orderDate.getDay()]++;

                // Produtos vendidos
                (order.items || []).forEach(item => {
                    const key = item.name || item.productId;
                    if (key) {
                        productCount[key] = (productCount[key] || 0) + item.qty;
                    }
                });

                // Tempo de entrega (se tiver timeline)
                if (order.timeline && status === 'delivered') {
                    const start = order.timeline.find(t => t.status === 'confirmed');
                    const end = order.timeline.find(t => t.status === 'delivered');
                    if (start && end) {
                        const diff = new Date(end.timestamp) - new Date(start.timestamp);
                        deliveryTimeTotal += diff;
                        deliveryTimeCount++;
                    }
                }
            });

            // Calcula médias
            const validOrders = orders.filter(o => o.status !== 'cancelled').length;
            summary.avgOrderValue = validOrders > 0 ? summary.totalRevenue / validOrders : 0;
            summary.avgDeliveryTime = deliveryTimeCount > 0 
                ? Math.round(deliveryTimeTotal / deliveryTimeCount / 60000) 
                : 0;

            // Top produtos
            summary.topProducts = Object.entries(productCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, qty]) => ({ name, qty }));

            // Salva no Firestore
            const docId = `${storeId}_${summary.period}`;
            await db.collection(this.SUMMARY_COLLECTION).doc(docId).set(summary);

            console.log(`✅ Resumo ${summary.period} gerado para loja ${storeId}`);
            return summary;

        } catch (err) {
            console.error('Erro ao gerar resumo:', err);
            return null;
        }
    },

    // Busca resumo existente
    async getSummary(storeId, year, month) {
        const docId = `${storeId}_${year}-${String(month).padStart(2, '0')}`;
        try {
            const doc = await db.collection(this.SUMMARY_COLLECTION).doc(docId).get();
            return doc.exists ? doc.data() : null;
        } catch (err) {
            console.error('Erro ao buscar resumo:', err);
            return null;
        }
    },

    // Busca resumos do ano
    async getYearSummaries(storeId, year) {
        try {
            const snapshot = await db.collection(this.SUMMARY_COLLECTION)
                .where('storeId', '==', storeId)
                .where('year', '==', year)
                .orderBy('month', 'asc')
                .get();
            
            return snapshot.docs.map(d => d.data());
        } catch (err) {
            console.error('Erro ao buscar resumos:', err);
            return [];
        }
    },

    // Limpa pedidos antigos (>60 dias)
    async cleanOldOrders(storeId) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

        try {
            // Primeiro verifica se há resumo do mês que será limpo
            const cutoffMonth = cutoffDate.getMonth() + 1;
            const cutoffYear = cutoffDate.getFullYear();
            
            const existingSummary = await this.getSummary(storeId, cutoffYear, cutoffMonth);
            if (!existingSummary) {
                // Gera resumo antes de limpar
                await this.generateMonthlySummary(storeId, cutoffYear, cutoffMonth);
            }

            // Busca pedidos antigos
            const snapshot = await db.collection('orders')
                .where('storeId', '==', storeId)
                .where('createdAt', '<', cutoffDate)
                .limit(100) // Limita para não sobrecarregar
                .get();

            if (snapshot.empty) {
                console.log('Nenhum pedido antigo para limpar');
                return 0;
            }

            // Exclui em batch
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            console.log(`🗑️ ${snapshot.size} pedidos antigos removidos`);
            return snapshot.size;

        } catch (err) {
            console.error('Erro ao limpar pedidos:', err);
            return 0;
        }
    },

    // Verifica e gera resumo do mês anterior se necessário
    async checkAndGeneratePreviousMonth(storeId) {
        const now = new Date();
        const prevMonth = now.getMonth(); // 0-11 (mês atual - 1)
        const prevYear = prevMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const month = prevMonth === 0 ? 12 : prevMonth;

        const existing = await this.getSummary(storeId, prevYear, month);
        if (!existing) {
            console.log(`Gerando resumo pendente: ${prevYear}-${month}`);
            await this.generateMonthlySummary(storeId, prevYear, month);
        }
    },

    // Executa manutenção completa
    async runMaintenance(storeId) {
        console.log('🔧 Iniciando manutenção de billing...');
        await this.checkAndGeneratePreviousMonth(storeId);
        await this.cleanOldOrders(storeId);
        console.log('✅ Manutenção concluída');
    }
};

window.BillingSystem = BillingSystem;
