// ==================== BATCH-EDITOR.JS ====================
// Cadastro em lote: Marca + Tipo + N nomes → salva tudo de uma vez no Firestore

(function () {
    // ── Estilos ──────────────────────────────────────────────────────────────
    const css = `
    #beOverlay {
        position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;
        display:flex;align-items:center;justify-content:center;
    }
    #beModal {
        background:#16213e;border:1px solid #2a2a4a;border-radius:14px;
        padding:28px;width:540px;max-height:88vh;overflow-y:auto;
        color:#e0e0e0;font-family:'Segoe UI',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6);
    }
    #beModal h2 { margin:0 0 20px;color:#a78bfa;font-size:1.2rem;display:flex;align-items:center;gap:8px; }
    .be-field { margin-bottom:14px; }
    .be-field label { display:block;font-size:.8rem;color:#888;margin-bottom:4px; }
    .be-field input {
        width:100%;box-sizing:border-box;padding:10px 12px;
        background:#0f0f23;border:1px solid #333;border-radius:8px;
        color:#e0e0e0;font-size:.95rem;outline:none;
        transition:border-color .2s;
    }
    .be-field input:focus { border-color:#a78bfa; }
    .be-row { display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end; }
    #beNameBox {
        background:#0f0f23;border:1px solid #a78bfa;border-radius:10px;
        padding:18px;margin-bottom:16px;text-align:center;
    }
    #beNameBox .be-counter { font-size:.8rem;color:#888;margin-bottom:8px; }
    #beNameBox .be-hint { font-size:.75rem;color:#555;margin-top:6px; }
    #beName {
        width:100%;box-sizing:border-box;padding:12px;
        background:#16213e;border:1px solid #444;border-radius:8px;
        color:#e0e0e0;font-size:1.1rem;text-align:center;outline:none;
        transition:border-color .2s;
    }
    #beName:focus { border-color:#a78bfa; }
    .be-preview-title { font-size:.8rem;color:#888;margin-bottom:8px; }
    #beList { list-style:none;padding:0;margin:0 0 18px;max-height:200px;overflow-y:auto; }
    #beList li {
        display:flex;align-items:center;gap:8px;padding:7px 10px;
        background:#0f0f23;border-radius:6px;margin-bottom:5px;font-size:.88rem;
    }
    #beList li span { flex:1; }
    #beList li input {
        flex:1;background:#16213e;border:1px solid #a78bfa;border-radius:4px;
        color:#e0e0e0;padding:3px 6px;font-size:.88rem;outline:none;
    }
    .be-btn-icon {
        background:none;border:none;cursor:pointer;padding:2px 6px;
        border-radius:4px;font-size:.85rem;
    }
    .be-btn-icon.edit { color:#60a5fa; }
    .be-btn-icon.del  { color:#f87171; }
    .be-btn-icon.save { color:#34d399; }
    .be-actions { display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap; }
    .be-btn {
        padding:9px 18px;border:none;border-radius:8px;cursor:pointer;
        font-size:.9rem;font-weight:600;transition:opacity .2s;
    }
    .be-btn:hover { opacity:.85; }
    .be-btn.primary { background:#a78bfa;color:#0f0f23; }
    .be-btn.success { background:#10b981;color:#fff; }
    .be-btn.danger  { background:#ef4444;color:#fff; }
    .be-btn.ghost   { background:#2a2a4a;color:#e0e0e0; }
    .be-btn:disabled { opacity:.4;cursor:not-allowed; }
    .be-progress { font-size:.8rem;color:#60a5fa;margin-bottom:12px; }
    #beStatus { font-size:.85rem;color:#34d399;margin-top:10px;text-align:center;min-height:20px; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── Estado ───────────────────────────────────────────────────────────────
    let state = {
        marca: '', tipo: '', quantidade: 0,
        items: [],          // {id, nome}
        currentIndex: 0,
        editingId: null,
        step: 'config'      // 'config' | 'input' | 'done'
    };
    let idCounter = 0;

    // ── Abrir / Fechar ────────────────────────────────────────────────────────
    window.openBatchEditor = function () {
        if (document.getElementById('beOverlay')) return;
        state = { marca:'', tipo:'', quantidade:0, items:[], currentIndex:0, editingId:null, step:'config' };
        idCounter = 0;
        render();
    };

    function close() {
        const el = document.getElementById('beOverlay');
        if (el) el.remove();
    }

    // ── Render principal ──────────────────────────────────────────────────────
    function render() {
        let existing = document.getElementById('beOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'beOverlay';
        overlay.innerHTML = `
            <div id="beModal">
                <h2>📦 Cadastro em Lote</h2>
                ${state.step === 'config' ? renderConfig() : renderInput()}
            </div>`;
        document.body.appendChild(overlay);
        bindEvents();

        // Foco automático
        if (state.step === 'config') document.getElementById('beMarca')?.focus();
        else document.getElementById('beName')?.focus();
    }

    function renderConfig() {
        return `
            <div class="be-field"><label>Marca</label>
                <input id="beMarca" value="${esc(state.marca)}" placeholder="Ex: Ziggy"/></div>
            <div class="be-row">
                <div class="be-field"><label>Tipo</label>
                    <input id="beTipo" value="${esc(state.tipo)}" placeholder="Ex: Essência"/></div>
                <div class="be-field"><label>Quantidade</label>
                    <input id="beQtd" type="number" min="1" max="100" value="${state.quantidade||''}" placeholder="5"/></div>
            </div>
            <div class="be-actions">
                <button class="be-btn ghost" onclick="window._beClose()">Cancelar</button>
                <button class="be-btn primary" onclick="window._beStart()">Iniciar ▶</button>
            </div>`;
    }

    function renderInput() {
        const done = state.currentIndex >= state.quantidade;
        const progress = `${Math.min(state.currentIndex, state.quantidade)} / ${state.quantidade}`;

        return `
            <div class="be-progress">✏️ <strong>${esc(state.marca)}</strong> · ${esc(state.tipo)} — ${progress} preenchidos</div>
            ${!done ? `
            <div id="beNameBox">
                <div class="be-counter">Item ${state.currentIndex + 1} de ${state.quantidade}</div>
                <input id="beName" placeholder="Digite o nome e pressione Enter" autocomplete="off"/>
                <div class="be-hint">↵ Enter para avançar</div>
            </div>` : `<div style="color:#34d399;text-align:center;margin-bottom:16px;">✅ Todos os nomes preenchidos</div>`}

            ${state.items.length ? `<div class="be-preview-title">📋 Itens que serão criados (${state.items.length}):</div>` : ''}
            <ul id="beList">${renderList()}</ul>

            <div class="be-actions">
                <button class="be-btn ghost" onclick="window._beClose()">Cancelar</button>
                ${state.items.length ? `<button class="be-btn success" onclick="window._beConcluir()">Concluir e Salvar (${state.items.length})</button>` : ''}
            </div>
            <div id="beStatus"></div>`;
    }

    function renderList() {
        return state.items.map(item => `
            <li id="li-${item.id}">
                ${state.editingId === item.id
                    ? `<input class="be-list-edit" data-id="${item.id}" value="${esc(item.nome)}" autocomplete="off"/>
                       <button class="be-btn-icon save" onclick="window._beSaveEdit(${item.id})">💾</button>`
                    : `<span>🏷️ ${esc(state.marca)} ${esc(state.tipo)} <strong>${esc(item.nome)}</strong></span>
                       <button class="be-btn-icon edit" onclick="window._beEdit(${item.id})">✏️</button>`
                }
                <button class="be-btn-icon del" onclick="window._beDel(${item.id})">🗑️</button>
            </li>`).join('');
    }

    // ── Bind events ───────────────────────────────────────────────────────────
    function bindEvents() {
        // Enter no nome
        const nameInput = document.getElementById('beName');
        if (nameInput) {
            nameInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') window._beAddName();
            });
        }
        // Config: Enter avança campos
        ['beMarca','beTipo','beQtd'].forEach((id, i, arr) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    const next = document.getElementById(arr[i+1]);
                    if (next) next.focus();
                    else window._beStart();
                }
            });
        });
    }

    // ── Ações globais (acessíveis pelo onclick inline) ─────────────────────────
    window._beClose = close;

    window._beStart = function () {
        state.marca    = document.getElementById('beMarca')?.value.trim();
        state.tipo     = document.getElementById('beTipo')?.value.trim();
        state.quantidade = parseInt(document.getElementById('beQtd')?.value) || 0;
        if (!state.marca || !state.tipo || state.quantidade < 1) {
            alert('Preencha Marca, Tipo e Quantidade (mínimo 1).');
            return;
        }
        state.step = 'input';
        state.currentIndex = 0;
        state.items = [];
        render();
    };

    window._beAddName = function () {
        const input = document.getElementById('beName');
        const nome = input?.value.trim();
        if (!nome) return;
        idCounter++;
        state.items.push({ id: idCounter, nome });
        state.currentIndex++;
        input.value = '';

        // Re-render lista e caixa de input
        document.getElementById('beList').innerHTML = renderList();
        if (state.currentIndex >= state.quantidade) {
            // Esconde caixa de input
            const box = document.getElementById('beNameBox');
            if (box) box.outerHTML = `<div style="color:#34d399;text-align:center;margin-bottom:16px;">✅ Todos os nomes preenchidos</div>`;
            // Garante botão concluir
            refreshActions();
        } else {
            const counter = document.querySelector('#beNameBox .be-counter');
            if (counter) counter.textContent = `Item ${state.currentIndex + 1} de ${state.quantidade}`;
            const title = document.querySelector('.be-preview-title');
            if (title) title.textContent = `📋 Itens que serão criados (${state.items.length}):`;
            else {
                const list = document.getElementById('beList');
                if (list) list.insertAdjacentHTML('beforebegin', `<div class="be-preview-title">📋 Itens que serão criados (${state.items.length}):</div>`);
            }
            refreshActions();
            document.getElementById('beName')?.focus();
        }
        // Scroll para o fim da lista
        const ul = document.getElementById('beList');
        if (ul) ul.scrollTop = ul.scrollHeight;
    };

    function refreshActions() {
        const actions = document.querySelector('.be-actions');
        if (!actions) return;
        actions.innerHTML = `
            <button class="be-btn ghost" onclick="window._beClose()">Cancelar</button>
            ${state.items.length ? `<button class="be-btn success" onclick="window._beConcluir()">Concluir e Salvar (${state.items.length})</button>` : ''}`;
    }

    window._beEdit = function (id) {
        state.editingId = id;
        document.getElementById('beList').innerHTML = renderList();
        document.querySelector(`.be-list-edit[data-id="${id}"]`)?.focus();
    };

    window._beSaveEdit = function (id) {
        const input = document.querySelector(`.be-list-edit[data-id="${id}"]`);
        const nome = input?.value.trim();
        if (nome) {
            const item = state.items.find(i => i.id === id);
            if (item) item.nome = nome;
        }
        state.editingId = null;
        document.getElementById('beList').innerHTML = renderList();
    };

    window._beDel = function (id) {
        state.items = state.items.filter(i => i.id !== id);
        if (state.editingId === id) state.editingId = null;
        document.getElementById('beList').innerHTML = renderList();
        const title = document.querySelector('.be-preview-title');
        if (title) title.textContent = `📋 Itens que serão criados (${state.items.length}):`;
        refreshActions();
    };

    window._beConcluir = async function () {
        if (!state.items.length) return;

        const storeId = localStorage.getItem('currentStoreId');
        if (!storeId) { alert('❌ Faça login primeiro.'); return; }

        const btn = document.querySelector('.be-btn.success');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

        try {
            const db = firebase.firestore();
            const batch = db.batch();
            const now = firebase.firestore.FieldValue.serverTimestamp();

            state.items.forEach(item => {
                const ref = db.collection('stores').doc(storeId).collection('products').doc();
                batch.set(ref, {
                    name: `${state.marca} ${state.tipo} ${item.nome}`,
                    marca: state.marca,
                    tipo: state.tipo,
                    variante: item.nome,
                    active: true,
                    createdAt: now,
                    updatedAt: now
                });
            });

            await batch.commit();

            setStatus(`✅ ${state.items.length} produto(s) criados com sucesso!`);

            // Notifica página pai (igual product-editor.html)
            window.opener?.postMessage({ type: 'productSaved' }, '*');
            if (typeof loadProducts === 'function') loadProducts();

            setTimeout(close, 1800);

        } catch (err) {
            console.error('Erro batch save:', err);
            setStatus('❌ Erro ao salvar: ' + err.message);
            if (btn) { btn.disabled = false; btn.textContent = `Concluir e Salvar (${state.items.length})`; }
        }
    };

    function setStatus(msg) {
        const el = document.getElementById('beStatus');
        if (el) el.textContent = msg;
    }

    function esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    console.log('✅ Batch-editor.js carregado — use openBatchEditor()');
})();
