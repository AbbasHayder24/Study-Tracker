/**
 * google-sync.js — 1-Tap Google Account Sign-In & Cloud Sync via Firebase (Auth + Firestore)
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
    window.AppState.save = function (triggerSync = true, immediate = false) {
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

  function safeMergeById(localArr, remoteArr, deletedSet) {
    const map = new Map();
    (Array.isArray(localArr) ? localArr : []).forEach(item => {
      if (item && item.id && !deletedSet.has(item.id)) map.set(item.id, item);
    });
    (Array.isArray(remoteArr) ? remoteArr : []).forEach(item => {
      if (!item || !item.id || deletedSet.has(item.id)) return;
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, item);
      } else {
        const eTs = Number(existing.updatedAt || 0);
        const rTs = Number(item.updatedAt || 0);
        if (rTs > eTs) map.set(item.id, item);
      }
    });
    return Array.from(map.values());
  }

  function safeMergeData(local, remote) {
    const deletedSet = new Set([
      ...(Array.isArray(local.deletedIds) ? local.deletedIds : []),
      ...(Array.isArray(remote.deletedIds) ? remote.deletedIds : [])
    ]);
    const localNewer = (Number(local.updatedAt) || 0) >= (Number(remote.updatedAt) || 0);
    const mergedLogs = { ...(remote.dailyLogs || {}), ...(local.dailyLogs || {}) };
    Object.keys(mergedLogs).forEach(iso => {
      const l = local.dailyLogs && local.dailyLogs[iso];
      const r = remote.dailyLogs && remote.dailyLogs[iso];
      if (l && r) {
        const lTs = Number(l.updatedAt || 0);
        const rTs = Number(r.updatedAt || 0);
        mergedLogs[iso] = rTs > lTs ? r : l;
      }
    });
    const mergedHabits = safeMergeById(local.habits, remote.habits, deletedSet).map(h => {
      const lh = (local.habits || []).find(x => x && x.id === h.id);
      const rh = (remote.habits || []).find(x => x && x.id === h.id);
      if (lh && rh) {
        return { ...h, completions: { ...(rh.completions || {}), ...(lh.completions || {}) } };
      }
      return h;
    });
    return {
      ...(localNewer ? remote : local),
      ...(localNewer ? local : remote),
      deletedIds: Array.from(deletedSet),
      settings: localNewer
        ? { ...(remote.settings || {}), ...(local.settings || {}) }
        : { ...(local.settings || {}), ...(remote.settings || {}) },
      subjects: safeMergeById(local.subjects, remote.subjects, deletedSet),
      tags: safeMergeById(local.tags, remote.tags, deletedSet),
      books: safeMergeById(local.books, remote.books, deletedSet),
      tasks: safeMergeById(local.tasks, remote.tasks, deletedSet),
      habits: mergedHabits,
      dailyLogs: mergedLogs,
      reviews: { ...(remote.reviews || {}), ...(local.reviews || {}) },
      resolvedPenalties: { ...(remote.resolvedPenalties || {}), ...(local.resolvedPenalties || {}) },
      updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0, Date.now())
    };
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
        if (remoteData && typeof remoteData === 'object') {
          const merged = safeMergeData(localData, remoteData);
          const localStr = JSON.stringify(localData);
          const mergedStr = JSON.stringify(merged);
          const remoteStr = JSON.stringify(remoteData);
          let updatedLocal = false;
          if (mergedStr !== localStr) {
            window.AppState.replaceData(merged, false);
            updatedLocal = true;
          }
          if (mergedStr !== remoteStr) {
            await pushToCloud(silent);
          } else if (!silent && window.AppUI) {
            window.AppUI.showToast(isAr() ? 'تمت المزامنة مع حساب Google' : 'Synced with Google', 'success');
          }
          lastSyncTime = Date.now();
          return { ok: true, updated: updatedLocal };
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
      await ensureInit();
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      try {
        if (isStandalone) {
          try { sessionStorage.setItem('study_tracker_google_redirect', '1'); } catch (e) {}
          await auth.signInWithRedirect(provider);
          return { ok: true, redirecting: true };
        }
        const cred = await auth.signInWithPopup(provider);
        if (cred && cred.user) currentUser = cred.user;
        return { ok: true };
      } catch (popErr) {
        if (popErr && (popErr.code === 'auth/popup-blocked' || popErr.code === 'auth/operation-not-supported-in-this-environment')) {
          try { sessionStorage.setItem('study_tracker_google_redirect', '1'); } catch (e) {}
          await auth.signInWithRedirect(provider);
          return { ok: true, redirecting: true };
        }
        throw popErr;
      }
    } catch (e) {
      if (window.AppUI) {
        window.AppUI.showToast((isAr() ? 'تعذر تسجيل الدخول: ' : 'Sign-in failed: ') + (e.message || ''), 'danger');
      }
      return { ok: false, error: e.message };
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
