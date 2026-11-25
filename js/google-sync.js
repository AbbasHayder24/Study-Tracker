/**
 * google-sync.js — 1-Tap Google Account Sign-In & Cloud Sync via Firebase (Auth + Firestore)
 *
 * 👇 الصق إعدادات firebaseConfig الخاصة بك من Firebase Console مكان الكائن أدناه فقط:
 * 👇 Paste your firebaseConfig from Firebase Console below:
 */
window.GoogleSync = (function() {
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDw5UpMl3RUEhr_5QhMbk38vOE-e-wnBaA",
    authDomain: "study-tracker-c2e52.firebaseapp.com",
    projectId: "study-tracker-c2e52",
    storageBucket: "study-tracker-c2e52.firebasestorage.app",
    messagingSenderId: "535559413934",
    appId: "1:535559413934:web:25f9adca2cb4661f5c4d3f"
  };
  
  const FB_VER = '10.14.1';
  const FB_SCRIPTS = [
    `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth-compat.js`,
    `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore-compat.js`
  ];
  
  let initPromise = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let syncInFlight = false;
  let pushDebounce = null;
  let lastSyncTime = 0;
  
  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }
  
  function isConfigured() {
    return !!(
      FIREBASE_CONFIG &&
      FIREBASE_CONFIG.apiKey &&
      !String(FIREBASE_CONFIG.apiKey).startsWith('PASTE_') &&
      FIREBASE_CONFIG.projectId &&
      !String(FIREBASE_CONFIG.projectId).startsWith('PASTE_')
    );
  }
  
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  
  async function ensureInit() {
    if (!isConfigured()) return false;
    if (auth && db) return true;
    if (!initPromise) {
      initPromise = (async () => {
        for (const src of FB_SCRIPTS) {
          await loadScript(src);
        }
        if (!window.firebase) throw new Error('Firebase SDK unavailable');
        if (!window.firebase.apps || !window.firebase.apps.length) {
          window.firebase.initializeApp(FIREBASE_CONFIG);
        }
        auth = window.firebase.auth();
        db = window.firebase.firestore();
        try {
          await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        } catch (e) {}
        
        // Handle redirect sign-in result (used on iOS standalone PWA)
        try {
          await auth.getRedirectResult();
        } catch (e) {}
        
        auth.onAuthStateChanged((user) => {
          const prevUid = currentUser ? currentUser.uid : null;
          currentUser = user || null;
          if (currentUser) {
            try {
              localStorage.setItem('study_tracker_google_uid', currentUser.uid);
              sessionStorage.removeItem('study_tracker_google_redirect');
            } catch (e) {}
            if (prevUid !== currentUser.uid && window.StudyApp && window.StudyApp.renderAll) {
              window.StudyApp.renderAll();
            }
            syncNow(true).then((res) => {
              if (res && res.updated && window.StudyApp && window.StudyApp.renderAll) {
                window.StudyApp.renderAll();
              }
            });
          } else {
            try { localStorage.removeItem('study_tracker_google_uid'); } catch (e) {}
            if (prevUid && window.StudyApp && window.StudyApp.renderAll) {
              window.StudyApp.renderAll();
            }
          }
        });
        
        hookAutoSave();
        return true;
      })().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }
  
  function hookAutoSave() {
    if (!window.AppState || window.AppState.__googleSyncHooked) return;
    const origSave = window.AppState.save;
    window.AppState.__googleSyncHooked = true;
    window.AppState.save = function(triggerSync = true, immediate = false) {
      const res = origSave.apply(this, arguments);
      if (triggerSync && currentUser && db) {
        if (pushDebounce) clearTimeout(pushDebounce);
        pushDebounce = setTimeout(() => {
          pushToCloud(true);
        }, immediate ? 150 : 1200);
      }
      return res;
    };
  }
  
  async function pushToCloud(silent = false) {
    if (!currentUser || !db) return { ok: false, error: 'Not signed in' };
    try {
      const data = window.AppState.getData();
      const payload = JSON.parse(JSON.stringify(data));
      payload.updatedAt = Number(data.updatedAt) || Date.now();
      await db.collection('users').doc(currentUser.uid).set({
        payload,
        updatedAt: payload.updatedAt,
        email: currentUser.email || ''
      }, { merge: true });
      lastSyncTime = Date.now();
      if (!silent && window.AppUI) {
        window.AppUI.showToast(isAr() ? 'تمت المزامنة مع حساب Google' : 'Synced with Google', 'success');
      }
      return { ok: true };
    } catch (e) {
      if (!silent && window.AppUI) {
        window.AppUI.showToast((isAr() ? 'فشلت المزامنة: ' : 'Sync failed: ') + (e.message || ''), 'danger');
      }
      return { ok: false, error: e.message || 'Sync error' };
    }
  }
  
  async function syncNow(silent = false) {
    if (syncInFlight) return { ok: false, busy: true };
    if (!isConfigured()) return { ok: false, error: 'Not configured' };
    syncInFlight = true;
    try {
      await ensureInit();
      if (!currentUser || !db) return { ok: false, error: 'Not signed in' };
      
      const docRef = db.collection('users').doc(currentUser.uid);
      const snap = await docRef.get();
      const localData = window.AppState.getData();
      const localTs = Number(localData.updatedAt) || 0;
      
      if (snap.exists) {
        const remoteDoc = snap.data() || {};
        const remoteData = remoteDoc.payload;
        const remoteTs = Number(remoteDoc.updatedAt || (remoteData && remoteData.updatedAt)) || 0;
        
        if (remoteData && remoteTs > localTs) {
          window.AppState.replaceData(remoteData, false);
          lastSyncTime = Date.now();
          if (!silent && window.AppUI) {
            window.AppUI.showToast(isAr() ? 'تم سحب أحدث بياناتك من Google' : 'Pulled latest data from Google', 'success');
          }
          return { ok: true, updated: true };
        }
      }
      
      const pushRes = await pushToCloud(silent);
      return { ok: pushRes.ok, updated: false };
    } catch (e) {
      if (!silent && window.AppUI) {
        window.AppUI.showToast((isAr() ? 'خطأ بالمزامنة: ' : 'Sync error: ') + (e.message || ''), 'danger');
      }
      return { ok: false, error: e.message || 'Sync error' };
    } finally {
      syncInFlight = false;
    }
  }
  
  async function signIn() {
    if (!isConfigured()) {
      if (window.AppUI) {
        window.AppUI.showToast(
          isAr() ? 'أضف إعدادات firebaseConfig في ملف js/google-sync.js أولاً' : 'Paste firebaseConfig in js/google-sync.js first',
          'warning'
        );
      }
      return { ok: false };
    }
    try {
      if (!auth) {
        if (window.AppUI) {
          window.AppUI.showToast(isAr() ? 'جاري تجهيز اتصال Google...' : 'Preparing Google Sign-In...', 'info');
        }
        await ensureInit();
      }
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Always use signInWithPopup on github.io (iOS blocks cross-domain signInWithRedirect cookies)
      const cred = await auth.signInWithPopup(provider);
      if (cred && cred.user) {
        currentUser = cred.user;
        try { localStorage.setItem('study_tracker_google_uid', currentUser.uid); } catch (e) {}
        if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
        await syncNow(false);
        if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
      }
      return { ok: true };
    } catch (e) {
      let msg = (e && e.message) ? e.message : '';
      if (e && e.code === 'auth/popup-blocked') {
        msg = isAr() ?
          'المتصفح منع النافذة المنبثقة — اسمح بالنوافذ المنبثقة أو اضغط الزر مرة ثانية' :
          'Popup blocked — allow popups or tap the button once more';
      } else if (e && e.code === 'auth/unauthorized-domain') {
        msg = isAr() ?
          'أضف abbashayder24.github.io إلى Authorized domains في Firebase' :
          'Add abbashayder24.github.io to Authorized domains in Firebase';
      }
      if (window.AppUI) {
        window.AppUI.showToast((isAr() ? 'تعذر تسجيل الدخول: ' : 'Sign-in failed: ') + msg, 'danger');
      }
      return { ok: false, error: msg };
    }
  }
  
  async function signOut() {
    try {
      if (auth) await auth.signOut();
      currentUser = null;
      if (window.AppUI) {
        window.AppUI.showToast(isAr() ? 'تم تسجيل الخروج من Google' : 'Signed out of Google', 'info');
      }
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  }
  
  function getUser() {
    return currentUser ? {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || ''
    } : null;
  }
  
  // Silently initialize in background if user previously signed in with Google
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      try {
        const hadUid = !!localStorage.getItem('study_tracker_google_uid');
        const fromRedirect = !!sessionStorage.getItem('study_tracker_google_redirect');
        if (isConfigured() && (hadUid || fromRedirect || navigator.onLine !== false)) {
          ensureInit().catch(() => {});
        }
      } catch (e) {}
    }, 350);
    
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentUser) {
        syncNow(true).then((res) => {
          if (res && res.updated && window.StudyApp && window.StudyApp.renderAll) {
            window.StudyApp.renderAll();
          }
        });
      }
    });
  }
  
  return {
    isConfigured,
    getUser,
    signIn,
    signOut,
    syncNow
  };
})();