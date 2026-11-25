/**
 * state.js — Full-Coverage Smart Auto-Sync:
 * Syncs language, theme, focus prefs, activeTimer, settings, subjects, tags, books, tasks,
 * habits (including unchecks), dailyLogs (including zeroing), reviews, startDate,
 * and deletedIds tombstones.
 */
window.AppState = (function () {
  const C = window.APP_CONFIG;
      let data = null;

  function getLocalTodayISO(dateObj) {
    let d;
    if (dateObj) {
      d = dateObj;
    } else {
      d = new Date();
      const startHour = (data && data.settings && Number(data.settings.dayStartHour)) || 0;
      if (startHour > 0) {
        d.setHours(d.getHours() - startHour);
      }
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDaysISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return getLocalTodayISO(dt);
  }

  function parseLocalISO(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function createDefaultState() {
    const today = getLocalTodayISO();
    return {
      version: C.APP_VERSION,
      updatedAt: 0,
      startDate: today,
      startDateUpdatedAt: 0,
      deletedIds: [],
      activeTimer: null,
      settings: {
        lang: null, // 'en' | 'ar' | null
        theme: null, // 'dark' | 'light' | null (auto)
        shelfStyle: 'classic3d', // 'classic3d' | 'minimal'
        soundEnabled: true,
        notificationsEnabled: false,
        pushEnabled: false,
        pushWorkerUrl: '',
        focusMode: 'pomodoro',
        focusTargetMinutes: 25,
        focusTagId: 'study',
        focusLinkType: 'subject',
        focusSubjectId: '',
        dayStartHour: 0
      },
      subjects: JSON.parse(JSON.stringify(C.DEFAULT_SUBJECTS)),
      tags: JSON.parse(JSON.stringify(C.DEFAULT_TAGS)),
      dailyLogs: {},
      books: [],
      tasks: [],
      habits: [
        { id: 'hab_1', title: 'Daily Anki flashcards', icon: '🧠', targetDaysPerWeek: 7, completions: {} },
        { id: 'hab_2', title: 'Clear desk before studying', icon: '🧹', targetDaysPerWeek: 6, completions: {} },
        { id: 'hab_3', title: 'Write end-of-day summary', icon: '📝', targetDaysPerWeek: 5, completions: {} }
      ],
      reviews: {}
    };
  }

  data = createDefaultState();
  let ledgerDirty = true;
  let cachedLedger = null;
  let activeTab = 'focus';
  let isDark = false;
  let pushTimer = null;
  let syncInFlight = false;
  let pendingPush = false;
  let syncStatus = { state: 'idle', lastSyncedAt: null, lastError: '' };

  function markLedgerDirty() { ledgerDirty = true; }
  function isLedgerDirty() { return ledgerDirty; }
  function setCachedLedger(ledger) { cachedLedger = ledger; ledgerDirty = false; }
  function getCachedLedger() { return cachedLedger; }

  function markDeleted(ids) {
    if (!Array.isArray(data.deletedIds)) data.deletedIds = [];
    const list = Array.isArray(ids) ? ids : [ids];
    const set = new Set(data.deletedIds);
    list.forEach(id => { if (id) set.add(id); });
    data.deletedIds = Array.from(set).slice(-1000);
  }

  function getSyncConfig() { return { token: '', gistId: '' }; }

  function setSyncConfig() {}

  function clearSyncConfig() {}

  function getSyncStatus() {
    return syncStatus;
  }

  function mergeData(local, remote) {
    const localNewer = (Number(local.updatedAt) || 0) >= (Number(remote.updatedAt) || 0);
    const primary = localNewer ? local : remote;
    const secondary = localNewer ? remote : local;

    const deletedSet = new Set([
      ...(Array.isArray(local.deletedIds) ? local.deletedIds : []),
      ...(Array.isArray(remote.deletedIds) ? remote.deletedIds : [])
    ]);

    const mergeById = (secArr, priArr) => {
      const map = new Map();
      (secArr || []).forEach(item => {
        if (item && item.id && !deletedSet.has(item.id)) map.set(item.id, item);
      });
      (priArr || []).forEach(item => {
        if (item && item.id && !deletedSet.has(item.id)) map.set(item.id, item);
      });
      return Array.from(map.values());
    };

    const habitMap = new Map();
    (secondary.habits || []).forEach(h => {
      if (h && h.id && !deletedSet.has(h.id)) {
        habitMap.set(h.id, { ...h, completions: { ...(h.completions || {}) } });
      }
    });
    (primary.habits || []).forEach(h => {
      if (!h || !h.id || deletedSet.has(h.id)) return;
      const existing = habitMap.get(h.id);
      const mergedComp = { ...(existing ? existing.completions : {}) };
      Object.keys(h.completions || {}).forEach(dayIso => {
        mergedComp[dayIso] = h.completions[dayIso];
      });
      habitMap.set(h.id, { ...h, completions: mergedComp });
    });

    const dailyLogs = { ...(secondary.dailyLogs || {}) };
    Object.keys(primary.dailyLogs || {}).forEach(iso => {
      const pEntry = primary.dailyLogs[iso];
      const sEntry = dailyLogs[iso];
      if (!sEntry) {
        dailyLogs[iso] = pEntry;
      } else {
        const pTs = Number(pEntry.updatedAt) || 0;
        const sTs = Number(sEntry.updatedAt) || 0;
        dailyLogs[iso] = pTs >= sTs ? pEntry : sEntry;
      }
    });

    const reviews = { ...(secondary.reviews || {}) };
    Object.keys(primary.reviews || {}).forEach(rid => {
      const pRev = primary.reviews[rid];
      const sRev = reviews[rid];
      if (!sRev) {
        reviews[rid] = pRev;
      } else {
        const pTs = String(pRev.updatedAt || '');
        const sTs = String(sRev.updatedAt || '');
        reviews[rid] = pTs >= sTs ? pRev : sRev;
      }
    });

    const lSdTs = Number(local.startDateUpdatedAt) || 0;
    const rSdTs = Number(remote.startDateUpdatedAt) || 0;
    let resolvedStartDate = primary.startDate;
    let resolvedStartDateTs = Math.max(lSdTs, rSdTs);
    if (lSdTs > rSdTs) resolvedStartDate = local.startDate;
    else if (rSdTs > lSdTs) resolvedStartDate = remote.startDate;
    else if (local.startDate && remote.startDate) {
      resolvedStartDate = local.startDate <= remote.startDate ? local.startDate : remote.startDate;
    }

    const lTimer = local.activeTimer || null;
    const rTimer = remote.activeTimer || null;
    const lTimerTs = lTimer ? (Number(lTimer.updatedAt) || 0) : 0;
    const rTimerTs = rTimer ? (Number(rTimer.updatedAt) || 0) : 0;
    const resolvedTimer = lTimerTs >= rTimerTs ? lTimer : rTimer;

    return {
      ...primary,
      startDate: resolvedStartDate,
      startDateUpdatedAt: resolvedStartDateTs,
      updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0),
      deletedIds: Array.from(deletedSet).slice(-1000),
      activeTimer: resolvedTimer,
      settings: {
        ...(secondary.settings || {}),
        ...(primary.settings || {}),
        challenge: (primary.settings && primary.settings.challenge) || (secondary.settings && secondary.settings.challenge) || null
      },
      tags: mergeById(secondary.tags, primary.tags),
      subjects: mergeById(secondary.subjects, primary.subjects),
      dailyLogs,
      books: mergeById(secondary.books, primary.books),
      tasks: mergeById(secondary.tasks, primary.tasks),
      habits: Array.from(habitMap.values()),
      reviews
    };
  }

  function scheduleCloudPush() {
    // Cloud sync is handled automatically by GoogleSync (Firebase Firestore)
  }

  async function syncNow(silent = false) {
    if (window.GoogleSync && typeof window.GoogleSync.syncNow === 'function') {
      return window.GoogleSync.syncNow(silent);
    }
    return { ok: false, error: 'Not connected' };
  }

  function applySyncedPreferences() {
    if (data.settings && (data.settings.lang === 'ar' || data.settings.lang === 'en') && window.I18n) {
      window.I18n.setLang(data.settings.lang, true, false);
    }
    if (data.settings && (data.settings.theme === 'dark' || data.settings.theme === 'light')) {
      applyTheme(data.settings.theme === 'dark', true, false);
    }
    if (window.FocusModule && window.FocusModule.syncFromSettings) {
      window.FocusModule.syncFromSettings();
    }
    if (window.FocusModule && window.FocusModule.applyRemoteTimerState) {
      window.FocusModule.applyRemoteTimerState(data.activeTimer);
    }
  }

  async function syncNow(silent = false) {
    if (syncInFlight) return { ok: false, skipped: true };
    let cfg = getSyncConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected' };

    syncInFlight = true;
    syncStatus.state = 'syncing';
    syncStatus.lastError = '';
    if (window.StudyApp && window.StudyApp.renderHeader) window.StudyApp.renderHeader();

    try {
      if (!cfg.gistId) {
        const foundId = await findExistingGist(cfg.token);
        if (foundId) {
          setSyncConfig(cfg.token, foundId);
          cfg = getSyncConfig();
        }
      }

      let updatedUI = false;
      if (cfg.gistId) {
        const pullRes = await pullFromGist(false);
        if (!pullRes.ok) return pullRes;
        updatedUI = !!pullRes.updated;
        if (pendingPush || pullRes.needsPush) {
          const pushRes = await pushToGist(true);
          if (!pushRes.ok) return pushRes;
        }
      } else {
        const createRes = await pushToGist(true);
        if (!createRes.ok) return createRes;
      }

      syncStatus = { state: 'ok', lastSyncedAt: Date.now(), lastError: '' };
      if (!silent && window.AppUI) {
        window.AppUI.showToast(updatedUI ? (window.I18n ? window.I18n.t('mergedAndSynced') : 'Merged & synced ☁️') : (window.I18n ? window.I18n.t('upToDate') : 'Everything is up to date ☁️'), 'success');
      }
      return { ok: true, updated: updatedUI };
    } finally {
      syncInFlight = false;
      if (window.StudyApp && window.StudyApp.renderHeader) window.StudyApp.renderHeader();
      if (pendingPush && syncStatus.state !== 'error') {
        setTimeout(() => syncNow(true), 300);
      }
    }
  }


  function load() {
    try {
      const raw = localStorage.getItem(C.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const def = createDefaultState();
        data = {
          ...def,
          ...parsed,
          deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
          activeTimer: parsed.activeTimer || null,
          settings: { ...def.settings, ...(parsed.settings || {}) },
          subjects: Array.isArray(parsed.subjects) && parsed.subjects.length ? parsed.subjects : def.subjects,
          tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : def.tags,
          dailyLogs: parsed.dailyLogs || {},
          books: Array.isArray(parsed.books) ? parsed.books : [],
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          habits: Array.isArray(parsed.habits) ? parsed.habits : def.habits,
          reviews: parsed.reviews || {},
          resolvedPenalties: parsed.resolvedPenalties || {}
        };
      } else {
        data = createDefaultState();
      }
    } catch (e) {
      data = createDefaultState();
    }
    markLedgerDirty();
    applySyncedPreferences();
    return data;
  }

  let localWriteTimer = null;
  let hasPendingLocalWrite = false;

  function flushLocalWrite() {
    if (localWriteTimer) {
      clearTimeout(localWriteTimer);
      localWriteTimer = null;
    }
    if (!hasPendingLocalWrite) return;
    hasPendingLocalWrite = false;
    try {
      localStorage.setItem(C.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function scheduleLocalWrite() {
    hasPendingLocalWrite = true;
    if (localWriteTimer) return;
    const run = () => {
      localWriteTimer = null;
      flushLocalWrite();
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      localWriteTimer = setTimeout(() => window.requestIdleCallback(run, { timeout: 300 }), 80);
    } else {
      localWriteTimer = setTimeout(run, 120);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushLocalWrite);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushLocalWrite();
    });
  }

  function save(triggerSync = true, immediate = false) {
    if (triggerSync) {
      data.updatedAt = Date.now();
    }
    if (immediate) {
      hasPendingLocalWrite = true;
      flushLocalWrite();
    } else {
      scheduleLocalWrite();
    }
    if (triggerSync) {
      if (immediate) {
        if (pushTimer) clearTimeout(pushTimer);
        pendingPush = true;
        syncNow(true);
      } else {
        scheduleCloudPush();
      }
    }
  }

  function getData() { return data; }

  function replaceData(newData, triggerSync = true) {
    const def = createDefaultState();
    data = {
      ...def,
      ...newData,
      deletedIds: Array.isArray(newData.deletedIds) ? newData.deletedIds : [],
      activeTimer: newData.activeTimer || null,
      settings: { ...def.settings, ...(newData.settings || {}) },
      subjects: Array.isArray(newData.subjects) && newData.subjects.length ? newData.subjects : def.subjects,
      tags: Array.isArray(newData.tags) && newData.tags.length ? newData.tags : def.tags,
      dailyLogs: newData.dailyLogs || {},
      books: Array.isArray(newData.books) ? newData.books : [],
      tasks: Array.isArray(newData.tasks) ? newData.tasks : [],
      habits: Array.isArray(newData.habits) ? newData.habits : [],
      reviews: newData.reviews || {},
      resolvedPenalties: newData.resolvedPenalties || {}
    };
    markLedgerDirty();
    save(triggerSync);
  }

  function resetAll() {
    const allIds = [
      ...(data.books || []).map(b => b.id),
      ...(data.tasks || []).map(t => t.id),
      ...(data.habits || []).map(h => h.id)
    ];
    data = createDefaultState();
    markDeleted(allIds);
    markLedgerDirty();
    save(true);
  }

  function loadDemoData() {
    const today = getLocalTodayISO();
    const startDate = addDaysISO(today, -32);
    const demo = createDefaultState();
    demo.startDate = startDate;
    demo.startDateUpdatedAt = Date.now();

    demo.tasks = [
      { id: 't_1', title: 'Finish cranial nerves anatomy chapter', subjectId: 'subj_anat', priority: 'high', done: false, dueDate: today, createdAt: today },
      { id: 't_2', title: 'Solve 40 cardiac physiology questions', subjectId: 'subj_phys', priority: 'high', done: true, dueDate: today, createdAt: today },
      { id: 't_3', title: 'Summarize acute vs chronic inflammation', subjectId: 'subj_path', priority: 'medium', done: false, dueDate: addDaysISO(today, 1), createdAt: today },
      { id: 't_4', title: 'Review antihypertensives (ACEi / ARBs)', subjectId: 'subj_pharm', priority: 'medium', done: true, dueDate: addDaysISO(today, -1), createdAt: today },
      { id: 't_5', title: 'UWorld block — Respiratory system', subjectId: 'subj_usmle', priority: 'low', done: false, dueDate: addDaysISO(today, 2), createdAt: today }
    ];

    const sampleDurations = [20, 35, 55, 80, 45, 60, 30, 90, 25];
    const tagIds = ['study', 'study', 'study', 'anki', 'reading', 'research'];

    for (let i = 0; i <= 32; i++) {
      const iso = addDaysISO(startDate, i);
      const dt = parseLocalISO(iso);
      const dow = dt.getDay();
      const target = C.CHALLENGE.DAILY_TARGETS[dow];
      const factor = (i % 7 === 4) ? 0.55 : (i % 5 === 0 ? 1.15 : 0.95);
      const loggedHours = Math.round(target * factor * 2) / 2;
      demo.dailyLogs[iso] = {
        hours: loggedHours,
        note: i === 32 ? 'Strong evening deep work session' : '',
        updatedAt: Date.now()
      };

      if (i >= 20) {
        const mins = sampleDurations[i % sampleDurations.length];
        const tId = tagIds[i % tagIds.length];
        const linkedTask = demo.tasks[i % demo.tasks.length];
        demo.books.push({
          id: `bk_demo_${i}`,
          date: iso,
          minutes: mins,
          durationSec: mins * 60,
          mode: i % 3 === 0 ? 'stopwatch' : 'pomodoro',
          tagId: tId,
          subjectId: linkedTask.subjectId,
          taskId: linkedTask.id,
          taskTitle: linkedTask.title,
          completed: true,
          createdAt: iso
        });
      }

      demo.habits.forEach((h, hIdx) => {
        if ((i + hIdx) % 4 !== 0) {
          h.completions[iso] = true;
        }
      });
    }

    demo.books.push({
      id: 'bk_demo_incomplete',
      date: today,
      minutes: 3,
      durationSec: 195,
      mode: 'pomodoro',
      tagId: 'anki',
      subjectId: 'subj_anat',
      taskId: '',
      taskTitle: 'Interrupted session',
      completed: false,
      createdAt: today
    });

    demo.reviews = {
      bw_1: {
        rating: 4,
        notes: 'Solid start with strong Saturday and Friday blocks; need to reduce Thursday distractions.',
        updatedAt: today
      }
    };

    replaceData(demo, true);
  }

  function initThemeAndTelegram() {
    if (window.I18n) window.I18n.initLang();

    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch (e) {}
    }

    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem(C.THEME_KEY);
    } catch (e) {}

    if (savedTheme === 'dark') isDark = true;
    else if (savedTheme === 'light') isDark = false;
    else if (tg && tg.colorScheme === 'dark') isDark = true;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) isDark = true;

    applyTheme(isDark, false, false);
  }

  function applyTheme(dark, persist = true, syncToCloud = false) {
    isDark = !!dark;
    document.documentElement.classList.toggle('dark', isDark);
    if (persist) {
      try {
        localStorage.setItem(C.THEME_KEY, isDark ? 'dark' : 'light');
      } catch (e) {}
    }
    if (syncToCloud && data && data.settings) {
      data.settings.theme = isDark ? 'dark' : 'light';
      save(true);
    }
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      try {
        const bg = isDark ? '#0f172a' : '#f8fafc';
        if (tg.setHeaderColor) tg.setHeaderColor(bg);
        if (tg.setBackgroundColor) tg.setBackgroundColor(bg);
      } catch (e) {}
    }
  }

  function toggleTheme() {
    applyTheme(!isDark, true, true);
    return isDark;
  }

  function getIsDark() { return isDark; }
  function setActiveTab(tab) { activeTab = tab; }
  function getActiveTab() { return activeTab; }

  return {
    getLocalTodayISO,
    addDaysISO,
    parseLocalISO,
    load,
    save,
    getData,
    replaceData,
    resetAll,
    loadDemoData,
    markLedgerDirty,
    isLedgerDirty,
    setCachedLedger,
    getCachedLedger,
    markDeleted,
    getSyncConfig,
    setSyncConfig,
    clearSyncConfig,
    getSyncStatus,
            syncNow,
    initThemeAndTelegram,
    applyTheme,
    toggleTheme,
    getIsDark,
    setActiveTab,
    getActiveTab
  };
})();