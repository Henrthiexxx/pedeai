// ==================== POPUP SYSTEM ====================
// Substitui confirm() e alert() nativos por modais HTML

const PopupSystem = {
    container: null,

    init() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'popupSystemContainer';
        this.container.innerHTML = `
            <style>
                #popupOverlay {
                    display: none; position: fixed; inset: 0;
                    background: rgba(0,0,0,0.85); z-index: 99999;
                    align-items: center; justify-content: center;
                    padding: 20px; animation: popupFadeIn 0.2s ease;
                }
                #popupOverlay.show { display: flex; }
                @keyframes popupFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes popupSlideIn {
                    from { opacity: 0; transform: scale(0.95) translateY(10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .popup-box {
                    background: #0a0a0a; border: 1px solid #262626;
                    border-radius: 16px; max-width: 380px; width: 100%;
                    animation: popupSlideIn 0.25s ease;
                    overflow: hidden;
                }
                .popup-header {
                    padding: 20px 20px 0; text-align: center;
                }
                .popup-icon {
                    font-size: 3rem; margin-bottom: 12px;
                }
                .popup-title {
                    font-size: 1.1rem; font-weight: 600;
                    margin-bottom: 8px; color: #fff;
                }
                .popup-message {
                    font-size: 0.9rem; color: #737373;
                    line-height: 1.5; padding: 0 20px 20px;
                    text-align: center;
                }
                .popup-actions {
                    display: flex; border-top: 1px solid #262626;
                }
                .popup-btn {
                    flex: 1; padding: 16px; border: none;
                    background: transparent; color: #fff;
                    font-size: 0.95rem; font-weight: 500;
                    cursor: pointer; transition: background 0.2s;
                }
                .popup-btn:hover { background: rgba(255,255,255,0.05); }
                .popup-btn:active { background: rgba(255,255,255,0.1); }
                .popup-btn.cancel { color: #737373; }
                .popup-btn.danger { color: #ef4444; }
                .popup-btn.primary { color: #fff; background: #fff; color: #000; }
                .popup-btn.primary:hover { background: #e5e5e5; }
                .popup-btn + .popup-btn { border-left: 1px solid #262626; }
            </style>
            <div id="popupOverlay">
                <div class="popup-box">
                    <div class="popup-header">
                        <div class="popup-icon" id="popupIcon">⚠️</div>
                        <div class="popup-title" id="popupTitle">Título</div>
                    </div>
                    <div class="popup-message" id="popupMessage">Mensagem</div>
                    <div class="popup-actions" id="popupActions"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.container);
        
        document.getElementById('popupOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'popupOverlay') this.close();
        });
    },

    show(options) {
        this.init();
        
        const {
            icon = '⚠️',
            title = 'Atenção',
            message = '',
            buttons = [{ text: 'OK', action: () => this.close() }]
        } = options;

        document.getElementById('popupIcon').textContent = icon;
        document.getElementById('popupTitle').textContent = title;
        document.getElementById('popupMessage').textContent = message;
        
        const actionsEl = document.getElementById('popupActions');
        actionsEl.innerHTML = buttons.map((btn, i) => `
            <button class="popup-btn ${btn.class || ''}" data-idx="${i}">
                ${btn.text}
            </button>
        `).join('');
        
        actionsEl.querySelectorAll('.popup-btn').forEach((el, i) => {
            el.onclick = () => {
                this.close();
                if (buttons[i].action) buttons[i].action();
            };
        });
        
        document.getElementById('popupOverlay').classList.add('show');
        return this;
    },

    close() {
        const overlay = document.getElementById('popupOverlay');
        if (overlay) overlay.classList.remove('show');
    },

    // Atalhos comuns
    confirm(title, message, onConfirm, onCancel) {
        return this.show({
            icon: '❓',
            title,
            message,
            buttons: [
                { text: 'Cancelar', class: 'cancel', action: onCancel },
                { text: 'Confirmar', class: 'primary', action: onConfirm }
            ]
        });
    },

    confirmDanger(title, message, confirmText, onConfirm) {
        return this.show({
            icon: '🗑️',
            title,
            message,
            buttons: [
                { text: 'Cancelar', class: 'cancel' },
                { text: confirmText || 'Excluir', class: 'danger', action: onConfirm }
            ]
        });
    },

    alert(title, message, icon = 'ℹ️') {
        return this.show({ icon, title, message, buttons: [{ text: 'OK', class: 'primary' }] });
    },

    success(title, message) {
        return this.alert(title, message, '✅');
    },

    error(title, message) {
        return this.alert(title, message, '❌');
    },

    logout(onConfirm) {
        return this.show({
            icon: '👋',
            title: 'Sair da conta',
            message: 'Tem certeza que deseja sair? Você precisará fazer login novamente.',
            buttons: [
                { text: 'Cancelar', class: 'cancel' },
                { text: 'Sair', class: 'danger', action: onConfirm }
            ]
        });
    }
};

// Disponibiliza globalmente
window.PopupSystem = PopupSystem;

// Inicializa quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PopupSystem.init());
} else {
    PopupSystem.init();
}
