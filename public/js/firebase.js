// ============================================================
// MJPT — Firebase Init (DEV)
// ⚠️ This is the DEV config — do NOT merge to main branch
// ============================================================

import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics }   from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDDwJgA8u432bsz0MV-XWo734IZGjuV7sU",
  authDomain:        "mjpt-dev.firebaseapp.com",
  projectId:         "mjpt-dev",
  storageBucket:     "mjpt-dev.firebasestorage.app",
  messagingSenderId: "132054544389",
  appId:             "1:132054544389:web:3cd7f0cbf49a96d03e6c6c"
};

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db        = getFirestore(app);

export { db, analytics };
