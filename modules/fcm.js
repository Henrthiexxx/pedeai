// ==================== FCM MODULE ====================
// Push notifications para Painel da Loja - GitHub Pages /pedeai/

const FCMModule = {
    messaging: null,
    token: null,
    swReg: null,

    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('Push não suportado');
            return false;
        }

        try {
            // Path correto para GitHub Pages /pedeai/
            this.swReg = await navigator.serviceWorker.register('/pedeai/firebase-messaging-sw.js', {
                scope: '/pedeai/'
            });
            console.log('✅ Service Worker registrado');

            // Aguarda o SW ficar ativo
            if (this.swReg.installing) {
                console.log('SW instalando...');
                await new Promise(resolve => {
                    this.swReg.installing.addEventListener('statechange', function() {
                        if (this.state === 'activated') {
                            console.log('SW ativado');
                            resolve();
                        }
                    });
                });
            } else if (this.swReg.waiting) {
                console.log('SW aguardando...');
                await new Promise(resolve => {
                    this.swReg.waiting.addEventListener('statechange', function() {
                        if (this.state === 'activated') {
                            console.log('SW ativado');
                            resolve();
                        }
                    });
                });
            } else if (this.swReg.active) {
                console.log('SW já ativo');
            }

            // Aguarda estar pronto
            await navigator.serviceWorker.ready;
            console.log('✅ Service Worker pronto');

            this.messaging = firebase.messaging();

            this.messaging.onMessage((payload) => {
                console.log('📩 Mensagem FCM (foreground):', payload);
                this.showForegroundNotification(payload);
            });

            return true;
        } catch (err) {
            console.error('Erro ao inicializar FCM:', err);
            return false;
        }
    },

    async requestPermissionAndGetToken() {
        try {
            const permission = await Notification.requestPermission();

            if (permission !== 'granted') {
                console.log('Permissão negada');
                return null;
            }

            const vapidKey = 'BEyLjUm82KxRNv4fCZOWxBln45CjHSleYDOgBCDffXVPP45SsFmZHxJxP0A0hJ0c8uZWdWU8u_YLIacXXYWtCV4';

            if (!this.messaging) {
                console.error('FCM não inicializado');
                return null;
            }

            // Garante que SW está pronto
            const swReg = await navigator.serviceWorker.ready;
            console.log('SW ready para getToken');

            this.token = await this.messaging.getToken({
                vapidKey,
                serviceWorkerRegistration: swReg
            });

            console.log('🔑 FCM Token:', this.token);
            return this.token;
        } catch (err) {
            console.error('Erro ao obter token:', err);
            return null;
        }
    },

    getCollection(userType) {
        if (userType === 'store') return 'stores';
        if (userType === 'driver') return 'drivers';
        return 'users';
    },

    async saveTokenToFirestore(userId, userType = 'customer') {
        if (!this.token || !userId) return;

        const collection = this.getCollection(userType);

        try {
            await db.collection(collection).doc(userId).set({
                fcmTokens: firebase.firestore.FieldValue.arrayUnion(this.token),
                lastTokenUpdate: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            console.log('✅ Token salvo:', collection, userId);
        } catch (err) {
            console.error('Erro ao salvar token:', err);
        }
    },

    async removeToken(userId, userType = 'customer') {
        if (!this.token || !userId) return;

        const collection = this.getCollection(userType);

        try {
            await db.collection(collection).doc(userId).set({
                fcmTokens: firebase.firestore.FieldValue.arrayRemove(this.token)
            }, { merge: true });
            console.log('✅ Token removido');
        } catch (err) {
            console.error('Erro ao remover token:', err);
        }
    },

    showForegroundNotification(payload) {
        const { title, body } = payload.notification || {};
        const data = payload.data || {};

        if (typeof handleNewOrderNotification === 'function') {
            handleNewOrderNotification(data, body || title);
        } else {
            if (typeof showToast === 'function') {
                showToast(body || title || 'Nova atualização');
            }
        }

        if (Notification.permission === 'granted') {
            const notif = new Notification(title || '🔔 Pedrad Loja', {
                body: body || 'Você tem uma nova atualização',
                icon: '/pedeai/icon-192.png',
                tag: data.orderId || 'pedrad-store',
                data: data,
                requireInteraction: true
            });

            notif.onclick = () => {
                window.focus();
                if (data.orderId) {
                    showPage('orders');
                    setTimeout(() => {
                        const el = document.getElementById(`order-${data.orderId}`);
                        if (el) {
                            el.classList.add('expanded');
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 300);
                }
                notif.close();
            };
        }
    }
};

// ==================== INTEGRAÇÃO ====================

async function setupStorePushNotifications(storeId) {
    const initialized = await FCMModule.init();
    if (!initialized) return false;

    const token = await FCMModule.requestPermissionAndGetToken();
    if (token && storeId) {
        await FCMModule.saveTokenToFirestore(storeId, 'store');
        return true;
    }
    return false;
}

async function cleanupPushNotifications(userId, userType) {
    await FCMModule.removeToken(userId, userType);
}
