/**
 * push.js — PWA Service Worker registration & Cloudflare Worker Web Push scheduler
 * Pre-configured with the default Study Tracker Worker URL so all users can enable
 * background push notifications in one tap without manual setup.
 */
window.PushManagerClient = (function () {
  const DEFAULT_WORKER_URL = 'https://study-tracker.study-tracker2.workers.dev';
  const WORKER_URL_KEY = 'study_tracker_push_worker_url';
  const PUSH_META_CACHE = 'study-tracker-push-meta-v1';
  const PUSH_META_URL = './__study_tracker_push_meta__';

  let swRegPromise = null;

  function normalizeWorkerUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function getWorkerUrl() {
    return DEFAULT_WORKER_URL;
  }

  function setWorkerUrl(url) {
    const clean = normalizeWorkerUrl(url) || DEFAULT_WORKER_URL;
    try {
      localStorage.setItem(WORKER_URL_KEY, clean);
    } catch (e) {}
    try {
      if (window.AppState) {
        const data = window.AppState.getData();
        if (!data.settings) data.settings = {};
        data.settings.pushWorkerUrl = clean;
        window.AppState.save();
      }
    } catch (e) {}
    return clean;
  }

  function isSupported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function isStandalonePWA() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!swRegPromise) {
      swRegPromise = navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => navigator.serviceWorker.ready.then(() => reg))
        .catch(() => null);
    }
    return swRegPromise;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const out = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      out[i] = rawData.charCodeAt(i);
    }
    return out;
  }

  async function savePushMeta(title, body) {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(PUSH_META_CACHE);
      const res = new Response(JSON.stringify({ title, body, updatedAt: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put(PUSH_META_URL, res);
    } catch (e) {}
  }

  async function getActiveSubscription() {
    if (!isSupported()) return null;
    try {
      const reg = await registerServiceWorker();
      if (!reg || !reg.pushManager) return null;
      return await reg.pushManager.getSubscription();
    } catch (e) {
      return null;
    }
  }

  async function subscribe(workerUrlInput) {
    const t = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);

    if (isIOS() && !isStandalonePWA()) {
      return { ok: false, error: t('pushIosNeedHomeScreen') };
    }
    if (!isSupported()) {
      return { ok: false, error: t('notifNotSupported') };
    }

    const workerUrl = setWorkerUrl(workerUrlInput || getWorkerUrl());
    if (!workerUrl || !/^https?:\/\//i.test(workerUrl)) {
      return { ok: false, error: t('pushNeedWorkerUrl') };
    }

    // Request notification permission directly inside the user gesture (required by iOS Safari)
    let perm = Notification.permission;
    if (perm !== 'granted') {
      perm = await Notification.requestPermission();
    }
    if (perm !== 'granted') {
      return { ok: false, error: t('notifDenied') };
    }

    const reg = await registerServiceWorker();
    if (!reg || !reg.pushManager) {
      return { ok: false, error: t('pushSwFailed') };
    }

    let publicKey = '';
    try {
      const res = await fetch(`${workerUrl}/vapid-public-key`, { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      publicKey = json.publicKey || '';
    } catch (e) {
      return { ok: false, error: t('pushWorkerUnreachable') };
    }

    if (!publicKey) {
      return { ok: false, error: t('pushWorkerNoKey') };
    }

    try {
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          const existingKey = sub.options && sub.options.applicationServerKey;
          if (!existingKey) {
            await sub.unsubscribe();
            sub = null;
          }
        } catch (e) {}
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      const data = window.AppState.getData();
      data.settings.notificationsEnabled = true;
      data.settings.pushEnabled = true;
      data.settings.pushWorkerUrl = workerUrl;
      window.AppState.save();

      return { ok: true, subscription: sub };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : t('notifError') };
    }
  }

  async function unsubscribe() {
    try {
      await cancelTimerPush();
      const sub = await getActiveSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) {}
    try {
      const data = window.AppState.getData();
      data.settings.pushEnabled = false;
      window.AppState.save();
    } catch (e) {}
    return { ok: true };
  }

  async function scheduleTimerPush(delaySec, meta) {
    const workerUrl = getWorkerUrl();
    if (!workerUrl || !delaySec || delaySec <= 0) return false;
    const data = window.AppState && window.AppState.getData();
    if (data && data.settings && data.settings.pushEnabled === false) return false;

    const sub = await getActiveSubscription();
    if (!sub) return false;

    if (meta && (meta.title || meta.body)) {
      await savePushMeta(meta.title, meta.body);
    }

    const fireAt = Date.now() + Math.max(2, Math.round(delaySec)) * 1000;
    try {
      const res = await fetch(`${workerUrl}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          fireAt,
          sessionId: (meta && meta.sessionId) || ''
        })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function cancelTimerPush() {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) return false;
    const sub = await getActiveSubscription();
    if (!sub) return false;

    try {
      const res = await fetch(`${workerUrl}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function sendTestPush(delaySec = 5) {
    const t = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
    const workerUrl = getWorkerUrl();
    if (!workerUrl) return { ok: false, error: t('pushNeedWorkerUrl') };
    const sub = await getActiveSubscription();
    if (!sub) return { ok: false, error: t('pushNotSubscribed') };

    await savePushMeta(t('pushTestTitle'), t('pushTestBody'));

    try {
      const res = await fetch(`${workerUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          delaySec
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { ok: false, error: txt || ('HTTP ' + res.status) };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: t('pushWorkerUnreachable') };
    }
  }

  async function enableUnifiedNotifications() {
    const t = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
    const ar = !!(window.I18n && window.I18n.isRTL());

    if (typeof window.Notification === 'undefined') {
      return { ok: false, mode: 'none', error: t('notifNotSupported') };
    }

    // Request permission immediately inside user gesture
    let perm = Notification.permission;
    if (perm !== 'granted') {
      try {
        perm = await Notification.requestPermission();
      } catch (e) {
        return { ok: false, mode: 'none', error: t('notifError') };
      }
    }
    if (perm !== 'granted') {
      return { ok: false, mode: 'none', error: t('notifDenied') };
    }

    const data = window.AppState.getData();
    if (!data.settings) data.settings = {};
    data.settings.notificationsEnabled = true;

    // Try enabling Cloudflare background Web Push as part of the same 1-tap toggle
    if (isIOS() && !isStandalonePWA()) {
      data.settings.pushEnabled = false;
      window.AppState.save();
      return {
        ok: true,
        mode: 'local',
        note: ar
          ? 'تم تفعيل إشعارات التطبيق — لإشعارات الخلفية على iOS أضف التطبيق للشاشة الرئيسية'
          : 'App notifications enabled — add to Home Screen on iOS for background push'
      };
    }

    const pushRes = await subscribe(getWorkerUrl());
    if (pushRes && pushRes.ok) {
      return {
        ok: true,
        mode: 'unified',
        note: ar
          ? 'تم تفعيل إشعارات التطبيق والخلفية (Cloudflare) بنجاح 🔔'
          : 'App & background (Cloudflare) notifications enabled 🔔'
      };
    }

    // Graceful fallback: keep local notifications active if worker is offline/unreachable
    data.settings.pushEnabled = false;
    window.AppState.save();
    return {
      ok: true,
      mode: 'local',
      note: ar
        ? 'تم تفعيل إشعارات التطبيق (تعذر ربط إشعارات الخلفية حالياً)'
        : 'App notifications enabled (background push unavailable right now)'
    };
  }

  async function disableUnifiedNotifications() {
    await unsubscribe();
    try {
      const data = window.AppState.getData();
      if (data && data.settings) {
        data.settings.notificationsEnabled = false;
        data.settings.pushEnabled = false;
        window.AppState.save();
      }
    } catch (e) {}
    return { ok: true };
  }

  async function sendUnifiedTestNotification() {
    const t = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
    const ar = !!(window.I18n && window.I18n.isRTL());
    const data = window.AppState && window.AppState.getData();
    const pushOn = !!(data && data.settings && data.settings.pushEnabled);

    if (pushOn && navigator.onLine !== false) {
      const res = await sendTestPush(5);
      if (res && res.ok) {
        return {
          ok: true,
          mode: 'push',
          message: ar
            ? 'سيصلك إشعار اختبار عبر Cloudflare خلال 5 ثوانٍ (يمكنك إغلاق التطبيق للتجربة) 🔔'
            : 'Cloudflare test push scheduled in 5s (you can close the app to test) 🔔'
        };
      }
    }

    if (typeof window.Notification !== 'undefined' && Notification.permission === 'granted') {
      await showLocalNotification(t('pushTestTitle'), t('pushTestBody'));
      return {
        ok: true,
        mode: 'local',
        message: ar ? 'تم إرسال إشعار اختبار محلي 🔔' : 'Local test notification sent 🔔'
      };
    }

    return {
      ok: false,
      error: ar ? 'فعّل الإشعارات أولاً لتجربتها' : 'Enable notifications first to test'
    };
  }

  async function showLocalNotification(title, body) {
    try {
      const reg = await registerServiceWorker();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: './image.png',
          badge: './image.png',
          tag: 'study-tracker-timer',
          renotify: true
        });
        return true;
      }
    } catch (e) {}
    try {
      new Notification(title, { body, icon: './image.png' });
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    DEFAULT_WORKER_URL,
    registerServiceWorker,
    isSupported,
    isStandalonePWA,
    isIOS,
    getWorkerUrl,
    setWorkerUrl,
    getActiveSubscription,
    subscribe,
    unsubscribe,
    scheduleTimerPush,
    cancelTimerPush,
    sendTestPush,
    showLocalNotification,
    enableUnifiedNotifications,
    disableUnifiedNotifications,
    sendUnifiedTestNotification
  };
})();
