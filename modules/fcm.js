// ==================== FCM MODULE ====================
// Push notifications para Painel da Loja

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
            // Registra Service Worker (ajuste o path conforme seu deploy)
            // Para GitHub Pages: '/nome-repo/firebase-messaging-sw.js'
            // Para domínio próprio: '/firebase-messaging-sw.js'
            this.swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            console.log('✅ Service Worker registrado');

            this.messaging = firebase.messaging();

            // Listener para mensagens em foreground
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

            // VAPID Key do Firebase Console
            const vapidKey = 'BEyLjUm82KxRNv4fCZOWxBln45CjHSleYDOgBCDffXVPP45SsFmZHxJxP0A0hJ0c8uZWdWU8u_YLIacXXYWtCV4';

            if (!this.messaging || !this.swReg) {
                console.error('FCM não inicializado');
                return null;
            }

            this.token = await this.messaging.getToken({
                vapidKey,
                serviceWorkerRegistration: this.swReg
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

        // Chama função global de notificação
        if (typeof handleNewOrderNotification === 'function') {
            handleNewOrderNotification(data, body || title);
        } else {
            // Fallback
            if (typeof showToast === 'function') {
                showToast(body || title || 'Nova atualização');
            }
        }

        // Notificação do sistema
        if (Notification.permission === 'granted') {
            const notif = new Notification(title || '🔔 Pedrad Loja', {
                body: body || 'Você tem uma nova atualização',
                icon: '/icon-192.png',
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
