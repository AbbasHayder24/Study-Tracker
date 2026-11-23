/**
 * state.js — Full-Coverage Smart Auto-Sync:
 * Syncs language, theme, focus prefs, activeTimer, settings, subjects, tags, books, tasks,
 * habits (including unchecks), dailyLogs (including zeroing), reviews, startDate,
 * and deletedIds tombstones.
 */
window.AppState = (function () {
  const C = window.APP_CONFIG;
  const SYNC_KEY = 'study_tracker_gist_sync_v1';
  const GIST_FILENAME = 'study-tracker-data.json';
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

  function getSyncConfig() {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { token: '', gistId: '' };
  }

  function setSyncConfig(token, gistId) {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify({
        token: (token || '').trim(),
        gistId: (gistId || '').trim()
      }));
    } catch (e) {}
  }

  function clearSyncConfig() {
    try {
      localStorage.removeItem(SYNC_KEY);
    } catch (e) {}
    pendingPush = false;
    syncStatus = { state: 'idle', lastSyncedAt: null, lastError: '' };
  }

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

  async function findExistingGist(token) {
    try {
      const res = await fetch('https://api.github.com/gists?per_page=50', {
        cache: 'no-store',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      if (!res.ok) return null;
      const list = await res.json();
      if (!Array.isArray(list)) return null;
      const match = list.find(g => g && g.files && g.files[GIST_FILENAME]);
      return match ? match.id : null;
    } catch (e) {
      return null;
    }
  }

  function scheduleCloudPush() {
    const cfg = getSyncConfig();
    if (!cfg.token) return;
    pendingPush = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow(true);
    }, 2000);
  }

  async function pushToGist(silent = false) {
    const cfg = getSyncConfig();
    if (!cfg.token) return { ok: false, error: 'Missing GitHub token' };

    const payload = {
      description: 'Academic Study Tracker Auto-Sync Backup',
      public: false,
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(data) }
      }
    };

    try {
      const isCreate = !cfg.gistId;
      const url = isCreate
        ? 'https://api.github.com/gists'
        : `https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`;

      const res = await fetch(url, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: {
          'Authorization': `token ${cfg.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const msg = `GitHub API error (${res.status})`;
        syncStatus = { state: 'error', lastSyncedAt: syncStatus.lastSyncedAt, lastError: msg };
        if (!silent && window.AppUI) window.AppUI.showToast(msg, 'danger');
        return { ok: false, error: msg };
      }

      const json = await res.json();
      if (isCreate && json.id) {
        setSyncConfig(cfg.token, json.id);
      }
      pendingPush = false;
      syncStatus = { state: 'ok', lastSyncedAt: Date.now(), lastError: '' };
      if (!silent && window.AppUI) window.AppUI.showToast(window.I18n ? window.I18n.t('syncedToCloud') : 'Synced to cloud ☁️', 'success');
      return { ok: true, gistId: json.id || cfg.gistId };
    } catch (e) {
      pendingPush = true;
      const msg = window.I18n ? window.I18n.t('offlineAutoSync') : 'Offline — will auto-sync when back online';
      syncStatus = { state: 'error', lastSyncedAt: syncStatus.lastSyncedAt, lastError: msg };
      if (!silent && window.AppUI) window.AppUI.showToast(msg, 'warning');
      return { ok: false, error: msg };
    }
  }

  async function pullFromGist(forceApply = false) {
    const cfg = getSyncConfig();
    if (!cfg.token || !cfg.gistId) return { ok: false, updated: false };

    try {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
        cache: 'no-store',
        headers: {
          'Authorization': `token ${cfg.token}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (!res.ok) {
        const msg = `GitHub API error (${res.status})`;
        syncStatus = { state: 'error', lastSyncedAt: syncStatus.lastSyncedAt, lastError: msg };
        return { ok: false, updated: false, error: msg };
      }

      const json = await res.json();
      const fileObj = json.files && json.files[GIST_FILENAME];
      if (!fileObj || !fileObj.content) {
        return { ok: true, updated: false, remoteData: null };
      }

      const remoteData = JSON.parse(fileObj.content);
      const remoteTs = Number(remoteData.updatedAt) || 0;
      const localTs = Number(data.updatedAt) || 0;

      if (forceApply) {
        replaceData(remoteData, false);
        applySyncedPreferences();
        syncStatus = { state: 'ok', lastSyncedAt: Date.now(), lastError: '' };
        return { ok: true, updated: true, remoteData };
      }

      if (remoteTs !== localTs) {
        const merged = mergeData(data, remoteData);
        const shouldPushBack = pendingPush || localTs > remoteTs;
        replaceData(merged, false);
        applySyncedPreferences();
        syncStatus = { state: 'ok', lastSyncedAt: Date.now(), lastError: '' };
        return { ok: true, updated: remoteTs > localTs, needsPush: shouldPushBack, remoteData };
      }

      syncStatus = { state: 'ok', lastSyncedAt: Date.now(), lastError: '' };
      return { ok: true, updated: false, remoteData };
    } catch (e) {
      syncStatus = { state: 'error', lastSyncedAt: syncStatus.lastSyncedAt, lastError: 'Offline' };
      return { ok: false, updated: false, error: 'Offline' };
    }
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
          reviews: parsed.reviews || {}
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

  function save(triggerSync = true, immediate = false) {
    if (triggerSync) {
      data.updatedAt = Date.now();
    }
    try {
      localStorage.setItem(C.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
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
      reviews: newData.reviews || {}
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
    pushToGist,
    pullFromGist,
    syncNow,
    initThemeAndTelegram,
    applyTheme,
    toggleTheme,
    getIsDark,
    setActiveTab,
    getActiveTab
  };
})();
