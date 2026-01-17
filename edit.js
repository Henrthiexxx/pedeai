// ==================== EDIT.JS - SUPER SIMPLES ====================
// Simplesmente lê storeId do localStorage (já foi salvo no login)

function openProductModal() {
    openProductEditor();
}

function editProduct(productId) {
    openProductEditor(productId);
}




function openProductEditor(productId = null) {
    // Lê storeId do localStorage (já foi salvo no login)
    const storeId = localStorage.getItem('currentStoreId');
    
    if (!storeId) {
        alert('❌ Erro: Faça login primeiro no painel principal (index.html)');
        console.error('❌ StoreId não encontrado no localStorage');
        return;
    }
    
    const url = productId 
        ? `product-editor.html?storeId=${storeId}&productId=${productId}`
        : `product-editor.html?storeId=${storeId}`;
    
    console.log('✅ Abrindo editor:', url);
    
    const w = 900, h = 800;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    
    window.open(
        url,
        'ProductEditor',
        `width=${w},height=${h},left=${left},top=${top},resizable,scrollbars`
    );
}

// Atualiza lista quando salvar
window.addEventListener('message', (e) => {
    if (e.data.type === 'productSaved') {
        if (typeof loadProducts === 'function') {
            loadProducts();
        } else {
            location.reload();
        }
    }
});

console.log('✅ Edit.js carregado');