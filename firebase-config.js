const firebaseConfig = {
  apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
  authDomain: "pedrad-814d0.firebaseapp.com",
  projectId: "pedrad-814d0",
  storageBucket: "pedrad-814d0.appspot.com",
  messagingSenderId: "293587190550",
  appId: "1:293587190550:web:80c9399f82847c80e20637"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

firebase.firestore().settings({
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

const auth = firebase.auth();
const db = firebase.firestore();