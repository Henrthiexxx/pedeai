// ==================== PRODUCT EDITOR - VERSÃO UNIVERSAL ====================
// Cole este código no FINAL do seu edit.html (ou qualquer página)

function openProductModal() {
    openProductEditorUniversal();
}

function editProduct(productId) {
    openProductEditorUniversal(productId);
}

async function openProductEditorUniversal(productId = null) {
    console.log('openProductEditorUniversal chamado');
    
    // Tenta pegar storeId de várias fontes
    let storeId = null;
    
    // 1. Tenta da variável global currentStore
    if (window.currentStore && window.currentStore.id) {
        storeId = window.currentStore.id;
        console.log('✅ StoreId obtido de currentStore:', storeId);
    }
    
    // 2. Tenta do localStorage
    if (!storeId) {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            try {
                const userData = JSON.parse(storedUser);
                storeId = userData.storeId;
                console.log('✅ StoreId obtido de localStorage:', storeId);
            } catch (e) {
                console.log('Erro ao parsear localStorage');
            }
        }
    }
    
    // 3. Tenta buscar do Firebase
    if (!storeId && window.auth && window.db) {
        const user = firebase.auth().currentUser;
        if (user) {
            console.log('⏳ Buscando storeId do Firebase...');
            showToast('⏳ Carregando informações da loja...');
            
            try {
                let snapshot = await db.collection('stores')
                    .where('ownerEmail', '==', user.email)
                    .limit(1)
                    .get();
                
                if (snapshot.empty) {
                    snapshot = await db.collection('stores')
                        .where('ownerId', '==', user.uid)
                        .limit(1)
                        .get();
                }
                
                if (!snapshot.empty) {
                    storeId = snapshot.docs[0].id;
                    console.log('✅ StoreId obtido do Firebase:', storeId);
                    
                    // Salva no localStorage para próxima vez
                    localStorage.setItem('currentStoreId', storeId);
                }
            } catch (err) {
                console.error('Erro ao buscar loja:', err);
            }
        }
    }
    
    // 4. Tenta do localStorage direto
    if (!storeId) {
        storeId = localStorage.getItem('currentStoreId');
        if (storeId) {
            console.log('✅ StoreId obtido de localStorage direto:', storeId);
        }
    }
    
    // Verificação final
    if (!storeId) {
        console.error('❌ Não foi possível obter o storeId');
        showToast('❌ Erro: Loja não identificada. Faça login novamente.');
        
        // Tenta redirecionar para login
        setTimeout(() => {
            if (confirm('Não foi possível identificar sua loja. Deseja ir para o login?')) {
                window.location.href = 'index.html';
            }
        }, 1000);
        return;
    }
    
    // Monta URL
    const url = productId 
        ? `product-editor.html?storeId=${storeId}&productId=${productId}`
        : `product-editor.html?storeId=${storeId}`;

    console.log('🚀 Abrindo URL:', url);

    // Configuração do popup
    const width = 900;
    const height = 800;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;

    const popup = window.open(
        url,
        'ProductEditor',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    
    if (!popup) {
        showToast('❌ Popup bloqueado. Permita popups para este site.');
    }
}

// Listener para atualizar quando produto for salvo
window.addEventListener('message', async (event) => {
    if (event.data.type === 'productSaved') {
        console.log('✅ Produto salvo, recarregando lista...');
        
        // Tenta recarregar produtos
        if (typeof loadProducts === 'function') {
            await loadProducts();
        }
        
        if (typeof loadCategories === 'function') {
            await loadCategories();
        }
        
        // Ou recarrega a página inteira
        if (typeof loadProducts !== 'function') {
            location.reload();
        } else {
            showToast('✅ Produtos atualizados!');
        }
    }
});

// Função auxiliar de toast (se não existir)
if (typeof showToast !== 'function') {
    function showToast(msg) {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        } else {
            console.log('TOAST:', msg);
            alert(msg);
        }
    }
}