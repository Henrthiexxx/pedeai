// firebase-config.js (COMPAT) — use com <script src="...firebase-*-compat.js">
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
    authDomain: "pedrad-814d0.firebaseapp.com",
    projectId: "pedrad-814d0",
    // IMPORTANTE: no Web config normalmente é ".appspot.com"
    // Troque pra o valor EXATO que aparece no Firebase Console se este estiver errado.
    storageBucket: "pedrad-814d0.appspot.com",
    messagingSenderId: "293587190550",
    appId: "1:293587190550:web:80c9399f82847c80e20637",
    measurementId: "G-1WRR3193R9",
  };

  // Inicializa só uma vez
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

  // Expor atalhos globais (opcional)
  window.firebaseConfig = firebaseConfig;
  window.auth = firebase.auth();
  window.db = firebase.firestore();

  console.log("[Firebase] OK:", firebase.app().options.projectId);
})();
