// ============================================================
// MJPT — Firebase Init
// CDN-based. No build tools needed.
// ============================================================

import { initializeApp }       from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics }        from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import { getFirestore }        from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDg-t05XxU0ghnJHdFpkF-1NkX6kccTcg0",
  authDomain:        "mjpt-bmb.firebaseapp.com",
  projectId:         "mjpt-bmb",
  storageBucket:     "mjpt-bmb.firebasestorage.app",
  messagingSenderId: "416831620764",
  appId:             "1:416831620764:web:bc189b817ae06b86fb0f59",
  measurementId:     "G-6C9N35592T"
};

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db        = getFirestore(app);

export { db, analytics };
