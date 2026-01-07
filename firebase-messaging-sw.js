// firebase-messaging-sw.js
// Coloque na RAIZ do projeto (mesmo nível do index.html)

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
    authDomain: "pedrad-814d0.firebaseapp.com",
    projectId: "pedrad-814d0",
    storageBucket: "pedrad-814d0.firebasestorage.app",
    messagingSenderId: "293587190550",
    appId: "1:293587190550:web:80c9399f82847c80e20637"
});

const messaging = firebase.messaging();

// Recebe mensagens em background (app fechado/minimizado)
messaging.onBackgroundMessage((payload) => {
    console.log('📩 Mensagem em background:', payload);
    
    const { title, body, icon } = payload.notification || {};
    const data = payload.data || {};
    
    // Personaliza notificação conforme o tipo
    let notifTitle = title || '🔔 Pedrad';
    let notifBody = body || 'Você tem uma nova atualização';
    let notifIcon = icon || '/icon-192.png';
    
    if (data.type === 'new_order') {
        notifTitle = '🔔 Novo Pedido!';
        notifBody = body || `Pedido #${(data.orderId || '').slice(-6).toUpperCase()} - ${data.customerName || 'Cliente'}`;
    }
    
    const options = {
        body: notifBody,
        icon: notifIcon,
        badge: '/icon-72.png',
        vibrate: [300, 100, 300, 100, 300],
        tag: data.orderId || 'pedrad-notification',
        data: data,
        requireInteraction: true,
        actions: [
            { action: 'open', title: '📦 Ver Pedido' },
            { action: 'close', title: 'Fechar' }
        ]
    };
    
    return self.registration.showNotification(notifTitle, options);
});

// Clique na notificação
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const data = event.notification.data || {};
    const action = event.action;
    
    if (action === 'close') return;
    
    let url = '/';
    
    if (data.type === 'new_order' || data.type === 'order_update') {
        url = '/?page=orders';
        if (data.orderId) {
            url += '&order=' + data.orderId;
        }
    }
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.focus();
                        client.postMessage({
                            type: 'NOTIFICATION_CLICK',
                            orderId: data.orderId
                        });
                        return;
                    }
                }
                return clients.openWindow(url);
            })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
