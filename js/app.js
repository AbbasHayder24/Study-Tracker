/**
 * app.js — Main entry point: lazy-loaded tab modules, scoped tab re-rendering,
 * bilingual EN/AR toggle, header sync indicator, auto-sync on resume/online, 6-tab navigation
 */
window.StudyApp = (function () {
  const ASSET_VER = '63';
  const TABS = [
    { id: 'focus', key: 'tab_focus', icon: '📚' },
    { id: 'hall', key: 'tab_hall', icon: '🏛️' },
    { id: 'stats', key: 'tab_stats', icon: '📈' },
    { id: 'challenge', key: 'tab_challenge', icon: '🎯' },
    { id: 'settings', key: 'tab_settings', icon: '⚙️' }
  ];

  // Each tab loads only the scripts it needs on first visit
  const TAB_SCRIPTS = {
    focus: ['js/bookshelf.js', 'js/groups.js', 'js/focus.js'],
    hall: ['js/groups.js', 'js/bookshelf.js', 'js/focus.js'],
    stats: ['js/stats.js'],
    challenge: ['js/reviews.js', 'js/challenge.js'],
    settings: ['js/reviews.js', 'js/challenge.js', 'js/settings.js']
  };

  const scriptPromises = {};
  let lastHeaderSig = "";
  let lastNavLang = "";
  let renderSeq = 0;

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function loadScriptOnce(path) {
    if (scriptPromises[path]) return scriptPromises[path];
    const url = `${path}?v=${ASSET_VER}`;
    scriptPromises[path] = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src^="${path}"]`);
      if (existing && existing.getAttribute('data-loaded') === '1') {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = () => {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = () => {
        delete scriptPromises[path];
        s.remove();
        reject(new Error('Failed to load ' + path));
      };
      document.head.appendChild(s);
    });
    return scriptPromises[path];
  }

  async function ensureTabLoaded(tabId) {
    const list = TAB_SCRIPTS[tabId] || [];
    for (const path of list) {
      await loadScriptOnce(path);
    }
    if (tabId === 'focus' && window.FocusModule && !window.FocusModule.__prefsBooted) {
      window.FocusModule.__prefsBooted = true;
      if (window.FocusModule.syncFromSettings) window.FocusModule.syncFromSettings();
    }
  }

  function renderHeader() {
    const today = window.LedgerEngine.getTodaySummary();
    const isDark = window.AppState.getIsDark();
    const syncStatus = window.AppState.getSyncStatus();
    const hasSync = !!(window.GoogleSync && window.GoogleSync.getUser());
    const isAr = window.I18n && window.I18n.isRTL();
    const hUnit = t('hrs');

    const titleEl = document.getElementById('app-header-title');
    if (titleEl) titleEl.textContent = t('appTitle');

    const syncIcon = syncStatus.state === 'syncing' ? '🔄' : (syncStatus.state === 'error' ? '⚠️' : '☁️');
    const syncBtnHtml = hasSync
      ? `<button id="header-sync-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm" title="${window.AppUI.escapeHtml(syncStatus.lastError || t('syncNowTitle'))}">${syncIcon}</button>`
      : '';

    const headerSig = `${today.logged}|${today.target}|${isDark}|${hasSync}|${syncStatus.state}|${isAr}`;
    if (headerSig === lastHeaderSig) return;
    lastHeaderSig = headerSig;

    const headerEl = document.getElementById('app-header-meta');
    if (headerEl) {
      headerEl.innerHTML = `
        <button id="header-daily-recap-btn" type="button" class="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold hover:opacity-85" title="${isAr ? 'خلاصة اليوم السريعة' : 'Quick Daily Recap'}">
          ✨ ${t('todayShort')}: ${window.AppUI.formatHours(today.logged)}/${window.AppUI.formatHours(today.target)}${hUnit}
        </button>
        ${syncBtnHtml}
        <button id="lang-toggle-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[11px] font-extrabold text-slate-700 dark:text-slate-200" title="${window.AppUI.escapeHtml(t('toggleLangTitle'))}">
          ${isAr ? 'EN' : 'ع'}
        </button>
        <button id="theme-toggle-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm" title="${window.AppUI.escapeHtml(t('toggleThemeTitle'))}">
          ${isDark ? '☀️' : '🌙'}
        </button>
      `;

      const recapBtn = document.getElementById('header-daily-recap-btn');
      if (recapBtn) {
        recapBtn.onclick = () => openDailyRecapModal();
      }

      const syncBtn = document.getElementById('header-sync-btn');
      if (syncBtn) {
        syncBtn.onclick = async () => {
          const res = window.GoogleSync ? await window.GoogleSync.syncNow(false) : null;
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
    const data = window.AppState.getData();
    const customPlanName = (data && data.settings && data.settings.challenge && data.settings.challenge.name)
      ? String(data.settings.challenge.name).trim()
      : '';
    const shortPlanName = customPlanName
      ? (customPlanName.length > 10 ? customPlanName.slice(0, 9) + '…' : customPlanName)
      : t('tab_challenge');
    const navSig = `${curLang}|${shortPlanName}`;
    if (!navEl.children.length || lastNavLang !== navSig) {
      lastNavLang = navSig;
      navEl.innerHTML = TABS.map(tab => `
        <button type="button" data-tab-id="${tab.id}"
          class="flex-1 py-2 px-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition text-slate-500 dark:text-slate-400">
          <span class="text-base leading-none">${tab.icon}</span>
          <span class="truncate max-w-[60px]">${tab.id === 'challenge' ? window.AppUI.escapeHtml(shortPlanName) : t(tab.key)}</span>
        </button>
      `).join('');

      navEl.querySelectorAll('[data-tab-id]').forEach(btn => {
        btn.onclick = () => {
          const nextTab = btn.getAttribute('data-tab-id');
          if (nextTab === window.AppState.getActiveTab()) return;
          window.AppState.setActiveTab(nextTab);
          renderNav();
          renderMain(true, false);
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

  const tabDirty = { focus: true, hall: true, stats: true, challenge: true, settings: true };
  const tabScrollY = {};
  let currentMountedTab = null;
  let lastDataUpdatedAt = 0;

  function markAllTabsDirty(exceptTab = null) {
    TABS.forEach(tb => {
      if (tb.id !== exceptTab) tabDirty[tb.id] = true;
    });
  }

  function ensureTabPanels(mainEl) {
    if (mainEl.querySelector('[data-tab-panel]')) return;
    mainEl.innerHTML = TABS.map(tb => `<div id="tab-panel-${tb.id}" data-tab-panel="${tb.id}" class="hidden"></div>`).join('');
  }

  function isModuleReady(tabId) {
    if (tabId === 'focus') return !!(window.FocusModule && window.BookshelfModule && window.GroupsModule);
    if (tabId === 'hall') return !!window.GroupsModule;
    if (tabId === 'stats') return !!window.StatsModule;
    if (tabId === 'challenge') return !!(window.ChallengeModule && window.ReviewsModule);
    if (tabId === 'settings') return !!(window.SettingsModule && window.ChallengeModule);
    return true;
  }

  // Scoped re-render: only rebuilds the active tab, and only marks other tabs dirty if state actually changed
  function renderActiveTabScoped(animate = false) {
    const active = window.AppState.getActiveTab();
    const nowTs = (window.AppState.getData() && window.AppState.getData().updatedAt) || 0;
    const curLang = window.I18n ? (window.I18n.isRTL() ? 'ar' : 'en') : 'en';
    if (nowTs !== lastDataUpdatedAt || curLang !== lastNavLang) {
      markAllTabsDirty(active);
      lastDataUpdatedAt = nowTs;
    }
    renderHeader();
    renderMain(animate, true);
    renderNav();
  }

  function openDailyRecapModal() {
    const ar = !!(window.I18n && window.I18n.isRTL());
    const data = window.AppState.getData();
    const today = window.LedgerEngine.getTodaySummary();
    const todayISO = today.todayISO;
    const todayBooks = (data.books || []).filter(b => b.date === todayISO && b.completed);
    const longestMin = todayBooks.reduce((mx, b) => Math.max(mx, Math.round(Number(b.minutes) || 0)), 0);

    const scoreMap = new Map();
    todayBooks.forEach(b => {
      const subj = b.subjectId ? window.AppUI.getSubjectById(b.subjectId) : null;
      const tag = window.AppUI.getTagById(b.tagId);
      const name = (subj && subj.name) || (tag && String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim()) || (ar ? 'دراسة' : 'Study');
      scoreMap.set(name, (scoreMap.get(name) || 0) + (Number(b.minutes) || 0));
    });
    let topFocus = '—';
    let topMins = 0;
    scoreMap.forEach((m, name) => {
      if (m > topMins) { topMins = m; topFocus = name; }
    });

    const pct = today.target > 0 ? Math.min(100, Math.round((today.logged / today.target) * 100)) : 0;
    const existingNote = (data.dailyLogs && data.dailyLogs[todayISO] && data.dailyLogs[todayISO].note) || '';
    const hUnit = t('hrs');

    window.AppUI.openModal({
      title: ar ? `✨ خلاصة اليوم (${window.AppUI.formatDate(todayISO)})` : `✨ Daily Recap (${window.AppUI.formatDate(todayISO)})`,
      bodyHtml: `
        <div class="space-y-3.5">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-900/30 border border-indigo-200/60 dark:border-indigo-800/50">
              <div class="text-[10px] text-slate-500 dark:text-slate-400">${ar ? 'مجموع اليوم' : 'Total Today'}</div>
              <div class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">${window.AppUI.formatHours(today.logged)}${hUnit}</div>
              <div class="text-[9px] text-slate-400">${pct}%</div>
            </div>
            <div class="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/50">
              <div class="text-[10px] text-slate-500 dark:text-slate-400">${ar ? 'أطول جلسة' : 'Longest'}</div>
              <div class="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">${longestMin}${t('minShort')}</div>
              <div class="text-[9px] text-slate-400">${todayBooks.length} ${t('booksWord')}</div>
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-900/30 border border-amber-200/60 dark:border-amber-800/50">
              <div class="text-[10px] text-slate-500 dark:text-slate-400">${ar ? 'أكثر تركيزاً' : 'Top Focus'}</div>
              <div class="text-xs font-extrabold text-amber-600 dark:text-amber-400 mt-1 truncate">${window.AppUI.escapeHtml(topFocus)}</div>
              <div class="text-[9px] text-slate-400">${topMins ? Math.round(topMins) + t('minShort') : '—'}</div>
            </div>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'ملاحظة سريعة عن إنجاز اليوم' : 'Quick note on today\'s progress'}</label>
            <input id="recap-daily-note" type="text" maxlength="140" value="${window.AppUI.escapeHtml(existingNote)}" placeholder="${ar ? 'مثال: أنهيت فصل القلبية بتركيز ممتاز...' : 'e.g. Finished cardiology chapter with great focus...'}" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${t('cancel')}</button>
        <button id="recap-save-note" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${t('save')}</button>
      `
    });
    const saveBtn = document.getElementById('recap-save-note');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const noteVal = (document.getElementById('recap-daily-note').value || '').trim();
        window.LedgerEngine.setDayLog(todayISO, today.logged, noteVal);
        window.AppUI.closeModal();
        window.AppUI.showToast(ar ? 'تم حفظ خلاصة اليوم ✨' : 'Daily recap saved ✨', 'success');
        renderAll();
      };
    }
  }

  function renderMain(animate = false, forceCurrent = false) {
    const active = window.AppState.getActiveTab();
    const mainEl = document.getElementById('app-main');
    if (!mainEl) return;
    ensureTabPanels(mainEl);

    if (currentMountedTab && currentMountedTab !== active) {
      tabScrollY[currentMountedTab] = window.scrollY || 0;
      if (currentMountedTab === 'hall' && window.GroupsModule) {
        window.GroupsModule.detach();
      }
    }

    TABS.forEach(tb => {
      const panel = document.getElementById('tab-panel-' + tb.id);
      if (!panel) return;
      if (tb.id === active) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    });

    const activePanel = document.getElementById('tab-panel-' + active);
    if (!activePanel) return;

    const needsBuild = forceCurrent || tabDirty[active] || !activePanel.children.length;
    if (needsBuild) {
      if (!isModuleReady(active)) {
        const mySeq = ++renderSeq;
        if (!activePanel.children.length) {
          activePanel.innerHTML = `<div class="py-12 text-center text-xs text-slate-400">...</div>`;
        }
        ensureTabLoaded(active).then(() => {
          if (mySeq !== renderSeq || window.AppState.getActiveTab() !== active) return;
          renderMain(animate, true);
        }).catch(() => {
          if (mySeq !== renderSeq) return;
          activePanel.innerHTML = `<div class="py-10 text-center text-xs text-rose-500">${window.I18n && window.I18n.isRTL() ? 'تعذر تحميل التبويب — تحقق من الاتصال' : 'Failed to load tab — check connection'}</div>`;
        });
        currentMountedTab = active;
        return;
      }

      lastDataUpdatedAt = (window.AppState.getData() && window.AppState.getData().updatedAt) || 0;
      let html = '';
      if (active === 'focus') html = window.FocusModule.render();
      else if (active === 'hall') html = window.GroupsModule.render();
      else if (active === 'stats') html = window.StatsModule.render();
      else if (active === 'challenge') html = window.ChallengeModule.render();
      else if (active === 'settings') html = window.SettingsModule.render();

      activePanel.innerHTML = html;
      tabDirty[active] = false;

      const scopedCb = () => renderActiveTabScoped(false);
      if (active === 'focus') window.FocusModule.bindEvents(scopedCb);
      else if (active === 'hall') window.GroupsModule.bindEvents(scopedCb);
      else if (active === 'stats') window.StatsModule.bindEvents(scopedCb);
      else if (active === 'challenge') window.ChallengeModule.bindEvents(scopedCb);
      else if (active === 'settings') window.SettingsModule.bindEvents(scopedCb);
    }

    if (animate && currentMountedTab !== active) {
      activePanel.classList.remove('tab-animate');
      requestAnimationFrame(() => activePanel.classList.add('tab-animate'));
      const savedY = tabScrollY[active] || 0;
      window.scrollTo(0, savedY);
    }
    currentMountedTab = active;
  }

  function renderAll(animate = false) {
    lastDataUpdatedAt = (window.AppState.getData() && window.AppState.getData().updatedAt) || 0;
    markAllTabsDirty();
    renderHeader();
    renderMain(animate, true);
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
      if (!window.GoogleSync) return;
      const res = window.GoogleSync.getUser()
        ? await window.GoogleSync.syncNow(true)
        : (typeof window.GoogleSync.ensureReadyAndSync === 'function'
            ? await window.GoogleSync.ensureReadyAndSync(true)
            : null);
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

  function checkDeepJoinLinkEarly() {
    try {
      const params = new URLSearchParams(window.location.search);
      const joinCode = (params.get('join') || '').trim().toUpperCase();
      if (!joinCode) return;
      sessionStorage.setItem('study_tracker_pending_join_code', joinCode);
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      window.AppState.setActiveTab('hall');
    } catch (e) {}
  }

  function loadOptionalEnhancementsInBackground() {
    setTimeout(() => {
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
    checkDeepJoinLinkEarly();
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
        if (window.AppState.getActiveTab() === 'hall' && window.GroupsModule) {
          window.GroupsModule.attachLiveListener(() => renderActiveTabScoped(false));
        }
      } else if (window.GroupsModule) {
        window.GroupsModule.detach();
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
    renderHeader,
    markOtherTabsDirty: () => markAllTabsDirty(window.AppState.getActiveTab())
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.StudyApp.init());
} else {
  window.StudyApp.init();
}
