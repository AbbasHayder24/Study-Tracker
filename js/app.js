/**
 * app.js — Main entry point (v84):
 * Profile avatar at top header, Settings nested inside Profile,
 * 4 floating glass bottom tabs (Focus, Hall, Stats, Plan) with sliding pill indicator & directional animations
 */
window.StudyApp = (function () {
  const ASSET_VER = '85';
  const TABS = [
    { id: 'focus', key: 'tab_focus', icon: '📚' },
    { id: 'hall', key: 'tab_hall', icon: '🏛️' },
    { id: 'stats', key: 'tab_stats', icon: '📈' },
    { id: 'challenge', key: 'tab_challenge', icon: '🎯' },
    { id: 'profile', key: 'tab_profile', icon: '👤' }
  ];
  // 4 primary tabs displayed in the floating bottom tab bar
  const BOTTOM_TABS = TABS.filter(tb => tb.id !== 'profile');

  // Each tab loads only the scripts it needs on first visit
  const TAB_SCRIPTS = {
    focus: ['js/bookshelf.js', 'js/focus.js'],
    hall: ['js/groups.js', 'js/bookshelf.js', 'js/focus.js'],
    stats: ['js/stats.js'],
    challenge: ['js/reviews.js', 'js/challenge.js'],
    profile: ['js/reviews.js', 'js/challenge.js', 'js/settings.js', 'js/profile.js']
  };

  const scriptPromises = {};
  let lastHeaderSig = "";
  let lastNavSig = "";
  let renderSeq = 0;
  let lastBottomTab = 'focus';
  let pendingTransition = 'fade'; // 'next' | 'prev' | 'down' | 'up' | 'fade'
  let resizeRaf = 0;
  let isBottomNavScrubbing = false;
  let lastScrubEndAt = 0;

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function getTabDisplayLabel(tabId) {
    if (tabId === 'challenge') {
      const data = window.AppState.getData();
      const customPlanName = (data && data.settings && data.settings.challenge && data.settings.challenge.name)
        ? String(data.settings.challenge.name).trim()
        : '';
      if (customPlanName) return customPlanName;
    }
    if (tabId === 'profile') return (window.I18n && window.I18n.isRTL()) ? 'البروفايل' : 'Profile';
    const found = TABS.find(tb => tb.id === tabId);
    return found ? t(found.key) : t('appTitle');
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
    await Promise.all(list.map(path => loadScriptOnce(path)));
    if (tabId === 'focus' && window.FocusModule && !window.FocusModule.__prefsBooted) {
      window.FocusModule.__prefsBooted = true;
      if (window.FocusModule.syncFromSettings) window.FocusModule.syncFromSettings();
    }
  }

  function computeTransitionDir(prevTab, nextTab) {
    if (!prevTab || prevTab === nextTab) return 'fade';
    if (nextTab === 'profile') return 'down';
    if (prevTab === 'profile') return 'up';
    const prevIdx = BOTTOM_TABS.findIndex(tb => tb.id === prevTab);
    const nextIdx = BOTTOM_TABS.findIndex(tb => tb.id === nextTab);
    if (prevIdx !== -1 && nextIdx !== -1) {
      return nextIdx > prevIdx ? 'next' : 'prev';
    }
    return 'fade';
  }

  function switchTab(nextTab, opts = {}) {
    if (!nextTab) return;

    // Route legacy 'settings' calls directly into Profile -> Settings sub-tab
    if (nextTab === 'settings') {
      nextTab = 'profile';
      opts = Object.assign({}, opts, { profileSubTab: 'settings' });
    }

    const currentTab = window.AppState.getActiveTab();
    if (opts && opts.profileSubTab && window.ProfileModule && window.ProfileModule.setSubTab) {
      if (currentTab === 'profile') {
        window.ProfileModule.setSubTab(opts.profileSubTab, true);
        return;
      }
      window.ProfileModule.setSubTab(opts.profileSubTab, false);
    } else if (opts && opts.profileSubTab) {
      window.__pendingProfileSubTab = opts.profileSubTab;
    }

    if (nextTab === currentTab) return;

    if (BOTTOM_TABS.some(tb => tb.id === nextTab)) {
      lastBottomTab = nextTab;
    }

    pendingTransition = computeTransitionDir(currentTab, nextTab);
    window.AppState.setActiveTab(nextTab);
    renderHeader();
    renderNav();
    renderMain(true, false);
  }

  function renderHeader() {
    const today = window.LedgerEngine.getTodaySummary();
    const syncStatus = window.AppState.getSyncStatus();
    const hasSync = !!(window.GoogleSync && window.GoogleSync.getUser());
    const isAr = window.I18n && window.I18n.isRTL();
    const hUnit = t('hrs');
    const active = window.AppState.getActiveTab();
    const isProfile = active === 'profile';

    const backBtn = document.getElementById('app-back-btn');
    const logoEl = document.getElementById('app-header-logo');
    const logoFallback = document.getElementById('logo-fallback');
    const titleEl = document.getElementById('app-header-title');
    const profBtn = document.getElementById('app-header-profile-btn');
    const profAvEl = document.getElementById('header-prof-avatar');

    // Top bar: Profile view shows Back + Profile title; bottom tabs show Logo + Title
    if (backBtn) {
      backBtn.classList.toggle('hidden', !isProfile);
      backBtn.title = isAr ? 'رجوع' : 'Back';
      backBtn.setAttribute('aria-label', backBtn.title);
      backBtn.onclick = () => switchTab(lastBottomTab || 'focus');
    }
    if (logoEl) {
      logoEl.classList.toggle('hidden', isProfile);
    }
    if (logoFallback && isProfile) {
      logoFallback.classList.add('hidden');
    }
    if (titleEl) {
      if (active === 'focus') {
        titleEl.textContent = t('appTitle');
      } else {
        const activeObj = TABS.find(tb => tb.id === active);
        const iconPrefix = activeObj ? `${activeObj.icon} ` : '';
        titleEl.textContent = iconPrefix + getTabDisplayLabel(active);
      }
    }

    // Top Profile Avatar Button
    const dataNow = window.AppState.getData();
    const profObj = (dataNow && dataNow.settings && dataNow.settings.profile) || {};
    const profAvatar = profObj.avatar || '🦉';
    const profColor = profObj.color || '#4f46e5';

    if (profAvEl) {
      profAvEl.textContent = profAvatar;
      profAvEl.style.background = profColor;
    }
    if (profBtn) {
      profBtn.classList.toggle('is-active', isProfile);
      const profLabel = isAr ? 'البروفايل والإعدادات' : 'Profile & Settings';
      profBtn.title = profLabel;
      profBtn.setAttribute('aria-label', profLabel);
      profBtn.setAttribute('aria-pressed', isProfile ? 'true' : 'false');
      profBtn.onclick = () => {
        if (window.AppState.getActiveTab() === 'profile') {
          switchTab(lastBottomTab || 'focus');
        } else {
          switchTab('profile');
        }
      };
    }

    const syncIcon = syncStatus.state === 'syncing' ? '🔄' : (syncStatus.state === 'error' ? '⚠️' : '☁️');
    const syncBtnHtml = hasSync
      ? `<button id="header-sync-btn" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm" title="${window.AppUI.escapeHtml(syncStatus.lastError || t('syncNowTitle'))}">${syncIcon}</button>`
      : '';

    const headerSig = `${today.logged}|${today.target}|${hasSync}|${syncStatus.state}|${isAr}`;
    if (headerSig === lastHeaderSig) return;
    lastHeaderSig = headerSig;

    const headerEl = document.getElementById('app-header-meta');
    if (headerEl) {
      headerEl.innerHTML = `
        <button id="header-daily-recap-btn" type="button" class="px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold hover:opacity-85" title="${isAr ? 'خلاصة اليوم السريعة' : 'Quick Daily Recap'}">
          ✨ ${t('todayShort')}: ${window.AppUI.formatHours(today.logged)}/${window.AppUI.formatHours(today.target)}${hUnit}
        </button>
        ${syncBtnHtml}
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
    }
  }

  function updateBottomNavIndicator(immediate = false) {
    if (isBottomNavScrubbing) return;
    const itemsEl = document.getElementById('bottom-nav-items');
    const indicator = document.getElementById('bottom-nav-indicator');
    if (!itemsEl || !indicator) return;

    const active = window.AppState.getActiveTab();
    const activeBtn = itemsEl.querySelector(`.bottom-nav-btn[data-tab-id="${active}"]`);
    if (!activeBtn) {
      indicator.style.opacity = '0';
      return;
    }

    const left = activeBtn.offsetLeft;
    const width = activeBtn.offsetWidth;
    if (width <= 0) return;

    if (immediate) {
      indicator.classList.add('no-transition');
    }
    indicator.style.width = `${width}px`;
    indicator.style.transform = `translate3d(${left}px, 0, 0)`;
    indicator.style.opacity = '1';
    if (immediate) {
      void indicator.offsetWidth;
      indicator.classList.remove('no-transition');
    }
  }

  function renderNav() {
    const active = window.AppState.getActiveTab();
    const itemsEl = document.getElementById('bottom-nav-items');
    if (!itemsEl) return;

    const isAr = !!(window.I18n && window.I18n.isRTL());
    const curLang = isAr ? 'ar' : 'en';
    const planLabel = getTabDisplayLabel('challenge');
    const navSig = `${curLang}|${planLabel}`;
    const rebuilt = !itemsEl.children.length || lastNavSig !== navSig;

    if (rebuilt) {
      lastNavSig = navSig;
      itemsEl.innerHTML = BOTTOM_TABS.map(tab => {
        const label = tab.id === 'challenge' ? planLabel : t(tab.key);
        return `
          <button type="button" data-tab-id="${tab.id}" class="bottom-nav-btn" aria-label="${window.AppUI.escapeHtml(label)}">
            <span class="bottom-nav-icon" aria-hidden="true">${tab.icon}</span>
            <span class="bottom-nav-label">${window.AppUI.escapeHtml(label)}</span>
          </button>
        `;
      }).join('');

      itemsEl.querySelectorAll('.bottom-nav-btn').forEach(btn => {
        btn.onclick = () => {
          if (Date.now() - lastScrubEndAt < 120) return;
          const nextTab = btn.getAttribute('data-tab-id');
          switchTab(nextTab);
        };
      });
    }

    itemsEl.querySelectorAll('.bottom-nav-btn').forEach(btn => {
      const isAct = btn.getAttribute('data-tab-id') === active;
      const wasAct = btn.classList.contains('is-active');
      btn.classList.toggle('is-active', isAct);
      btn.setAttribute('aria-current', isAct ? 'page' : 'false');
      if (isAct && !wasAct) {
        const iconEl = btn.querySelector('.bottom-nav-icon');
        if (iconEl) {
          iconEl.classList.remove('is-popping');
          void iconEl.offsetWidth;
          iconEl.classList.add('is-popping');
        }
      }
    });

    requestAnimationFrame(() => updateBottomNavIndicator(rebuilt));
  }

  const tabDirty = { focus: true, hall: true, stats: true, challenge: true, profile: true };
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
    if (tabId === 'focus') return !!(window.FocusModule && window.BookshelfModule);
    if (tabId === 'hall') return !!window.GroupsModule;
    if (tabId === 'stats') return !!window.StatsModule;
    if (tabId === 'challenge') return !!(window.ChallengeModule && window.ReviewsModule);
    if (tabId === 'profile') return !!(window.ProfileModule && window.SettingsModule && window.ChallengeModule);
    return true;
  }

  function applyPanelTransition(panel, dir) {
    if (!panel) return;
    panel.classList.remove('tab-animate', 'tab-slide-next', 'tab-slide-prev', 'tab-slide-down', 'tab-slide-up');
    const cls = dir === 'next' ? 'tab-slide-next'
      : dir === 'prev' ? 'tab-slide-prev'
      : dir === 'down' ? 'tab-slide-down'
      : dir === 'up' ? 'tab-slide-up'
      : 'tab-animate';
    void panel.offsetWidth;
    panel.classList.add(cls);
  }

  // Scoped re-render: only rebuilds the active tab, and only marks other tabs dirty if state actually changed
  function renderActiveTabScoped(animate = false) {
    const active = window.AppState.getActiveTab();
    const nowTs = (window.AppState.getData() && window.AppState.getData().updatedAt) || 0;
    const curLang = window.I18n ? (window.I18n.isRTL() ? 'ar' : 'en') : 'en';
    const planLabel = getTabDisplayLabel('challenge');
    const navSig = `${curLang}|${planLabel}`;
    if (nowTs !== lastDataUpdatedAt || navSig !== lastNavSig) {
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
    let active = window.AppState.getActiveTab();
    if (active === 'settings') {
      active = 'profile';
      window.AppState.setActiveTab('profile');
      window.__pendingProfileSubTab = 'settings';
    }
    if (BOTTOM_TABS.some(tb => tb.id === active)) {
      lastBottomTab = active;
    }

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
          if (active === 'profile' && window.__pendingProfileSubTab && window.ProfileModule && window.ProfileModule.setSubTab) {
            window.ProfileModule.setSubTab(window.__pendingProfileSubTab, false);
            window.__pendingProfileSubTab = null;
          }
          renderMain(animate, true);
        }).catch(() => {
          if (mySeq !== renderSeq) return;
          activePanel.innerHTML = `<div class="py-10 text-center text-xs text-rose-500">${window.I18n && window.I18n.isRTL() ? 'تعذر تحميل التبويب — تحقق من الاتصال' : 'Failed to load tab — check connection'}</div>`;
        });
        currentMountedTab = active;
        return;
      }

      if (active === 'profile' && window.__pendingProfileSubTab && window.ProfileModule && window.ProfileModule.setSubTab) {
        window.ProfileModule.setSubTab(window.__pendingProfileSubTab, false);
        window.__pendingProfileSubTab = null;
      }

      lastDataUpdatedAt = (window.AppState.getData() && window.AppState.getData().updatedAt) || 0;
      let html = '';
      if (active === 'focus') html = window.FocusModule.render();
      else if (active === 'hall') html = window.GroupsModule.render();
      else if (active === 'stats') html = window.StatsModule.render();
      else if (active === 'challenge') html = window.ChallengeModule.render();
      else if (active === 'profile') html = window.ProfileModule.render();

      activePanel.innerHTML = html;
      tabDirty[active] = false;

      const scopedCb = () => renderActiveTabScoped(false);
      if (active === 'focus') window.FocusModule.bindEvents(scopedCb);
      else if (active === 'hall') window.GroupsModule.bindEvents(scopedCb);
      else if (active === 'stats') window.StatsModule.bindEvents(scopedCb);
      else if (active === 'challenge') window.ChallengeModule.bindEvents(scopedCb);
      else if (active === 'profile') window.ProfileModule.bindEvents(scopedCb);
    }

    if (animate && currentMountedTab !== active) {
      applyPanelTransition(activePanel, pendingTransition);
      pendingTransition = 'fade';
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
      lastBottomTab = 'hall';
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

  function bindBottomNavScrubbing() {
    const track = document.getElementById('bottom-nav-track');
    if (!track || track.__scrubBound) return;
    track.__scrubBound = true;

    let activePointerId = null;
    let startX = 0;
    let movedEnough = false;
    let lastHoveredTab = null;

    function findClosestTabBtn(clientX) {
      const itemsEl = document.getElementById('bottom-nav-items');
      if (!itemsEl) return null;
      const btns = Array.from(itemsEl.querySelectorAll('.bottom-nav-btn'));
      if (!btns.length) return null;
      let best = btns[0];
      let bestDist = Infinity;
      for (const btn of btns) {
        const r = btn.getBoundingClientRect();
        const center = (r.left + r.right) / 2;
        const d = Math.abs(clientX - center);
        if (d < bestDist) {
          bestDist = d;
          best = btn;
        }
      }
      return best;
    }

    function movePillToClientX(clientX) {
      const itemsEl = document.getElementById('bottom-nav-items');
      const indicator = document.getElementById('bottom-nav-indicator');
      if (!itemsEl || !indicator) return;
      const itemsRect = itemsEl.getBoundingClientRect();
      const btns = itemsEl.querySelectorAll('.bottom-nav-btn');
      if (!btns.length || itemsRect.width <= 0) return;

      const pillWidth = btns[0].offsetWidth || (itemsRect.width / btns.length);
      const maxLeft = Math.max(0, itemsRect.width - pillWidth);
      const relX = clientX - itemsRect.left - (pillWidth / 2);
      const clampedX = Math.max(0, Math.min(maxLeft, relX));

      indicator.classList.add('no-transition');
      indicator.style.width = `${pillWidth}px`;
      indicator.style.transform = `translate3d(${clampedX}px, 0, 0) scale(1.04)`;
      indicator.style.opacity = '1';
    }

    function finishScrub() {
      if (activePointerId === null) return;
      const wasScrubbing = isBottomNavScrubbing;
      activePointerId = null;
      isBottomNavScrubbing = false;
      movedEnough = false;
      lastHoveredTab = null;

      track.classList.remove('is-scrubbing');
      const indicator = document.getElementById('bottom-nav-indicator');
      if (indicator) {
        indicator.classList.remove('no-transition');
      }
      if (wasScrubbing) {
        lastScrubEndAt = Date.now();
        requestAnimationFrame(() => updateBottomNavIndicator(false));
      }
    }

    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (document.body.classList.contains('zen-mode-active')) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      movedEnough = false;
      lastHoveredTab = window.AppState.getActiveTab();
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
    });

    track.addEventListener('pointermove', (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      const dx = Math.abs(e.clientX - startX);
      if (!movedEnough && dx < 8) return;

      if (!movedEnough) {
        movedEnough = true;
        isBottomNavScrubbing = true;
        track.classList.add('is-scrubbing');
      }

      movePillToClientX(e.clientX);
      const closestBtn = findClosestTabBtn(e.clientX);
      if (closestBtn) {
        const nextTab = closestBtn.getAttribute('data-tab-id');
        if (nextTab && nextTab !== lastHoveredTab) {
          lastHoveredTab = nextTab;
          if (navigator.vibrate) {
            try { navigator.vibrate(8); } catch (err) {}
          }
          switchTab(nextTab);
        }
      }
    });

    track.addEventListener('pointerup', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        try { track.releasePointerCapture(e.pointerId); } catch (err) {}
        finishScrub();
      }
    });

    track.addEventListener('pointercancel', (e) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        finishScrub();
      }
    });
  }

  function bindTabSwipeNavigation() {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
      if (document.body.classList.contains('zen-mode-active')) { tracking = false; return; }
      const modal = document.getElementById('app-modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) { tracking = false; return; }

      const active = window.AppState.getActiveTab();
      if (active === 'profile') { tracking = false; return; }

      const target = e.target;
      if (target && target.closest && (
        target.closest('#focus-dial-container') ||
        target.closest('.overflow-x-auto') ||
        target.closest('#app-bottom-nav') ||
        target.closest('input, textarea, select, button')
      )) {
        tracking = false;
        return;
      }

      const t0 = e.touches[0];
      startX = t0.clientX;
      startY = t0.clientY;
      tracking = true;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!tracking || !e.changedTouches || !e.changedTouches.length) return;
      tracking = false;
      const t1 = e.changedTouches[0];
      const dx = t1.clientX - startX;
      const dy = t1.clientY - startY;
      if (Math.abs(dx) < 68 || Math.abs(dy) > Math.abs(dx) * 0.65) return;

      const active = window.AppState.getActiveTab();
      const idx = BOTTOM_TABS.findIndex(tb => tb.id === active);
      if (idx === -1) return;

      const isRtl = document.documentElement.dir === 'rtl';
      // In LTR: swipe left (dx < 0) -> next tab; in RTL: swipe right (dx > 0) -> next tab
      const step = isRtl ? (dx > 0 ? 1 : -1) : (dx < 0 ? 1 : -1);
      const targetIdx = idx + step;
      if (targetIdx >= 0 && targetIdx < BOTTOM_TABS.length) {
        switchTab(BOTTOM_TABS[targetIdx].id);
      }
    }, { passive: true });
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

    bindBottomNavScrubbing();
    bindTabSwipeNavigation();

    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => updateBottomNavIndicator(true));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('app-modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) return;
      if (window.AppState.getActiveTab() === 'profile') {
        switchTab(lastBottomTab || 'focus');
      }
    });

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
    switchTab,
    closeDrawer: () => {},
    markOtherTabsDirty: () => markAllTabsDirty(window.AppState.getActiveTab())
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.StudyApp.init());
} else {
  window.StudyApp.init();
}