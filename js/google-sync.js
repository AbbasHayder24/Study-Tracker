/**
 * google-sync.js — 1-Tap Google Account Sign-In & Smart Merge Cloud Sync via Firebase (Auth + Firestore)
 *
 * 👇 الصق إعدادات firebaseConfig الخاصة بك من Firebase Console مكان الكائن أدناه فقط:
 * 👇 Paste your firebaseConfig from Firebase Console below:
 */
window.GoogleSync = (function () {
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
  let pendingPush = false;
  let queuedSync = false;
  let queuedSilent = true;
  let pushDebounce = null;
  let signingIn = false;

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

  function isIOSStandalone() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    return isIOS && standalone;
  }

  function updateStatus(patch) {
    if (window.AppState && typeof window.AppState.setSyncStatus === 'function') {
      window.AppState.setSyncStatus(patch);
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.getAttribute('data-loaded') === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = () => {
        s.remove();
        reject(new Error('Failed to load ' + src));
      };
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

        // Handle redirect sign-in result if returning from redirect flow
        let hadRedirectResult = false;
        try {
          const redir = await auth.getRedirectResult();
          if (redir && redir.user) {
            hadRedirectResult = true;
            currentUser = redir.user;
            try {
              localStorage.setItem('study_tracker_google_uid', currentUser.uid);
              sessionStorage.removeItem('study_tracker_google_redirect');
            } catch (e) {}
          }
        } catch (e) {
          try { sessionStorage.removeItem('study_tracker_google_redirect'); } catch (e2) {}
        }

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
            // Avoid double syncNow() when signIn() is actively handling the interactive sync
            if (!signingIn) {
              syncNow(!hadRedirectResult).then((res) => {
                if (res && res.updated && window.StudyApp && window.StudyApp.renderAll) {
                  window.StudyApp.renderAll();
                }
              });
              hadRedirectResult = false;
            }
          } else {
            try { localStorage.removeItem('study_tracker_google_uid'); } catch (e) {}
            updateStatus({ state: 'idle', lastError: '' });
            if (prevUid && window.StudyApp && window.StudyApp.renderAll) {
              window.StudyApp.renderAll();
            }
          }
        });

        return true;
      })().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  function onLocalSave(immediate = false) {
    pendingPush = true;
    if (!isConfigured()) return;
    if (!currentUser && !localStorage.getItem('study_tracker_google_uid')) return;
    if (pushDebounce) clearTimeout(pushDebounce);
    pushDebounce = setTimeout(() => {
      pushDebounce = null;
      if (navigator.onLine === false) return;
      syncNow(true);
    }, immediate ? 150 : 1200);
  }

  function stableSnapshot(obj) {
    try {
      const copy = JSON.parse(JSON.stringify(obj || {}));
      delete copy.updatedAt;
      return JSON.stringify(copy);
    } catch (e) {
      return '';
    }
  }

  async function writeCloudPayload(payload) {
    await db.collection('users').doc(currentUser.uid).set({
      payload,
      updatedAt: payload.updatedAt,
      email: currentUser.email || ''
    }, { merge: true });
  }

  async function syncNow(silent = false) {
    if (!isConfigured()) return { ok: false, error: 'Not configured' };
    if (navigator.onLine === false) {
      updateStatus({ state: 'error', lastError: isAr() ? 'لا يوجد اتصال بالإنترنت' : 'Offline' });
      return { ok: false, error: 'Offline' };
    }
    if (syncInFlight) {
      queuedSync = true;
      if (!silent) queuedSilent = false;
      return { ok: false, busy: true };
    }

    syncInFlight = true;
    updateStatus({ state: 'syncing', lastError: '' });

    try {
      await ensureInit();
      if (!currentUser || !db) {
        updateStatus({ state: 'idle', lastError: '' });
        return { ok: false, error: 'Not signed in' };
      }

      const docRef = db.collection('users').doc(currentUser.uid);
      const snap = await docRef.get();
      const localData = window.AppState.getData();
      const localSnap = stableSnapshot(localData);

      let merged = localData;
      let remoteExists = false;
      let remoteSnap = '';

      if (snap.exists) {
        const remoteDoc = snap.data() || {};
        const remoteData = remoteDoc.payload;
        if (remoteData && typeof remoteData === 'object') {
          remoteExists = true;
          remoteSnap = stableSnapshot(remoteData);
          if (typeof window.AppState.mergeData === 'function') {
            merged = window.AppState.mergeData(localData, remoteData);
          } else {
            const localTs = Number(localData.updatedAt) || 0;
            const remoteTs = Number(remoteDoc.updatedAt || remoteData.updatedAt) || 0;
            merged = remoteTs > localTs ? remoteData : localData;
          }
        }
      }

      const mergedSnap = stableSnapshot(merged);
      const localChanged = mergedSnap !== localSnap;
      const remoteChanged = !remoteExists || mergedSnap !== remoteSnap || pendingPush;

      if (localChanged) {
        window.AppState.replaceData(merged, false, true);
      }

      if (remoteChanged) {
        const payload = JSON.parse(JSON.stringify(window.AppState.getData()));
        payload.updatedAt = Math.max(Number(payload.updatedAt) || 0, Date.now());
        // Keep local updatedAt aligned without re-triggering sync
        window.AppState.getData().updatedAt = payload.updatedAt;
        window.AppState.save(false, true);
        await writeCloudPayload(payload);
      }

      pendingPush = false;
      updateStatus({ state: 'ok', lastSyncedAt: Date.now(), lastError: '' });

      if (!silent && window.AppUI) {
        window.AppUI.showToast(
          localChanged
            ? (isAr() ? 'تم دمج ومزامنة أحدث بياناتك مع Google ☁️' : 'Merged & synced with Google ☁️')
            : (isAr() ? 'بياناتك محدّثة ومتزامنة مع Google ☁️' : 'Synced & up to date with Google ☁️'),
          'success'
        );
      }

      return { ok: true, updated: localChanged };
    } catch (e) {
      const errMsg = (e && e.message) ? e.message : 'Sync error';
      updateStatus({ state: 'error', lastError: errMsg });
      if (!silent && window.AppUI) {
        window.AppUI.showToast((isAr() ? 'خطأ بالمزامنة: ' : 'Sync error: ') + errMsg, 'danger');
      }
      return { ok: false, error: errMsg };
    } finally {
      syncInFlight = false;
      if (queuedSync) {
        const nextSilent = queuedSilent;
        queuedSync = false;
        queuedSilent = true;
        setTimeout(() => {
          syncNow(nextSilent).then((res) => {
            if (res && res.updated && window.StudyApp && window.StudyApp.renderAll) {
              window.StudyApp.renderAll();
            }
          });
        }, 250);
      }
    }
  }

  async function ensureReadyAndSync(silent = true) {
    if (!isConfigured() || navigator.onLine === false) return { ok: false };
    try {
      const hadUid = !!localStorage.getItem('study_tracker_google_uid');
      if (!currentUser && !hadUid) return { ok: false };
      await ensureInit();
      if (currentUser) {
        return await syncNow(silent);
      }
    } catch (e) {}
    return { ok: false };
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

    signingIn = true;
    try {
      if (!auth) {
        if (window.AppUI) {
          window.AppUI.showToast(isAr() ? 'جاري تجهيز اتصال Google...' : 'Preparing Google Sign-In...', 'info');
        }
        await ensureInit();
      }
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let cred = null;
      try {
        cred = await auth.signInWithPopup(provider);
      } catch (popupErr) {
        const code = popupErr && popupErr.code;
        // Fallback to redirect only when popup is unsupported/blocked in standalone environments
        if (code === 'auth/operation-not-supported-in-this-environment' || (code === 'auth/popup-blocked' && isIOSStandalone())) {
          try { sessionStorage.setItem('study_tracker_google_redirect', '1'); } catch (e) {}
          await auth.signInWithRedirect(provider);
          return { ok: true, redirecting: true };
        }
        throw popupErr;
      }

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
        msg = isAr()
          ? 'المتصفح منع النافذة المنبثقة — اسمح بالنوافذ المنبثقة أو اضغط الزر مرة ثانية'
          : 'Popup blocked — allow popups or tap the button once more';
      } else if (e && e.code === 'auth/unauthorized-domain') {
        msg = isAr()
          ? 'أضف نطاق الموقع إلى Authorized domains في Firebase'
          : 'Add this domain to Authorized domains in Firebase';
      }
      if (window.AppUI) {
        window.AppUI.showToast((isAr() ? 'تعذر تسجيل الدخول: ' : 'Sign-in failed: ') + msg, 'danger');
      }
      return { ok: false, error: msg };
    } finally {
      signingIn = false;
    }
  }

  async function signOut() {
    try {
      if (pushDebounce) {
        clearTimeout(pushDebounce);
        pushDebounce = null;
      }
      pendingPush = false;
      queuedSync = false;
      if (auth) await auth.signOut();
      currentUser = null;
      try {
        localStorage.removeItem('study_tracker_google_uid');
        sessionStorage.removeItem('study_tracker_google_redirect');
      } catch (e) {}
      updateStatus({ state: 'idle', lastSyncedAt: null, lastError: '' });
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

  // Pre-initialize Firebase SDK right away when online so signInWithPopup preserves User Gesture
  if (typeof window !== 'undefined') {
    const bootInit = () => {
      try {
        if (isConfigured() && navigator.onLine !== false) {
          ensureInit().catch(() => {});
        }
      } catch (e) {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(bootInit, 50), { once: true });
    } else {
      setTimeout(bootInit, 50);
    }

    // Re-initialize & flush pending changes when connectivity returns
    window.addEventListener('online', () => {
      if (!isConfigured()) return;
      ensureInit().then(() => {
        if (currentUser && pendingPush) {
          syncNow(true);
        }
      }).catch(() => {});
    });
  }

  return {
    isConfigured,
    getUser,
    signIn,
    signOut,
    syncNow,
    onLocalSave,
    ensureReadyAndSync
  };
})();