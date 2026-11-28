/**
 * state.js — Full-Coverage Smart Auto-Sync:
 * Syncs language, theme, focus prefs, activeTimer, settings, subjects, tags, books, tasks,
 * habits (including unchecks), dailyLogs (including zeroing), reviews, startDate,
 * resolvedPenalties, and deletedIds tombstones.
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
        palette: 'ivory', // 'ivory' | 'oxford' | 'burgundy'
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
        dayStartHour: 0,
        maxPauseMinutes: 5
      },
      subjects: JSON.parse(JSON.stringify(C.DEFAULT_SUBJECTS)),
      tags: JSON.parse(JSON.stringify(C.DEFAULT_TAGS)),
      dailyLogs: {},
      books: [],
      tasks: [],
      habits: [],
      reviews: {},
      resolvedPenalties: {}
    };
  }

  data = createDefaultState();
  let ledgerDirty = true;
  let cachedLedger = null;
  const VALID_TABS = new Set(['focus', 'hall', 'stats', 'challenge', 'settings', 'profile']);
  let activeTab = 'focus';
  try {
    const savedTab = localStorage.getItem('study_tracker_active_tab');
    if (savedTab && VALID_TABS.has(savedTab)) activeTab = savedTab;
  } catch (e) {}
  let isDark = false;
  let themePref = 'auto'; // 'auto' | 'light' | 'dark'
  let themeMediaBound = false;
  let currentPalette = 'ivory';
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

  function setSyncStatus(next) {
    syncStatus = { ...syncStatus, ...(next || {}) };
    if (window.StudyApp && window.StudyApp.renderHeader) {
      window.StudyApp.renderHeader();
    }
  }

  function hasStudyContent(stateObj) {
    if (!stateObj || typeof stateObj !== 'object') return false;
    if (Array.isArray(stateObj.books) && stateObj.books.length > 0) return true;
    if (Array.isArray(stateObj.tasks) && stateObj.tasks.length > 0) return true;
    if (stateObj.dailyLogs && Object.keys(stateObj.dailyLogs).length > 0) return true;
    if (stateObj.reviews && Object.keys(stateObj.reviews).length > 0) return true;
    if (stateObj.resolvedPenalties && Object.keys(stateObj.resolvedPenalties).length > 0) return true;
    if (stateObj.activeTimer && stateObj.activeTimer.isRunning) return true;
    if (Array.isArray(stateObj.habits)) {
      for (const h of stateObj.habits) {
        if (h && h.completions && Object.keys(h.completions).length > 0) return true;
      }
    }
    return false;
  }

  function mergeData(local, remote) {
    const localHasData = hasStudyContent(local);
    const remoteHasData = hasStudyContent(remote);

    // Protect cloud data when signing in from a fresh/empty device that only changed theme/lang
    let localNewer;
    if (!localHasData && remoteHasData) {
      localNewer = false;
    } else if (localHasData && !remoteHasData) {
      localNewer = true;
    } else {
      localNewer = (Number(local.updatedAt) || 0) >= (Number(remote.updatedAt) || 0);
    }

    const primary = localNewer ? local : remote;
    const secondary = localNewer ? remote : local;

    // If local device has NO study data while remote DOES, ignore local.deletedIds so a reset/empty phone never wipes cloud items
    const deletedSet = (!localHasData && remoteHasData)
      ? new Set(Array.isArray(remote.deletedIds) ? remote.deletedIds : [])
      : new Set([
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

    const resolvedPenalties = {
      ...(secondary.resolvedPenalties || {}),
      ...(primary.resolvedPenalties || {})
    };

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

    const secSet = secondary.settings || {};
    const priSet = primary.settings || {};
    const secProf = (secSet.profile && typeof secSet.profile === 'object') ? secSet.profile : {};
    const priProf = (priSet.profile && typeof priSet.profile === 'object') ? priSet.profile : {};
    const mergedProfile = { ...secProf };
    Object.keys(priProf).forEach(k => {
      if (priProf[k] !== undefined && priProf[k] !== null && String(priProf[k]).trim() !== '') {
        mergedProfile[k] = priProf[k];
      }
    });
    const mergedGroupIds = Array.from(new Set([
      ...(Array.isArray(priSet.groupIds) ? priSet.groupIds : []),
      ...(Array.isArray(secSet.groupIds) ? secSet.groupIds : [])
    ].filter(Boolean))).slice(0, 3);
    const mergedHallVibes = {
      ...(secSet.hallVibes && typeof secSet.hallVibes === 'object' ? secSet.hallVibes : {}),
      ...(priSet.hallVibes && typeof priSet.hallVibes === 'object' ? priSet.hallVibes : {})
    };
    const mergedSettings = {
      ...secSet,
      ...priSet,
      profile: mergedProfile,
      groupIds: mergedGroupIds,
      hallVibes: mergedHallVibes,
      challenge: priSet.challenge || secSet.challenge || null
    };
    // Avoid overwriting an explicit lang/theme with null
    if (mergedSettings.lang == null && secondary.settings && secondary.settings.lang != null) {
      mergedSettings.lang = secondary.settings.lang;
    }
    if (mergedSettings.theme == null && secondary.settings && secondary.settings.theme != null) {
      mergedSettings.theme = secondary.settings.theme;
    }

    return {
      ...primary,
      startDate: resolvedStartDate,
      startDateUpdatedAt: resolvedStartDateTs,
      updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0),
      deletedIds: Array.from(deletedSet).slice(-1000),
      activeTimer: resolvedTimer,
      settings: mergedSettings,
      tags: mergeById(secondary.tags, primary.tags),
      subjects: mergeById(secondary.subjects, primary.subjects),
      dailyLogs,
      books: mergeById(secondary.books, primary.books),
      tasks: mergeById(secondary.tasks, primary.tasks),
      habits: Array.from(habitMap.values()),
      reviews,
      resolvedPenalties
    };
  }

  function applySyncedPreferences() {
    if (data.settings && (data.settings.lang === 'ar' || data.settings.lang === 'en' || data.settings.lang === 'auto') && window.I18n) {
      window.I18n.setLang(data.settings.lang, true, false);
    }
    if (data.settings && (data.settings.theme === 'dark' || data.settings.theme === 'light' || data.settings.theme === 'auto')) {
      setThemePref(data.settings.theme, true, false);
    }
    if (data.settings && (data.settings.palette === 'ivory' || data.settings.palette === 'oxford' || data.settings.palette === 'burgundy')) {
      applyPalette(data.settings.palette, true, false);
    }
    if (window.FocusModule && window.FocusModule.syncFromSettings) {
      window.FocusModule.syncFromSettings();
    }
    if (window.FocusModule && window.FocusModule.applyRemoteTimerState) {
      window.FocusModule.applyRemoteTimerState(data.activeTimer);
    }
  }

  async function syncNow(silent = false) {
    if (window.GoogleSync && typeof window.GoogleSync.syncNow === 'function') {
      return window.GoogleSync.syncNow(silent);
    }
    return { ok: false, error: 'Not connected' };
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
      const raw = JSON.stringify(data);
      localStorage.setItem(C.STORAGE_KEY, raw);
      mirrorToIndexedDB(raw);
    } catch (e) {}
  }

  let idbTimer = null;
  function mirrorToIndexedDB(rawJson) {
    if (typeof indexedDB === 'undefined') return;
    if (idbTimer) clearTimeout(idbTimer);
    idbTimer = setTimeout(() => {
      idbTimer = null;
      try {
        const req = indexedDB.open('study_tracker_idb_v1', 1);
        req.onupgradeneeded = () => {
          const idb = req.result;
          if (!idb.objectStoreNames.contains('kv')) idb.createObjectStore('kv');
        };
        req.onsuccess = () => {
          try {
            const idb = req.result;
            const tx = idb.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ savedAt: Date.now(), raw: rawJson }, 'latest');
            idb.close();
          } catch (e) {}
        };
      } catch (e) {}
    }, 600);
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
    if (triggerSync && window.GoogleSync && typeof window.GoogleSync.onLocalSave === 'function') {
      window.GoogleSync.onLocalSave(immediate);
    }
    if (triggerSync && window.GroupsModule && typeof window.GroupsModule.schedulePresenceSync === 'function') {
      window.GroupsModule.schedulePresenceSync(immediate);
    }
  }

  function getData() { return data; }

  function replaceData(newData, triggerSync = true, immediate = false) {
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
    applySyncedPreferences();
    save(triggerSync, immediate);
  }

  function resetAll() {
    if (typeof window !== 'undefined') window.__studyTrackerExplicitReset = true;
    const allIds = [
      ...(data.books || []).map(b => b.id),
      ...(data.tasks || []).map(t => t.id),
      ...(data.habits || []).map(h => h.id)
    ];
    data = createDefaultState();
    markDeleted(allIds);
    markLedgerDirty();
    save(true, true);
  }

  function loadDemoData() {
    const today = getLocalTodayISO();
    const startDate = addDaysISO(today, -32);
    const demo = createDefaultState();
    demo.startDate = startDate;
    demo.startDateUpdatedAt = Date.now();

    demo.tasks = [];

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
        const demoSubj = demo.subjects[i % demo.subjects.length];
        demo.books.push({
          id: `bk_demo_${i}`,
          date: iso,
          minutes: mins,
          durationSec: mins * 60,
          mode: i % 3 === 0 ? 'stopwatch' : 'pomodoro',
          tagId: tId,
          subjectId: demoSubj ? demoSubj.id : '',
          taskId: '',
          taskTitle: demoSubj ? demoSubj.name : '',
          completed: true,
          startedAt: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 18 + (i % 4), 15, 0).getTime(),
          endedAt: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 18 + (i % 4), 15 + mins, 0).getTime(),
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

    replaceData(demo, true, true);
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

    themePref = (savedTheme === 'dark' || savedTheme === 'light') ? savedTheme : 'auto';
    isDark = themePref === 'auto' ? detectSystemDark() : (themePref === 'dark');

    let savedPal = 'ivory';
    try {
      const p = localStorage.getItem('study_tracker_palette');
      if (p === 'oxford' || p === 'burgundy' || p === 'ivory') savedPal = p;
    } catch (e) {}
    currentPalette = savedPal;
    document.documentElement.setAttribute('data-palette', currentPalette);
    applyTheme(isDark, false, false);

    if (!themeMediaBound && window.matchMedia) {
      themeMediaBound = true;
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onSysThemeChange = () => {
        if (themePref !== 'auto') return;
        applyTheme(detectSystemDark(), false, false);
        if (window.StudyApp && window.StudyApp.renderHeader) window.StudyApp.renderHeader();
      };
      if (mq.addEventListener) mq.addEventListener('change', onSysThemeChange);
      else if (mq.addListener) mq.addListener(onSysThemeChange);
    }
  }

  function detectSystemDark() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.colorScheme === 'dark') return true;
    if (tg && tg.colorScheme === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function setThemePref(pref, persist = true, syncToCloud = true) {
    const clean = (pref === 'dark' || pref === 'light' || pref === 'auto') ? pref : 'auto';
    themePref = clean;
    const dark = clean === 'auto' ? detectSystemDark() : (clean === 'dark');
    applyTheme(dark, false, false);
    if (persist) {
      try {
        localStorage.setItem(C.THEME_KEY, clean);
      } catch (e) {}
    }
    if (syncToCloud && data && data.settings) {
      data.settings.theme = clean;
      save(true);
    }
    return isDark;
  }

  function getThemePref() { return themePref; }

  function applyTheme(dark, persist = true, syncToCloud = false) {
    isDark = !!dark;
    document.documentElement.classList.toggle('dark', isDark);
    const tc = document.getElementById('meta-theme-color');
    if (tc) {
      const colors = {
        ivory: isDark ? '#090C12' : '#F4F0E8',
        oxford: isDark ? '#07130E' : '#EFF4EF',
        burgundy: isDark ? '#14090D' : '#F8F1F2'
      };
      tc.setAttribute('content', colors[currentPalette] || colors.ivory);
    }
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

  function applyPalette(pal, persist = true, syncToCloud = false) {
    const clean = (pal === 'oxford' || pal === 'burgundy') ? pal : 'ivory';
    currentPalette = clean;
    document.documentElement.setAttribute('data-palette', clean);
    if (persist) {
      try { localStorage.setItem('study_tracker_palette', clean); } catch (e) {}
    }
    applyTheme(isDark, false, false);
    if (syncToCloud && data && data.settings) {
      data.settings.palette = clean;
      save(true);
    }
  }

  function getPalette() { return currentPalette; }

  function toggleTheme() {
    return setThemePref(isDark ? 'light' : 'dark', true, true);
  }

  function getIsDark() { return isDark; }
  function setActiveTab(tab) {
    if (!VALID_TABS.has(tab)) return;
    activeTab = tab;
    try { localStorage.setItem('study_tracker_active_tab', tab); } catch (e) {}
  }
  function getActiveTab() { return activeTab; }

  return {
    getLocalTodayISO,
    addDaysISO,
    parseLocalISO,
    load,
    save,
    getData,
    replaceData,
    mergeData,
    applySyncedPreferences,
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
    setSyncStatus,
    syncNow,
    initThemeAndTelegram,
    applyTheme,
    setThemePref,
    getThemePref,
    toggleTheme,
    getIsDark,
    applyPalette,
    getPalette,
    setActiveTab,
    getActiveTab
  };
})();