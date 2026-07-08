// image-storage.js — uso exclusivo do painel administrativo (local).
// Comprime imagens para um Blob (WebP/JPEG quadrado) e envia ao Firebase
// Storage, retornando a download URL pública. Substitui o base64-no-Firestore:
// os documentos passam a guardar apenas `imageUrl`, ficando pequenos e
// cacheáveis pelo navegador no app do cliente.
//
// Requer que `firebase-app-compat` e `firebase-storage-compat` estejam
// carregados antes deste arquivo. Expõe `window.ImageStorage`.
(function (global) {
  function supportsWebP() {
    try {
      return document.createElement('canvas')
        .toDataURL('image/webp', 0.01)
        .startsWith('data:image/webp');
    } catch (e) {
      return false;
    }
  }

  function isStorageUrl(url) {
    return typeof url === 'string'
      && /(^https?:\/\/)?(firebasestorage\.googleapis\.com|storage\.googleapis\.com|firebasestorage\.app)/.test(url);
  }

  // Recorta para quadrado e comprime até ficar abaixo de maxBytes.
  // Retorna { blob, mime }.
  function compressToBlob(file, opts) {
    opts = opts || {};
    const sizes = opts.sizes || [960, 840, 720];
    const qualities = opts.qualities || [0.86, 0.82, 0.78, 0.74, 0.7];
    const maxBytes = opts.maxBytes || 320 * 1024;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
      reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Falha ao decodificar a imagem'));
        img.onload = async () => {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          const webp = supportsWebP();
          const mime = webp ? 'image/webp' : 'image/jpeg';
          let blob = null;

          for (const size of sizes) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            if (!webp) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); }
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

            for (const quality of qualities) {
              blob = await new Promise((res) => canvas.toBlob(res, mime, quality));
              if (blob && blob.size <= maxBytes) { resolve({ blob, mime }); return; }
            }
          }
          if (blob) resolve({ blob, mime });
          else reject(new Error('Falha ao comprimir a imagem'));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Envia o arquivo para `path` (sem extensão) e devolve a download URL.
  async function uploadImage(file, path, opts) {
    const { blob, mime } = await compressToBlob(file, opts);
    const ref = firebase.storage().ref().child(path);
    await ref.put(blob, {
      contentType: mime,
      cacheControl: 'public,max-age=31536000,immutable',
    });
    return ref.getDownloadURL();
  }

  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const head = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { blob: new Blob([arr], { type: mime }), mime };
  }

  // Sobe um base64/dataURL já pronto para `path` (usado no backfill). Não
  // recomprime — a imagem já está otimizada.
  async function uploadDataUrl(dataUrl, path) {
    const { blob, mime } = dataUrlToBlob(dataUrl);
    const ref = firebase.storage().ref().child(path);
    await ref.put(blob, {
      contentType: mime,
      cacheControl: 'public,max-age=31536000,immutable',
    });
    return ref.getDownloadURL();
  }

  // Remoção best-effort de um objeto a partir da sua download URL.
  async function deleteByUrl(url) {
    if (!isStorageUrl(url)) return;
    try {
      await firebase.storage().refFromURL(url).delete();
    } catch (e) {
      // Objeto já removido ou inexistente: ignorar.
    }
  }

  global.ImageStorage = { compressToBlob, uploadImage, uploadDataUrl, deleteByUrl, isStorageUrl };
})(window);
