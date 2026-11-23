/**
 * app.js — Main entry point: instant boot, bilingual EN/AR toggle, header sync indicator,
 * auto-sync on resume/online + 10s Focus polling, 6-tab navigation
 */
window.StudyApp = (function() {
  const TABS = [
    { id: 'focus', key: 'tab_focus', icon: '📚' },
    { id: 'tasks', key: 'tab_tasks', icon: '✅' },
    { id: 'habits', key: 'tab_habits', icon: '🔥' },
    { id: 'stats', key: 'tab_stats', icon: '📈' },
    { id: 'challenge', key: 'tab_challenge', icon: '🏆' },
    { id: 'settings', key: 'tab_settings', icon: '⚙️' }
  ];
  
  let lastHeaderSig = "";
  let lastNavLang = "";
  
  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }
  
  function renderHeader() {
    const today = window.LedgerEngine.getTodaySummary();
    const isDark = window.AppState.getIsDark();
    const syncCfg = window.AppState.getSyncConfig();
    const syncStatus = window.AppState.getSyncStatus();
    const hasSync = !!syncCfg.token;
    const isAr = window.I18n && window.I18n.isRTL();
    const hUnit = t('hrs');
    
    const titleEl = document.getElementById('app-header-title');
    if (titleEl) titleEl.textContent = t('appTitle');
    
    const syncIcon = syncStatus.state === 'syncing' ? '🔄' : (syncStatus.state === 'error' ? '⚠️' : '☁️');
    const syncBtnHtml = hasSync ?
      `<button id="header-sync-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm" title="${window.AppUI.escapeHtml(t('syncNowTitle'))}">${syncIcon}</button>` :
      '';
    
    const headerSig = `${today.logged}|${today.target}|${isDark}|${hasSync}|${syncStatus.state}|${isAr}`;
    if (headerSig === lastHeaderSig) return;
    lastHeaderSig = headerSig;
    
    const headerEl = document.getElementById('app-header-meta');
    if (headerEl) {
      headerEl.innerHTML = `
        <span class="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold">
          ${t('todayShort')}: ${window.AppUI.formatHours(today.logged)}/${window.AppUI.formatHours(today.target)}${hUnit}
        </span>
        ${syncBtnHtml}
        <button id="lang-toggle-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[11px] font-extrabold text-slate-700 dark:text-slate-200" title="${window.AppUI.escapeHtml(t('toggleLangTitle'))}">
          ${isAr ? 'EN' : 'ع'}
        </button>
        <button id="theme-toggle-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm" title="${window.AppUI.escapeHtml(t('toggleThemeTitle'))}">
          ${isDark ? '☀️' : '🌙'}
        </button>
      `;
      
      const syncBtn = document.getElementById('header-sync-btn');
      if (syncBtn) {
        syncBtn.onclick = async () => {
          const res = await window.AppState.syncNow(false);
          if (res && res.updated) renderAll();
        };
      }
      
      const langBtn = document.getElementById('lang-toggle-btn');
      if (langBtn) {
        langBtn.onclick = () => {
          window.I18n.toggleLang();
          window.AppState.markLedgerDirty();
          renderAll();
        };
      }
      
      const btn = document.getElementById('theme-toggle-btn');
      if (btn) {
        btn.onclick = () => {
          window.AppState.toggleTheme();
          renderHeader();
        };
      }
    }
  }
  
  function renderNav() {
    const active = window.AppState.getActiveTab();
    const navEl = document.getElementById('app-bottom-nav');
    if (!navEl) return;
    
    const curLang = window.I18n ? (window.I18n.isRTL() ? 'ar' : 'en') : 'en';
    if (!navEl.children.length || lastNavLang !== curLang) {
      lastNavLang = curLang;
      navEl.innerHTML = TABS.map(tab => `
        <button type="button" data-tab-id="${tab.id}"
          class="flex-1 py-2 px-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition text-slate-500 dark:text-slate-400">
          <span class="text-base leading-none">${tab.icon}</span>
          <span>${t(tab.key)}</span>
        </button>
      `).join('');
      
      navEl.querySelectorAll('[data-tab-id]').forEach(btn => {
        btn.onclick = () => {
          const nextTab = btn.getAttribute('data-tab-id');
          if (nextTab === window.AppState.getActiveTab()) return;
          window.AppState.setActiveTab(nextTab);
          renderNav();
          renderMain(true);
          window.scrollTo(0, 0);
        };
      });
    }
    
    navEl.querySelectorAll('[data-tab-id]').forEach(btn => {
      const isAct = btn.getAttribute('data-tab-id') === active;
      btn.classList.toggle('text-indigo-600', isAct);
      btn.classList.toggle('dark:text-indigo-400', isAct);
      btn.classList.toggle('font-bold', isAct);
      btn.classList.toggle('text-slate-500', !isAct);
      btn.classList.toggle('dark:text-slate-400', !isAct);
    });
  }
  
  function renderMain(animate = false) {
    const active = window.AppState.getActiveTab();
    const mainEl = document.getElementById('app-main');
    if (!mainEl) return;
    
    if (animate) {
      mainEl.classList.remove('tab-animate');
      requestAnimationFrame(() => mainEl.classList.add('tab-animate'));
    }
    
    let html = '';
    if (active === 'focus') html = window.FocusModule.render();
    else if (active === 'tasks') html = window.TasksModule.render();
    else if (active === 'habits') html = window.HabitsModule.render();
    else if (active === 'stats') html = window.StatsModule.render();
    else if (active === 'challenge') html = window.ChallengeModule.render();
    else if (active === 'settings') html = window.SettingsModule.render();
    
    mainEl.innerHTML = html;
    
    if (active === 'focus') window.FocusModule.bindEvents(renderAll);
    else if (active === 'tasks') window.TasksModule.bindEvents(renderAll);
    else if (active === 'habits') window.HabitsModule.bindEvents(renderAll);
    else if (active === 'stats') window.StatsModule.bindEvents(renderAll);
    else if (active === 'challenge') window.ChallengeModule.bindEvents(renderAll);
    else if (active === 'settings') window.SettingsModule.bindEvents(renderAll);
  }
  
  function renderAll(animate = false) {
    renderHeader();
    renderMain(animate);
    renderNav();
  }
  
  function isUserEditingOrModalOpen() {
    const backdrop = document.getElementById('app-modal-backdrop');
    if (backdrop && !backdrop.classList.contains('hidden')) return true;
    const el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'));
  }
  
  async function runBackgroundSync() {
    try {
      const cfg = window.AppState.getSyncConfig();
      if (!cfg.token) return;
      const res = await window.AppState.syncNow(true);
      if (res && res.ok && res.updated) {
        if (!isUserEditingOrModalOpen()) {
          renderAll();
        } else {
          renderHeader();
        }
        window.AppUI.showToast(t('syncedLatest'), 'success');
      }
    } catch (e) {}
  }
  
  function loadOptionalEnhancementsInBackground() {
    setTimeout(() => {
      runBackgroundSync();
      
      try {
        const isTelegramEnv = /Telegram/i.test(navigator.userAgent || '') ||
          (window.location && /tgWebApp/i.test(window.location.hash + window.location.search));
        if (isTelegramEnv && !(window.Telegram && window.Telegram.WebApp)) {
          const tgScript = document.createElement('script');
          tgScript.src = 'https://telegram.org/js/telegram-web-app.js';
          tgScript.async = true;
          tgScript.onload = () => {
            window.AppState.initThemeAndTelegram();
            renderHeader();
          };
          document.head.appendChild(tgScript);
        }
      } catch (e) {}
    }, 120);
  }
  
  function init() {
    window.AppState.initThemeAndTelegram();
    window.AppState.load();
    if (window.PushManagerClient) window.PushManagerClient.registerServiceWorker();
    
    const modalBackdrop = document.getElementById('app-modal-backdrop');
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) window.AppUI.closeModal();
      });
    }
    
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        runBackgroundSync();
      }
    });
    window.addEventListener('online', () => {
      runBackgroundSync();
    });
    
    setInterval(() => {
      if (document.visibilityState === 'visible' && window.AppState.getActiveTab() === 'focus') {
        runBackgroundSync();
      }
    }, 60000);
    
    renderAll();
    loadOptionalEnhancementsInBackground();
  }
  
  return {
    init,
    renderAll,
    renderHeader
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.StudyApp.init());
} else {
  window.StudyApp.init();
}