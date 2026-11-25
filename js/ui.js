/**
 * ui.js — UI helpers, toasts, custom modals, info buttons (ⓘ), Web Audio chime, and browser notifications
 */
window.AppUI = (function () {
  let audioCtx = null;

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatHours(h) {
    const num = Math.round((Number(h) || 0) * 100) / 100;
    return Number.isInteger(num) ? `${num}` : num.toFixed(1);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return window.I18n && window.I18n.isRTL() ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
  }

  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }

  function playChime() {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      // Warm bell-like ascending triad + octave shimmer
      const notes = [
        { f: 523.25, t: 0.00, dur: 0.55, vol: 0.14 },
        { f: 659.25, t: 0.11, dur: 0.58, vol: 0.14 },
        { f: 783.99, t: 0.22, dur: 0.65, vol: 0.15 },
        { f: 1046.50, t: 0.34, dur: 0.85, vol: 0.12 }
      ];
      notes.forEach(n => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.f, now + n.t);
        gain.gain.setValueAtTime(0.0008, now + n.t);
        gain.gain.exponentialRampToValueAtTime(n.vol, now + n.t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + n.t + n.dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + n.t);
        osc.stop(now + n.t + n.dur + 0.04);
      });
    } catch (e) {}
  }

  async function requestNotificationPermission() {
    if (typeof window.Notification === 'undefined') {
      showToast(t('notifNotSupported'), 'warning');
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      const granted = perm === 'granted';
      const data = window.AppState.getData();
      data.settings.notificationsEnabled = granted;
      window.AppState.save();
      if (granted) {
        showToast(t('notifEnabled'), 'success');
      } else {
        showToast(t('notifDenied'), 'warning');
      }
      return granted;
    } catch (e) {
      showToast(t('notifError'), 'warning');
      return false;
    }
  }

  function sendSessionNotification(title, body) {
    const data = window.AppState.getData();
    const settings = data.settings || { soundEnabled: true, notificationsEnabled: false };

    if (settings.soundEnabled) {
      playChime();
    }
    try {
      if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    } catch (e) {}

    if (settings.notificationsEnabled && typeof window.Notification !== 'undefined' && Notification.permission === 'granted') {
      if (window.PushManagerClient && typeof window.PushManagerClient.showLocalNotification === 'function') {
        window.PushManagerClient.showLocalNotification(title, body);
      } else {
        try {
          new Notification(title, { body });
        } catch (e) {}
      }
    }
  }

  let toastTimer = null;
  let toastHideTimer = null;
  function showToast(message, type = 'info') {
    const el = document.getElementById('app-toast');
    if (!el) return;
    const styles = {
      info:    { accent: '#4f46e5', icon: '✦' },
      success: { accent: '#10b981', icon: '✓' },
      warning: { accent: '#f59e0b', icon: '!' },
      danger:  { accent: '#f43f5e', icon: '✕' }
    };
    const cfg = styles[type] || styles.info;
    if (toastTimer) clearTimeout(toastTimer);
    if (toastHideTimer) clearTimeout(toastHideTimer);

    el.className = 'glass-toast';
    el.innerHTML = `
      <div class="glass-toast-row">
        <span class="glass-toast-icon" style="background:${cfg.accent}">${cfg.icon}</span>
        <span class="glass-toast-msg">${escapeHtml(message)}</span>
      </div>
      <div class="glass-toast-bar" style="background:${cfg.accent}"></div>
    `;
    el.onclick = () => {
      if (toastTimer) clearTimeout(toastTimer);
      if (toastHideTimer) clearTimeout(toastHideTimer);
      el.classList.remove('toast-visible');
      toastHideTimer = setTimeout(() => el.classList.add('hidden'), 220);
    };

    requestAnimationFrame(() => {
      el.classList.add('toast-visible');
    });

    toastTimer = setTimeout(() => {
      el.classList.remove('toast-visible');
      toastHideTimer = setTimeout(() => el.classList.add('hidden'), 260);
    }, 3000);
  }

  function openModal({ title, bodyHtml, footerHtml = '' }) {
    const backdrop = document.getElementById('app-modal-backdrop');
    const titleEl = document.getElementById('app-modal-title');
    const bodyEl = document.getElementById('app-modal-body');
    const footerEl = document.getElementById('app-modal-footer');
    if (!backdrop) return;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = footerHtml;
    backdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const backdrop = document.getElementById('app-modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const backdrop = document.getElementById('app-modal-backdrop');
      if (backdrop && !backdrop.classList.contains('hidden')) closeModal();
    }
  });

  function infoButtonHtml(id) {
    return `<button type="button" id="${escapeHtml(id)}" aria-label="Info" class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[11px] font-bold inline-flex items-center justify-center hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition shrink-0">ⓘ</button>`;
  }

  function showInfo(title, bodyHtml) {
    openModal({
      title,
      bodyHtml: `<div class="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${bodyHtml}</div>`,
      footerHtml: `<button id="info-modal-ok" class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white">${escapeHtml(t('gotIt'))}</button>`
    });
    const okBtn = document.getElementById('info-modal-ok');
    if (okBtn) okBtn.onclick = closeModal;
  }

  function confirmAction({ title, message, confirmText, danger = false, onConfirm }) {
    const okLabel = confirmText || t('confirm');
    openModal({
      title,
      bodyHtml: `<p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${escapeHtml(message)}</p>`,
      footerHtml: `
        <button id="modal-cancel-btn" class="px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">${escapeHtml(t('cancel'))}</button>
        <button id="modal-confirm-btn" class="px-4 py-2 rounded-xl text-sm font-medium text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}">${escapeHtml(okLabel)}</button>
      `
    });
    document.getElementById('modal-cancel-btn').onclick = closeModal;
    document.getElementById('modal-confirm-btn').onclick = () => {
      closeModal();
      if (typeof onConfirm === 'function') onConfirm();
    };
  }

  function getTagById(tagId) {
    const tags = window.AppState.getData().tags;
    return tags.find(t => t.id === tagId) || tags[0];
  }

  function getSubjectById(subjId) {
    if (!subjId) return null;
    const subjects = window.AppState.getData().subjects;
    return subjects.find(s => s.id === subjId) || null;
  }

  return {
    escapeHtml,
    formatHours,
    formatDate,
    formatDateAr: formatDate,
    unlockAudio,
    playChime,
    requestNotificationPermission,
    sendSessionNotification,
    showToast,
    openModal,
    closeModal,
    infoButtonHtml,
    showInfo,
    confirmAction,
    getTagById,
    getSubjectById
  };
})();
