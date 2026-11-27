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
  const PRE_SYNC_BACKUP_KEY = 'study_tracker_pre_sync_backup_v1';
  const LAST_SYNCED_SIG_KEY = 'study_tracker_last_synced_sig_v1';
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
            if (window.GroupsModule && window.GroupsModule.onAuthReady) {
              window.GroupsModule.onAuthReady(currentUser);
            }
            if (prevUid !== currentUser.uid && window.StudyApp) {
              const tab = window.AppState ? window.AppState.getActiveTab() : 'focus';
              if ((tab === 'settings' || tab === 'hall' || tab === 'profile') && window.StudyApp.renderAll) {
                window.StudyApp.renderAll();
              } else if (window.StudyApp.renderHeader) {
                window.StudyApp.renderHeader();
              }
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
            if (window.GroupsModule && window.GroupsModule.onSignOut) {
              window.GroupsModule.onSignOut();
            }
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

  let cachedSnapTs = -1;
  let cachedSnapStr = '';
  function stableSnapshot(obj, useCache = false) {
    try {
      const ts = Number(obj && obj.updatedAt) || 0;
      if (useCache && ts > 0 && ts === cachedSnapTs && cachedSnapStr) return cachedSnapStr;
      const copy = JSON.parse(JSON.stringify(obj || {}));
      delete copy.updatedAt;
      const str = JSON.stringify(copy);
      if (useCache && ts > 0) { cachedSnapTs = ts; cachedSnapStr = str; }
      return str;
    } catch (e) {
      return '';
    }
  }

  function countStudyWeight(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    const books = Array.isArray(obj.books) ? obj.books.length : 0;
    const logs = obj.dailyLogs ? Object.keys(obj.dailyLogs).filter(k => (Number(obj.dailyLogs[k] && obj.dailyLogs[k].hours) || 0) > 0).length : 0;
    const revs = obj.reviews ? Object.keys(obj.reviews).length : 0;
    return books + logs + revs;
  }

  function saveLocalPreSyncBackup(dataObj) {
    if (countStudyWeight(dataObj) <= 0) return;
    try {
      localStorage.setItem(PRE_SYNC_BACKUP_KEY, JSON.stringify({
        savedAt: Date.now(),
        data: dataObj
      }));
    } catch (e) {}
  }

  function getLocalPreSyncBackup() {
    try {
      const raw = localStorage.getItem(PRE_SYNC_BACKUP_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && countStudyWeight(parsed.data) > 0) return parsed;
    } catch (e) {}
    return null;
  }

  async function restoreLocalPreSyncBackup() {
    const bak = getLocalPreSyncBackup();
    if (!bak || !bak.data) return { ok: false, error: isAr() ? 'لا توجد نسخة احتياطية محلية قبل المزامنة' : 'No local pre-sync backup found' };
    window.AppState.replaceData(bak.data, true, true);
    if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
    return { ok: true };
  }

  async function restoreCloudBackup() {
    try {
      await ensureInit();
      if (!currentUser || !db) return { ok: false, error: isAr() ? 'سجّل الدخول بحساب Google أولاً' : 'Sign in with Google first' };
      const snap = await db.collection('users').doc(currentUser.uid).get();
      if (!snap.exists) return { ok: false, error: isAr() ? 'لا توجد نسخة سحابية محفوظة' : 'No cloud backup found' };
      const doc = snap.data() || {};
      const bak = doc.lastBackup && doc.lastBackup.payload;
      if (!bak || countStudyWeight(bak) <= 0) {
        return { ok: false, error: isAr() ? 'لا توجد نسخة سحابية سابقة تحتوي على بيانات' : 'No previous cloud backup with study data found' };
      }
      saveLocalPreSyncBackup(window.AppState.getData());
      window.AppState.replaceData(bak, true, true);
      if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
      return { ok: true, savedAt: doc.lastBackup.savedAt || 0 };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : 'Restore failed' };
    }
  }

  function getLastSyncedSig() {
    try {
      const raw = localStorage.getItem(LAST_SYNCED_SIG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setLastSyncedSig(uid, sig) {
    try {
      localStorage.setItem(LAST_SYNCED_SIG_KEY, JSON.stringify({ uid, sig, at: Date.now() }));
    } catch (e) {}
  }

  async function writeCloudPayload(payload, prevRemoteData = null, prevBackup = null) {
    const docData = {
      payload,
      updatedAt: payload.updatedAt,
      email: currentUser.email || ''
    };
    if (prevRemoteData && countStudyWeight(prevRemoteData) > 0) {
      docData.lastBackup = {
        savedAt: Date.now(),
        payload: prevRemoteData
      };
    } else if (prevBackup) {
      docData.lastBackup = prevBackup;
    }
    // Atomic write (no deep-merge into payload) so old deleted keys never corrupt payload
    await db.collection('users').doc(currentUser.uid).set(docData);
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
      // Always prefer live server read so a new device never sees a stale/empty cache
      const snap = await docRef.get({ source: 'server' }).catch(() => docRef.get());
      const localData = window.AppState.getData();
      const localSnap = stableSnapshot(localData, true);
      const localWeight = countStudyWeight(localData);

      let merged = localData;
      let remoteExists = false;
      let remoteSnap = '';
      let remoteDataObj = null;
      let prevCloudBackup = null;
      const explicitReset = !!(typeof window !== 'undefined' && window.__studyTrackerExplicitReset);

      if (snap.exists) {
        const remoteDoc = snap.data() || {};
        prevCloudBackup = remoteDoc.lastBackup || null;
        const remoteData = remoteDoc.payload;
        if (remoteData && typeof remoteData === 'object') {
          remoteExists = true;
          remoteDataObj = remoteData;
          remoteSnap = stableSnapshot(remoteData);
        }
      }

      const remoteWeight = countStudyWeight(remoteDataObj);
      const lastSynced = getLastSyncedSig();
      const sameAccountBase = !!(lastSynced && lastSynced.uid === currentUser.uid && lastSynced.sig);

      // Already 100% identical — nothing to write or ask
      if (remoteExists && localSnap === remoteSnap) {
        setLastSyncedSig(currentUser.uid, localSnap);
        pendingPush = false;
        updateStatus({ state: 'ok', lastSyncedAt: Date.now(), lastError: '' });
        if (!silent && window.AppUI) {
          window.AppUI.showToast(isAr() ? 'بياناتك متطابقة ومحدّثة ☁️' : 'Already synced & up to date ☁️', 'success');
        }
        return { ok: true, updated: false };
      }

      // Always auto-merge seamlessly without interrupting the user with a choice modal
      const localDiverged = sameAccountBase ? (localSnap !== lastSynced.sig) : (localWeight > 0);
      const remoteDiverged = sameAccountBase ? (remoteSnap !== lastSynced.sig) : (remoteWeight > 0);

      if (remoteExists) {
        if (explicitReset) {
          merged = localData;
        } else if (sameAccountBase && !localDiverged && remoteDiverged) {
          merged = remoteDataObj;
        } else if (sameAccountBase && localDiverged && !remoteDiverged) {
          merged = localData;
        } else if (typeof window.AppState.mergeData === 'function') {
          merged = window.AppState.mergeData(localData, remoteDataObj);
        } else {
          const localTs = Number(localData.updatedAt) || 0;
          const remoteTs = Number(remoteDataObj.updatedAt) || 0;
          merged = remoteTs > localTs ? remoteDataObj : localData;
        }
      }

      // Anti-Wipe Guard
      let mergedWeight = countStudyWeight(merged);
      if (!explicitReset && mergedWeight === 0 && (remoteWeight > 0 || localWeight > 0)) {
        merged = remoteWeight >= localWeight ? remoteDataObj : localData;
        mergedWeight = countStudyWeight(merged);
      }

      const mergedSnap = stableSnapshot(merged);
      const localChanged = mergedSnap !== localSnap;
      const remoteChanged = !remoteExists || mergedSnap !== remoteSnap || pendingPush;

      if (localChanged) {
        saveLocalPreSyncBackup(localData);
        window.AppState.replaceData(merged, false, true);
      }

      if (remoteChanged) {
        const payload = JSON.parse(JSON.stringify(window.AppState.getData()));
        const payloadWeight = countStudyWeight(payload);
        if (explicitReset || payloadWeight > 0 || remoteWeight === 0) {
          payload.updatedAt = Math.max(Number(payload.updatedAt) || 0, Date.now());
          window.AppState.getData().updatedAt = payload.updatedAt;
          window.AppState.save(false, true);
          await writeCloudPayload(payload, remoteDataObj, prevCloudBackup);
          if (explicitReset && typeof window !== 'undefined') window.__studyTrackerExplicitReset = false;
        }
      }

      setLastSyncedSig(currentUser.uid, stableSnapshot(window.AppState.getData()));
      if (localChanged && window.StudyApp && window.StudyApp.renderAll) {
        window.StudyApp.renderAll();
      }

      pendingPush = false;
      updateStatus({ state: 'ok', lastSyncedAt: Date.now(), lastError: '' });
      if (window.GroupsModule && window.GroupsModule.syncMyPresence) {
        window.GroupsModule.syncMyPresence(false);
      }

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
        localStorage.removeItem(LAST_SYNCED_SIG_KEY);
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

  async function ensureReady() {
    if (!isConfigured()) return null;
    await ensureInit();
    return { auth, db, user: currentUser };
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
    const scheduleBoot = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => setTimeout(bootInit, 900), { timeout: 2200 });
      } else {
        setTimeout(bootInit, 1600);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
    } else {
      scheduleBoot();
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
    ensureReadyAndSync,
    ensureReady,
    getLocalPreSyncBackup,
    restoreLocalPreSyncBackup,
    restoreCloudBackup
  };
})();