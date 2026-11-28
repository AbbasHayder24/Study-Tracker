/**
 * focus.js — Background-proof & Cross-Device Synced Focus Timer
 * Supports linking either a Subject or a Task, two-tone bookshelf colors, and EN/AR i18n.
 */
window.FocusModule = (function () {
  const TIMER_KEY = 'study_tracker_active_timer_v1';

  let mode = 'pomodoro';
  let targetMinutes = 25;
  let selectedTagId = 'study';
  let linkType = 'subject'; // 'subject' | 'task'
  let selectedSubjectId = '';
  let selectedTaskId = '';
  let customTaskTitle = '';

  let isRunning = false;
  let isPaused = false;
  let accumulatedSec = 0;
  let startedAt = null;
  let pausedAt = null;
  let sessionOriginAt = null;
  let sessionId = null;
  let zenMode = false;
  let wakeLockSentinel = null;
  let totalSec = 25 * 60;
  let intervalId = null;
  let lastRerender = null;
  let restoredOnce = false;


  const MAX_FOCUS_MINUTES = 360; // 6 hours max
  const DIAL_RADIUS = 84;
  const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }

  function clampFocusMinutes(m) {
    const n = Math.round(Number(m) || 0);
    if (n <= 0) return 1;
    return Math.min(MAX_FOCUS_MINUTES, n);
  }

  function formatDurationLabel(mins) {
    if (mins === 0) return t('quickTestSub');
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return isAr() ? `${h} س ${m} د` : `${h}h ${m}m`;
    if (h > 0) return isAr() ? (h === 1 ? 'ساعة واحدة' : `${h} ساعات`) : `${h}h`;
    return t('minLabel', { m: mins });
  }

  function formatEndClock(mins) {
    const sec = mins === 0 ? 5 : Math.max(1, mins) * 60;
    const d = new Date(Date.now() + sec * 1000);
    try {
      return d.toLocaleTimeString(isAr() ? 'ar-IQ' : [], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }

  function getDefaultEndTimeValue(mins) {
    const d = new Date(Date.now() + Math.max(1, mins || 25) * 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getKnobXY(mins) {
    const frac = Math.max(0.014, Math.min(1, (mins || 5) / MAX_FOCUS_MINUTES));
    const angleRad = frac * 2 * Math.PI - Math.PI / 2;
    return {
      x: 96 + DIAL_RADIUS * Math.cos(angleRad),
      y: 96 + DIAL_RADIUS * Math.sin(angleRad),
      frac
    };
  }

  function formatMMSS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function getConfiguredTotalSec() {
    if (mode === 'stopwatch') return 0;
    return targetMinutes === 0 ? 5 : targetMinutes * 60;
  }

  function getMaxPauseSec() {
    const data = window.AppState ? window.AppState.getData() : null;
    const m = data && data.settings ? Number(data.settings.maxPauseMinutes) : 5;
    const clamped = Number.isFinite(m) ? Math.max(3, Math.min(7, Math.round(m))) : 5;
    return clamped * 60;
  }

  function getPauseRemainingSec() {
    if (!isRunning || !isPaused || !pausedAt) return getMaxPauseSec();
    const elapsedPause = Math.max(0, Math.floor((Date.now() - pausedAt) / 1000));
    return Math.max(0, getMaxPauseSec() - elapsedPause);
  }

  function getLiveElapsedSec() {
    if (!isRunning) return 0;
    if (isPaused || !startedAt) return accumulatedSec;
    return accumulatedSec + Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }

  function saveTimerState(syncCloud = true) {
    const timerObj = isRunning
      ? {
          sessionId,
          mode,
          targetMinutes,
          totalSec,
          selectedTagId,
          linkType,
          selectedSubjectId,
          selectedTaskId,
          isRunning: true,
          isPaused,
          accumulatedSec,
          startedAt,
          pausedAt,
          sessionOriginAt,
          updatedAt: Date.now()
        }
      : { isRunning: false, updatedAt: Date.now() };

    try {
      if (isRunning) {
        localStorage.setItem(TIMER_KEY, JSON.stringify(timerObj));
      } else {
        localStorage.removeItem(TIMER_KEY);
      }
    } catch (e) {}

    if (window.AppState) {
      const data = window.AppState.getData();
      data.activeTimer = timerObj;
      if (syncCloud) {
        window.AppState.save(true, true);
      }
    }
  }

  function restoreTimerState() {
    if (restoredOnce) return;
    restoredOnce = true;
    try {
      let st = null;
      const raw = localStorage.getItem(TIMER_KEY);
      if (raw) {
        st = JSON.parse(raw);
      } else if (window.AppState) {
        const data = window.AppState.getData();
        if (data && data.activeTimer && data.activeTimer.isRunning) {
          st = data.activeTimer;
        }
      }
      if (!st || !st.isRunning) return;
      sessionId = st.sessionId || ('bk_' + (st.startedAt || Date.now()));
      mode = st.mode || 'pomodoro';
      targetMinutes = typeof st.targetMinutes === 'number' ? st.targetMinutes : 25;
      totalSec = typeof st.totalSec === 'number' ? st.totalSec : getConfiguredTotalSec();
      selectedTagId = st.selectedTagId || 'study';
      linkType = st.linkType === 'task' ? 'task' : (st.linkType === 'subject' ? 'subject' : (st.selectedTaskId ? 'task' : 'subject'));
      selectedSubjectId = st.selectedSubjectId || '';
      selectedTaskId = st.selectedTaskId || '';
      isRunning = true;
      isPaused = !!st.isPaused;
      accumulatedSec = Number(st.accumulatedSec) || 0;
      startedAt = st.startedAt ? Number(st.startedAt) : null;
      pausedAt = st.pausedAt ? Number(st.pausedAt) : null;
      sessionOriginAt = st.sessionOriginAt ? Number(st.sessionOriginAt) : startedAt;
    } catch (e) {}
  }

  function applyRemoteTimerState(st) {
    if (!st) return;
    restoredOnce = true;

    if (!st.isRunning) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      isRunning = false;
      isPaused = false;
      accumulatedSec = 0;
      startedAt = null;
      pausedAt = null;
      sessionOriginAt = null;
      sessionId = null;
      try { document.title = 'Study Tracker'; } catch (e) {}
      if (window.PushManagerClient && window.PushManagerClient.clearOngoingTimerNotification) window.PushManagerClient.clearOngoingTimerNotification();
      try {
        localStorage.removeItem(TIMER_KEY);
      } catch (e) {}
      return;
    }

    sessionId = st.sessionId || ('bk_' + (st.startedAt || Date.now()));
    mode = st.mode || 'pomodoro';
    targetMinutes = typeof st.targetMinutes === 'number' ? st.targetMinutes : 25;
    totalSec = typeof st.totalSec === 'number' ? st.totalSec : getConfiguredTotalSec();
    selectedTagId = st.selectedTagId || 'study';
    linkType = st.linkType === 'task' ? 'task' : (st.linkType === 'subject' ? 'subject' : (st.selectedTaskId ? 'task' : 'subject'));
    selectedSubjectId = st.selectedSubjectId || '';
    selectedTaskId = st.selectedTaskId || '';
    isRunning = true;
    isPaused = !!st.isPaused;
    accumulatedSec = Number(st.accumulatedSec) || 0;
    startedAt = st.startedAt ? Number(st.startedAt) : null;
    pausedAt = st.pausedAt ? Number(st.pausedAt) : null;
    sessionOriginAt = st.sessionOriginAt ? Number(st.sessionOriginAt) : startedAt;

    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(st));
    } catch (e) {}

    if (lastRerender) {
      runTickInterval(lastRerender);
    }
  }

  function syncFromSettings() {
    restoreTimerState();
    if (isRunning) return;
    const st = window.AppState.getData().settings || {};
    if (st.focusMode === 'pomodoro' || st.focusMode === 'stopwatch') mode = st.focusMode;
    if (typeof st.focusTargetMinutes === 'number') targetMinutes = st.focusTargetMinutes;
    const data = window.AppState.getData();
    if (st.focusTagId && data.tags.some(tg => tg.id === st.focusTagId)) selectedTagId = st.focusTagId;
    if (st.focusLinkType === 'subject' || st.focusLinkType === 'task') linkType = st.focusLinkType;
    if (typeof st.focusSubjectId === 'string') {
      selectedSubjectId = data.subjects.some(s => s.id === st.focusSubjectId) ? st.focusSubjectId : '';
    }
    totalSec = getConfiguredTotalSec();
  }

  function saveFocusPrefs() {
    const data = window.AppState.getData();
    if (!data.settings) data.settings = {};
    data.settings.focusMode = mode;
    data.settings.focusTargetMinutes = targetMinutes;
    data.settings.focusTagId = selectedTagId;
    data.settings.focusLinkType = linkType;
    data.settings.focusSubjectId = selectedSubjectId;
    window.AppState.save();
  }

  function autoResumeFromPause(rerender) {
    const maxSec = getMaxPauseSec();
    startedAt = pausedAt ? (pausedAt + maxSec * 1000) : Date.now();
    pausedAt = null;
    isPaused = false;
    saveTimerState(true);
    notifyOngoingTimer();
    if (mode === 'pomodoro' && window.PushManagerClient) {
      const remSec = Math.max(1, totalSec - getLiveElapsedSec());
      window.PushManagerClient.scheduleTimerPush(remSec, buildScheduledPushMeta());
    }
    if (window.AppUI) {
      window.AppUI.showToast(
        isAr() ? 'انتهت مهلة الإيقاف المؤقت — تم استئناف المؤقت تلقائياً ⏱️' : 'Pause limit reached — timer resumed automatically ⏱️',
        'warning'
      );
    }
    if (rerender) rerender();
  }

  function tickCheck(rerender) {
    if (!isRunning) return;
    if (isPaused) {
      const remPause = getPauseRemainingSec();
      if (remPause <= 0) {
        autoResumeFromPause(rerender || lastRerender);
        return;
      }
      const subEl = document.getElementById('focus-status-sub');
      if (subEl) {
        subEl.textContent = isAr()
          ? `متوقف مؤقتاً • متبقي ${formatMMSS(remPause)}`
          : `Paused • ${formatMMSS(remPause)} left`;
      }
      return;
    }
    const elapsed = getLiveElapsedSec();
    if (mode === 'pomodoro' && elapsed >= totalSec) {
      finishSession(true, rerender || lastRerender, true);
      return;
    }
    updateLiveClockDOM();
  }

  function runTickInterval(rerender) {
    lastRerender = rerender || lastRerender;
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => tickCheck(lastRerender), 1000);
  }

  function buildRichNotificationMeta(mins, alreadyLogged = false) {
    const ar = isAr();
    const C = window.APP_CONFIG;
    const tag = window.AppUI ? window.AppUI.getTagById(selectedTagId) : null;
    const data = window.AppState ? window.AppState.getData() : null;
    const linkedTask = (linkType === 'task' && selectedTaskId && data)
      ? (data.tasks || []).find(tk => tk.id === selectedTaskId)
      : null;
    const subjId = linkType === 'subject' ? selectedSubjectId : (linkedTask ? linkedTask.subjectId : '');
    const subj = subjId && window.AppUI ? window.AppUI.getSubjectById(subjId) : null;
    const cleanTag = tag && tag.name ? String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim() : '';
    const label = (subj && subj.name) || cleanTag || (ar ? 'جلسة دراسة' : 'Study Session');

    const roundedM = Math.max(1, Math.round(mins));
    let lvl = C.BOOK_LEVELS[1];
    for (let i = 1; i < C.BOOK_LEVELS.length; i++) {
      if (roundedM >= C.BOOK_LEVELS[i].minMinutes && roundedM <= C.BOOK_LEVELS[i].maxMinutes) {
        lvl = C.BOOK_LEVELS[i];
        break;
      }
    }
    const lvlName = ar ? (lvl.labelAr || lvl.label) : lvl.label;
    const counts = !!(tag && tag.countsForChallenge);
    const todaySum = window.LedgerEngine ? window.LedgerEngine.getTodaySummary() : { logged: 0, target: 5.5 };
    const projectedLogged = alreadyLogged
      ? todaySum.logged
      : (todaySum.logged + (counts ? Math.round((roundedM / 60) * 100) / 100 : 0));
    const fmtH = (v) => (window.AppUI ? window.AppUI.formatHours(v) : String(v));

    const icon = lvl.gold ? '🏆' : '📚';
    const title = ar
      ? `${icon} أُضيف ${lvlName} — ${label}`
      : `${icon} New ${lvlName} — ${label}`;

    const body = counts
      ? (ar
          ? `+${roundedM} دقيقة للتحدي • مجموع اليوم: ${fmtH(projectedLogged)} / ${fmtH(todaySum.target)} س 🔥`
          : `+${roundedM}m for challenge • Today: ${fmtH(projectedLogged)} / ${fmtH(todaySum.target)}h 🔥`)
      : (ar
          ? `أنهيت ${roundedM} دقيقة وأُضيفت إلى رف كتبك ✨`
          : `Completed ${roundedM}m and added to your bookshelf ✨`);

    return { sessionId, title, body };
  }

  function buildScheduledPushMeta() {
    const mins = targetMinutes === 0 ? 5 : targetMinutes;
    return buildRichNotificationMeta(mins, false);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
      }
    } catch (e) {}
  }

  function releaseWakeLock() {
    try {
      if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    } catch (e) {}
  }

  function setZenMode(active) {
    zenMode = !!active;
    document.body.classList.toggle('zen-mode-active', zenMode);
    if (zenMode) requestWakeLock();
    else releaseWakeLock();
  }

  function notifyOngoingTimer() {
    if (!window.PushManagerClient || !window.PushManagerClient.showOngoingTimerNotification) return;
    const ar = isAr();
    const tag = window.AppUI ? window.AppUI.getTagById(selectedTagId) : null;
    const subj = (linkType === 'subject' && selectedSubjectId && window.AppUI) ? window.AppUI.getSubjectById(selectedSubjectId) : null;
    const label = (subj && subj.name) || (tag && String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim()) || (ar ? 'دراسة' : 'Study');
    if (mode === 'pomodoro') {
      const remMins = Math.max(1, Math.ceil(Math.max(0, totalSec - getLiveElapsedSec()) / 60));
      const endClk = formatEndClock(remMins);
      window.PushManagerClient.showOngoingTimerNotification(
        ar ? `⏱️ مؤقت التركيز يعمل — ${label}` : `⏱️ Focus Timer Running — ${label}`,
        ar ? `ينتهي الساعة ${endClk} • اضغط للعودة للتطبيق` : `Ends at ${endClk} • Tap to return`
      );
    } else {
      const startClk = new Date(sessionOriginAt || Date.now()).toLocaleTimeString(ar ? 'ar-IQ' : [], { hour: 'numeric', minute: '2-digit' });
      window.PushManagerClient.showOngoingTimerNotification(
        ar ? `⏱️ Stopwatch يعمل — ${label}` : `⏱️ Stopwatch Running — ${label}`,
        ar ? `بدأ الساعة ${startClk} • اضغط للعودة للتطبيق` : `Started at ${startClk} • Tap to return`
      );
    }
  }

  function startTimer(rerender) {
    if (isRunning) return;
    window.AppUI.unlockAudio();
    totalSec = getConfiguredTotalSec();
    accumulatedSec = 0;
    startedAt = Date.now();
    sessionOriginAt = startedAt;
    sessionId = 'bk_' + startedAt;
    isRunning = true;
    isPaused = false;
    saveTimerState(true);
    notifyOngoingTimer();
    if (window.PushManagerClient) {
      if (mode === 'pomodoro') {
        window.PushManagerClient.scheduleTimerPush(totalSec, buildScheduledPushMeta());
      } else {
        const ar = isAr();
        window.PushManagerClient.scheduleTimerPush(3600, {
          sessionId,
          title: ar ? '⏱️ Stopwatch ما زال يعمل (60 دقيقة)' : '⏱️ Stopwatch Still Running (60m)',
          body: ar ? 'مرت ساعة على جلستك — استمر أو أوقف المؤقت لحفظ كتابك 📚' : 'You have been studying for 1 hour — keep going or finish to save your book 📚'
        });
      }
    }
    runTickInterval(rerender);
    if (rerender) rerender();
  }

  function togglePause(rerender) {
    if (!isRunning) return;
    if (!isPaused) {
      accumulatedSec = getLiveElapsedSec();
      startedAt = null;
      pausedAt = Date.now();
      isPaused = true;
      runTickInterval(rerender);
      if (window.PushManagerClient) {
        window.PushManagerClient.cancelTimerPush();
        if (window.PushManagerClient.clearOngoingTimerNotification) window.PushManagerClient.clearOngoingTimerNotification();
      }
      try { document.title = 'Study Tracker'; } catch (e) {}
    } else {
      startedAt = Date.now();
      pausedAt = null;
      isPaused = false;
      notifyOngoingTimer();
      if (mode === 'pomodoro' && window.PushManagerClient) {
        const remSec = Math.max(1, totalSec - accumulatedSec);
        window.PushManagerClient.scheduleTimerPush(remSec, buildScheduledPushMeta());
      }
      runTickInterval(rerender);
    }
    saveTimerState(true);
    if (rerender) rerender();
  }

  function stopOrFinish(rerender) {
    if (!isRunning) return;
    const elapsed = getLiveElapsedSec();
    if (mode === 'stopwatch') {
      finishSession((elapsed / 60) >= 5, rerender, false);
    } else {
      const completed = targetMinutes === 0 ? elapsed >= 5 : (elapsed / 60) >= 5;
      const reachedEnd = totalSec > 0 && elapsed >= totalSec;
      finishSession(completed, rerender, reachedEnd);
    }
  }

  function finishSession(completed, rerender, naturalFinish = false) {
    const liveElapsed = getLiveElapsedSec();
    const pushAlreadyFired = !!(mode === 'pomodoro' && naturalFinish && totalSec > 0 && (liveElapsed - totalSec) > 8 && window.AppState && window.AppState.getData().settings && window.AppState.getData().settings.pushEnabled);
    const finalElapsed = (mode === 'pomodoro' && naturalFinish)
      ? totalSec
      : (mode === 'pomodoro' && totalSec > 0 ? Math.min(totalSec, liveElapsed) : liveElapsed);
    const finishedId = sessionId || ('bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    const finishedEndMs = Date.now();
    const finishedStartMs = sessionOriginAt || (finishedEndMs - Math.max(1, finalElapsed) * 1000);

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
    isPaused = false;
    accumulatedSec = 0;
    startedAt = null;
    pausedAt = null;
    sessionOriginAt = null;
    sessionId = null;
    if (zenMode) setZenMode(false);
    try { document.title = 'Study Tracker'; } catch (e) {}
    saveTimerState(false);
    if (window.PushManagerClient) {
      window.PushManagerClient.cancelTimerPush();
      if (window.PushManagerClient.clearOngoingTimerNotification) window.PushManagerClient.clearOngoingTimerNotification();
    }

    const data = window.AppState.getData();

    if (data.books.some(b => b.id === finishedId)) {
      window.AppState.save(true, true);
      if (rerender) rerender();
      return;
    }

    const todayISO = window.AppState.getLocalTodayISO();
    const actualMinutes = mode === 'pomodoro' && completed && targetMinutes === 0
      ? 5
      : Math.max(1, Math.round((finalElapsed / 60) * 10) / 10);

    const linkedTask = (linkType === 'task' && selectedTaskId)
      ? data.tasks.find(tk => tk.id === selectedTaskId)
      : null;
    const resolvedSubjectId = linkType === 'subject'
      ? selectedSubjectId
      : (linkedTask ? (linkedTask.subjectId || '') : '');
    const taskTitle = customTaskTitle.trim() || (linkedTask ? linkedTask.title : '');

    const book = {
      id: finishedId,
      date: todayISO,
      minutes: actualMinutes,
      durationSec: finalElapsed,
      mode,
      tagId: selectedTagId,
      subjectId: resolvedSubjectId,
      taskId: linkedTask ? linkedTask.id : '',
      taskTitle,
      completed,
      startedAt: finishedStartMs,
      endedAt: finishedEndMs,
      createdAt: new Date(finishedEndMs).toISOString()
    };

    data.books.push(book);
    if (window.BookshelfModule && window.BookshelfModule.markNewlyAddedBook) {
      window.BookshelfModule.markNewlyAddedBook(book.id);
    }

    const tag = window.AppUI.getTagById(selectedTagId);
    const roundedM = Math.round(actualMinutes);
    if (completed && tag && tag.countsForChallenge) {
      window.LedgerEngine.addStudyMinutesToDate(todayISO, actualMinutes, true);
      window.AppState.save(true, true);
      if (!pushAlreadyFired) {
        const rich = buildRichNotificationMeta(roundedM, true);
        window.AppUI.sendSessionNotification(rich.title, rich.body);
      }
      window.AppUI.showToast(t('toastCompleteChallenge', { m: roundedM }), 'success');
    } else if (completed) {
      window.AppState.save(true, true);
      if (!pushAlreadyFired) {
        const rich = buildRichNotificationMeta(roundedM, true);
        window.AppUI.sendSessionNotification(rich.title, rich.body);
      }
      window.AppUI.showToast(t('toastCompleteShelf'), 'success');
    } else {
      window.AppState.save(true, true);
      window.AppUI.showToast(t('toastIncomplete'), 'warning');
    }

    if (rerender) rerender();
  }

  function updateLiveClockDOM() {
    const clockEl = document.getElementById('focus-clock-text');
    const ringEl = document.getElementById('focus-progress-ring');
    if (!clockEl) return;

    const elapsed = getLiveElapsedSec();
    if (mode === 'pomodoro') {
      const rem = Math.max(0, totalSec - elapsed);
      const txt = formatMMSS(rem);
      clockEl.textContent = txt;
      try { document.title = `${txt} • Study Tracker`; } catch (e) {}
      if (ringEl && totalSec > 0) {
        const circumference = 2 * Math.PI * 84;
        const progress = Math.min(1, elapsed / totalSec);
        ringEl.style.strokeDashoffset = String(circumference * (1 - progress));
      }
    } else {
      const txt = formatMMSS(elapsed);
      clockEl.textContent = txt;
      try { document.title = `${txt} • Study Tracker`; } catch (e) {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (zenMode) requestWakeLock();
      if (isRunning) {
        tickCheck(lastRerender);
        if (isRunning && !intervalId) runTickInterval(lastRerender);
      }
    } else {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && zenMode) {
      setZenMode(false);
    }
  });

  function render() {
    restoreTimerState();
    const data = window.AppState.getData();
    const tag = window.AppUI.getTagById(selectedTagId);
    const activeColor = tag ? tag.color : '#6366f1';


    const elapsed = getLiveElapsedSec();
    const circumference = 2 * Math.PI * 84;
    const displaySec = mode === 'pomodoro'
      ? (isRunning ? Math.max(0, totalSec - elapsed) : getConfiguredTotalSec())
      : elapsed;
    const dialFrac = mode === 'pomodoro'
      ? (isRunning
          ? (totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0)
          : Math.max(0.014, Math.min(1, (targetMinutes === 0 ? 5 : targetMinutes) / MAX_FOCUS_MINUTES)))
      : 0;
    const dashOffset = circumference * (1 - dialFrac);
    const knobPos = getKnobXY(targetMinutes === 0 ? 5 : targetMinutes);

    const statusSub = isPaused
      ? (isAr() ? `متوقف مؤقتاً • متبقي ${formatMMSS(getPauseRemainingSec())}` : `Paused • ${formatMMSS(getPauseRemainingSec())} left`)
      : (mode === 'pomodoro' ? formatDurationLabel(targetMinutes) : t('countingUp'));

    const curTagObj = (data.tags || []).find(tg => tg.id === selectedTagId) || (data.tags || [])[0] || null;
    const curSubjObj = (data.subjects || []).find(s => s.id === selectedSubjectId) || null;
    const pillColor = (curSubjObj && curSubjObj.color) || (curTagObj && curTagObj.color) || activeColor;
    const pillLabel = curSubjObj
      ? curSubjObj.name
      : (curTagObj ? curTagObj.name : (isAr() ? 'اختر المادة' : 'Choose Subject'));

    return `
      <div class="focus-ipad-grid">
        <div class="space-y-3">
          ${(() => {
            const liveN = window.GroupsModule ? window.GroupsModule.getLiveStudyingCount() : 0;
            if (liveN <= 0) return '';
            return `
              <button id="focus-ambient-hall" type="button" class="zen-hide w-full py-1.5 px-3 rounded-full bg-emerald-50/70 dark:bg-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/50 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center justify-center gap-1.5">
                <span>🟢</span>
                <span>${isAr() ? `${liveN} من زملائك يدرسون الآن في القاعة` : `${liveN} studying live in Study Hall`}</span>
              </button>
            `;
          })()}

          <div id="focus-timer-card" class="focus-hero-stage">
            <div class="zen-hide flex items-center justify-between mb-3">
              <div class="${isRunning ? 'opacity-0 pointer-events-none' : ''} flex p-0.5 bg-slate-100/90 dark:bg-slate-800/80 rounded-full border border-slate-200/60 dark:border-slate-700/70">
                <button id="mode-pomodoro" ${isRunning ? 'disabled' : ''} class="px-3.5 py-1.5 rounded-full text-[11px] font-bold transition ${mode === 'pomodoro' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                  ${t('pomodoro')}
                </button>
                <button id="mode-stopwatch" ${isRunning ? 'disabled' : ''} class="px-3.5 py-1.5 rounded-full text-[11px] font-bold transition ${mode === 'stopwatch' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                  ${t('stopwatch')}
                </button>
              </div>
              <button id="focus-zen-btn" type="button" class="px-2.5 py-1.5 rounded-full bg-slate-100/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[11px] font-bold hover:opacity-85" title="${isAr() ? 'وضع التركيز الكامل (Zen Mode)' : 'Zen Focus Mode'}">
                🧘 Zen
              </button>
            </div>

            <button id="focus-zen-exit" type="button" class="zen-only px-3.5 py-2 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-lg">
              ✕ ${isAr() ? 'خروج من Zen' : 'Exit Zen'}
            </button>

            <div id="focus-dial-container" class="focus-dial-lg relative mx-auto my-2 flex items-center justify-center" style="${mode === 'pomodoro' && !isRunning ? 'touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;' : ''}">
              <svg id="focus-dial-svg" class="w-full h-full" viewBox="0 0 192 192" style="overflow:visible">
                <circle cx="96" cy="96" r="84" fill="none" stroke="currentColor" stroke-width="7.5" class="text-slate-200/80 dark:text-slate-700"/>
                ${mode === 'pomodoro' && !isRunning ? [0, 60, 120, 180, 240, 300].map(deg => {
                  const rad = (deg - 90) * Math.PI / 180;
                  const x1 = (96 + 74 * Math.cos(rad)).toFixed(1);
                  const y1 = (96 + 74 * Math.sin(rad)).toFixed(1);
                  const x2 = (96 + 78 * Math.cos(rad)).toFixed(1);
                  const y2 = (96 + 78 * Math.sin(rad)).toFixed(1);
                  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.35" class="text-slate-400 dark:text-slate-400"/>`;
                }).join('') : ''}
                <circle id="focus-progress-ring" cx="96" cy="96" r="84" fill="none" stroke="${activeColor}" stroke-width="8" stroke-linecap="round"
                  transform="rotate(-90 96 96)"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"/>
                ${mode === 'pomodoro' && !isRunning ? `
                  <circle id="focus-dial-knob" cx="${knobPos.x.toFixed(2)}" cy="${knobPos.y.toFixed(2)}" r="9.5"
                    fill="#ffffff" stroke="${activeColor}" stroke-width="3"
                    style="cursor:grab"/>
                ` : ''}
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center" style="pointer-events:none">
                <button id="focus-clock-btn" type="button" style="pointer-events:${mode === 'pomodoro' && !isRunning ? 'auto' : 'none'}" title="${isAr() ? 'اضغط لضبط الوقت بدقة' : 'Tap to set exact time'}">
                  <span id="focus-clock-text" dir="ltr" class="font-extrabold tracking-wide text-slate-800 dark:text-white tabular-nums" style="font-size:${displaySec >= 3600 ? '1.85rem' : '2.35rem'};line-height:1.1">${formatMMSS(displaySec)}</span>
                </button>
                <span id="focus-status-sub" class="text-xs mt-1.5 font-medium ${isPaused ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-slate-400'}">
                  ${statusSub}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-center gap-2 mt-2 mb-5">
              ${mode === 'pomodoro' ? `
                <button id="focus-end-time-pill" type="button" ${isRunning ? 'disabled' : ''}
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:opacity-80">
                  <span>⏰</span>
                  <span id="focus-end-time-label">${isAr() ? 'ينتهي' : 'Ends'} ${formatEndClock(isRunning ? Math.ceil(displaySec / 60) : targetMinutes)}</span>
                  ${!isRunning ? `<span class="opacity-60 text-[10px]">✎</span>` : ''}
                </button>
              ` : ''}
              <button id="focus-picker-pill" type="button" ${isRunning ? 'disabled' : ''}
                class="zen-hide inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:opacity-85">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${window.AppUI.escapeHtml(pillColor)}"></span>
                <span class="truncate max-w-[160px]">${window.AppUI.escapeHtml(pillLabel)}</span>
                ${!isRunning ? `<span class="text-[10px] opacity-60">▾</span>` : ''}
              </button>
            </div>

            <div class="flex gap-2.5 max-w-xs mx-auto">
              ${!isRunning ? `
                <button id="focus-start-btn" class="flex-1 py-3.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-md transition">
                  ${t('startFocus')}
                </button>
              ` : `
                <button id="focus-pause-btn" class="flex-1 py-3.5 rounded-full bg-amber-500 text-white font-extrabold text-sm shadow-md transition">
                  ${isPaused ? t('resume') : t('pause')}
                </button>
                <button id="focus-stop-btn" class="flex-1 py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm shadow-md transition">
                  ${mode === 'stopwatch' ? t('finish') : t('stop')}
                </button>
              `}
            </div>
          </div>
        </div>

        <div class="zen-hide">${window.BookshelfModule.renderSection()}</div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    lastRerender = rerender;
    if (isRunning) {
      tickCheck(rerender);
      if (isRunning && !intervalId) runTickInterval(rerender);
    }


    const pickerPill = document.getElementById('focus-picker-pill');
    if (pickerPill && !isRunning) {
      pickerPill.onclick = () => {
        const ar = isAr();
        const dataNow = window.AppState.getData();
        const subjects = dataNow.subjects || [];
        const tags = dataNow.tags || [];

        const getMatchingSubjects = (tagId) => subjects.filter(s => s.defaultTagId === tagId);

        const renderPickerBody = () => {
          const matchedSubjects = getMatchingSubjects(selectedTagId);
          return `
            <div class="space-y-4">
              <div>
                <div class="text-[11px] font-bold text-slate-400 mb-2">${ar ? 'التصنيفات' : 'Tags'}</div>
                <div class="flex flex-wrap gap-2">
                  ${tags.map(tg => {
                    const act = tg.id === selectedTagId;
                    return `<button type="button" data-pick-focus-tag="${window.AppUI.escapeHtml(tg.id)}" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition ${act ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}">
                      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${window.AppUI.escapeHtml(tg.color)}"></span>
                      <span>${window.AppUI.escapeHtml(tg.name)}</span>
                    </button>`;
                  }).join('')}
                </div>
              </div>
              ${matchedSubjects.length ? `
                <div class="tab-animate">
                  <div class="text-[11px] font-bold text-slate-400 mb-2">${ar ? 'المواد' : 'Subjects'}</div>
                  <div class="flex flex-wrap gap-2">
                    ${matchedSubjects.map(s => {
                      const act = s.id === selectedSubjectId;
                      return `<button type="button" data-pick-focus-subj="${window.AppUI.escapeHtml(s.id)}" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition ${act ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}">
                        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${window.AppUI.escapeHtml(s.color)}"></span>
                        <span>${window.AppUI.escapeHtml(s.name)}</span>
                      </button>`;
                    }).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        };

        const bindPickerEvents = () => {
          document.querySelectorAll('[data-pick-focus-tag]').forEach(b => {
            b.onclick = () => {
              const nextTagId = b.getAttribute('data-pick-focus-tag');
              selectedTagId = nextTagId;
              const matched = getMatchingSubjects(nextTagId);
              if (!matched.some(s => s.id === selectedSubjectId)) {
                selectedSubjectId = '';
              }
              saveFocusPrefs();
              rerender();
              if (matched.length === 0) {
                window.AppUI.closeModal();
              } else {
                const modalBody = document.getElementById('app-modal-body');
                if (modalBody) {
                  modalBody.innerHTML = renderPickerBody();
                  bindPickerEvents();
                }
              }
            };
          });
          document.querySelectorAll('[data-pick-focus-subj]').forEach(b => {
            b.onclick = () => {
              const sid = b.getAttribute('data-pick-focus-subj');
              selectedSubjectId = sid;
              const sObj = subjects.find(x => x.id === sid);
              if (sObj && sObj.defaultTagId) selectedTagId = sObj.defaultTagId;
              saveFocusPrefs();
              window.AppUI.closeModal();
              rerender();
            };
          });
        };

        window.AppUI.openModal({
          title: ar ? '🏷️ اختر التصنيف والمادة' : '🏷️ Choose Tag & Subject',
          bodyHtml: renderPickerBody(),
          footerHtml: `<button type="button" onclick="window.AppUI.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'تم' : 'Done'}</button>`
        });
        bindPickerEvents();
      };
    }

    const zenBtn = document.getElementById('focus-zen-btn');
    if (zenBtn) zenBtn.onclick = () => setZenMode(!zenMode);
    const zenExitBtn = document.getElementById('focus-zen-exit');
    if (zenExitBtn) zenExitBtn.onclick = () => setZenMode(false);

    const infoBtn = document.getElementById('info-focus-btn');
    if (infoBtn) {
      infoBtn.onclick = () => {
        window.AppUI.showInfo(t('focusInfoTitle'), t('focusInfoBody'));
      };
    }

    const pomoBtn = document.getElementById('mode-pomodoro');
    const swBtn = document.getElementById('mode-stopwatch');
    if (pomoBtn) pomoBtn.onclick = () => { if (!isRunning) { mode = 'pomodoro'; saveFocusPrefs(); rerender(); } };
    if (swBtn) swBtn.onclick = () => { if (!isRunning) { mode = 'stopwatch'; saveFocusPrefs(); rerender(); } };

    function updateDialVisual(mins) {
      targetMinutes = clampFocusMinutes(mins);
      totalSec = getConfiguredTotalSec();
      const clockEl = document.getElementById('focus-clock-text');
      if (clockEl) {
        clockEl.textContent = formatMMSS(totalSec);
        clockEl.style.fontSize = totalSec >= 3600 ? '1.5rem' : '1.875rem';
      }
      const subEl = document.getElementById('focus-status-sub');
      if (subEl) subEl.textContent = formatDurationLabel(targetMinutes);
      const endEl = document.getElementById('focus-end-time-label');
      if (endEl) endEl.textContent = `${isAr() ? 'ينتهي' : 'Ends'} ${formatEndClock(targetMinutes)}`;

      const ringEl = document.getElementById('focus-progress-ring');
      const knobEl = document.getElementById('focus-dial-knob');
      const kp = getKnobXY(targetMinutes);
      if (ringEl) ringEl.setAttribute('stroke-dashoffset', String(DIAL_CIRCUMFERENCE * (1 - kp.frac)));
      if (knobEl) {
        knobEl.setAttribute('cx', kp.x.toFixed(2));
        knobEl.setAttribute('cy', kp.y.toFixed(2));
      }
    }

    function openExactTimeModal() {
      if (isRunning || mode !== 'pomodoro') return;
      const ar = isAr();
      const curH = Math.floor((targetMinutes || 0) / 60);
      const curM = (targetMinutes || 0) % 60;
      const bodyHtml = `
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">${ar ? 'اختيار ساعات ودقائق (حد أقصى 6 ساعات)' : 'Hours & Minutes (max 6h)'}</label>
            <div class="flex items-center gap-2" dir="ltr">
              <input id="modal-focus-h" type="number" min="0" max="6" value="${curH}" style="min-width:0;width:0;flex:1 1 0%" class="h-10 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-bold text-center"/>
              <span class="text-xs font-bold text-slate-400">h</span>
              <input id="modal-focus-m" type="number" min="0" max="59" value="${curM}" style="min-width:0;width:0;flex:1 1 0%" class="h-10 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-bold text-center"/>
              <span class="text-xs font-bold text-slate-400">m</span>
            </div>
          </div>
          <div class="pt-3 border-t border-slate-100 dark:border-slate-700">
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">${ar ? 'أو اضبط المؤقت حتى ساعة محددة ⏰' : 'Or set timer until clock time ⏰'}</label>
            <div style="width:100%;overflow:hidden;border-radius:0.95rem" class="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
              <input id="modal-focus-until" type="time" value="${getDefaultEndTimeValue(targetMinutes)}" style="-webkit-appearance:none;appearance:none;width:100%;max-width:100%;height:40px;border:0;background:transparent;box-sizing:border-box;text-align:center" class="px-3 text-sm font-bold"/>
            </div>
          </div>
        </div>
      `;
      const footerHtml = `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="modal-focus-apply" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'تطبيق' : 'Apply'}</button>
      `;
      window.AppUI.openModal({ title: ar ? 'ضبط وقت المؤقت' : 'Set Focus Time', bodyHtml, footerHtml });

      let editedUntil = false;
      const hEl = document.getElementById('modal-focus-h');
      const mEl = document.getElementById('modal-focus-m');
      const uEl = document.getElementById('modal-focus-until');
      if (uEl) {
        uEl.oninput = () => {
          editedUntil = true;
          const parts = (uEl.value || '').split(':').map(Number);
          if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parts[0], parts[1], 0, 0);
            if (target.getTime() <= now.getTime() + 30000) target.setDate(target.getDate() + 1);
            const diff = Math.min(MAX_FOCUS_MINUTES, Math.max(1, Math.round((target.getTime() - now.getTime()) / 60000)));
            if (hEl) hEl.value = Math.floor(diff / 60);
            if (mEl) mEl.value = diff % 60;
          }
        };
      }
      if (hEl) hEl.oninput = () => { editedUntil = false; };
      if (mEl) mEl.oninput = () => { editedUntil = false; };

      const applyBtn = document.getElementById('modal-focus-apply');
      if (applyBtn) {
        applyBtn.onclick = () => {
          let total = 25;
          if (editedUntil && uEl && uEl.value) {
            const parts = uEl.value.split(':').map(Number);
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parts[0], parts[1], 0, 0);
            if (target.getTime() <= now.getTime() + 30000) target.setDate(target.getDate() + 1);
            const diff = Math.max(1, Math.round((target.getTime() - now.getTime()) / 60000));
            if (diff > MAX_FOCUS_MINUTES) {
              window.AppUI.showToast(ar ? 'الحد الأقصى 6 ساعات — تم ضبطه على 6 ساعات' : 'Max 6 hours — capped to 6h', 'info');
            }
            total = Math.min(MAX_FOCUS_MINUTES, diff);
          } else {
            let h = Math.max(0, Math.min(6, parseInt(hEl && hEl.value, 10) || 0));
            let m = Math.max(0, Math.min(59, parseInt(mEl && mEl.value, 10) || 0));
            if (h === 6) m = 0;
            total = Math.max(1, Math.min(MAX_FOCUS_MINUTES, h * 60 + m));
          }
          updateDialVisual(total);
          saveFocusPrefs();
          window.AppUI.closeModal();
        };
      }
    }

    const dialBox = document.getElementById('focus-dial-container');
    if (dialBox && mode === 'pomodoro' && !isRunning) {
      let dragging = false;
      let dragCurrentMins = targetMinutes === 0 ? 5 : targetMinutes;
      const pointToMinutes = (clientX, clientY, isStart) => {
        const rect = dialBox.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let deg = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
        if (deg < 0) deg += 360;
        let candidate = Math.round((deg / 360) * MAX_FOCUS_MINUTES / 5) * 5;
        if (!isStart) {
          // Prevent wrapping across 12 o'clock: clamp at 6h (360m) or 5m
          if (dragCurrentMins >= 270 && candidate <= 90) {
            candidate = MAX_FOCUS_MINUTES;
          } else if (dragCurrentMins <= 90 && candidate >= 270) {
            candidate = 5;
          }
        }
        if (candidate === 0) candidate = dragCurrentMins >= 180 ? MAX_FOCUS_MINUTES : 5;
        dragCurrentMins = Math.max(5, Math.min(MAX_FOCUS_MINUTES, candidate));
        return dragCurrentMins;
      };
      dialBox.onpointerdown = (e) => {
        if (e.target && e.target.closest && e.target.closest('#focus-clock-btn')) return;
        dragging = true;
        dragCurrentMins = targetMinutes === 0 ? 5 : targetMinutes;
        try { dialBox.setPointerCapture(e.pointerId); } catch (err) {}
        updateDialVisual(pointToMinutes(e.clientX, e.clientY, true));
      };
      dialBox.onpointermove = (e) => {
        if (!dragging) return;
        updateDialVisual(pointToMinutes(e.clientX, e.clientY, false));
      };
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { dialBox.releasePointerCapture(e.pointerId); } catch (err) {}
        saveFocusPrefs();
      };
      dialBox.onpointerup = endDrag;
      dialBox.onpointercancel = endDrag;
    }

    const clockBtn = document.getElementById('focus-clock-btn');
    if (clockBtn) clockBtn.onclick = openExactTimeModal;
    const endPill = document.getElementById('focus-end-time-pill');
    if (endPill) endPill.onclick = openExactTimeModal;

    const quickBtn = document.getElementById('focus-quick-test');
    if (quickBtn) {
      quickBtn.onclick = () => {
        if (!isRunning) {
          targetMinutes = 0;
          totalSec = getConfiguredTotalSec();
          saveFocusPrefs();
          rerender();
        }
      };
    }

    const tagSel = document.getElementById('focus-tag-select');
    if (tagSel) {
      tagSel.onchange = (e) => {
        selectedTagId = e.target.value;
        if (linkType === 'subject') {
          const data = window.AppState.getData();
          const currentSubj = (data.subjects || []).find(s => s.id === selectedSubjectId);
          // Only switch subject if current subject is NOT already linked to this tag
          if (!currentSubj || currentSubj.defaultTagId !== selectedTagId) {
            const matchedSubj = (data.subjects || []).find(s => s.defaultTagId === selectedTagId);
            selectedSubjectId = matchedSubj ? matchedSubj.id : '';
          }
        }
        saveFocusPrefs();
        rerender();
      };
    }

    const linkSubjBtn = document.getElementById('focus-link-subject');
    const linkTaskBtn = document.getElementById('focus-link-task');
    if (linkSubjBtn) {
      linkSubjBtn.onclick = () => {
        if (!isRunning && linkType !== 'subject') {
          linkType = 'subject';
          selectedTaskId = '';
          saveFocusPrefs();
          rerender();
        }
      };
    }
    if (linkTaskBtn) {
      linkTaskBtn.onclick = () => {
        if (!isRunning && linkType !== 'task') {
          linkType = 'task';
          saveFocusPrefs();
          rerender();
        }
      };
    }

    const subjSel = document.getElementById('focus-subject-select');
    if (subjSel) {
      subjSel.onchange = (e) => {
        selectedSubjectId = e.target.value;
        const data = window.AppState.getData();
        const subj = (data.subjects || []).find(s => s.id === selectedSubjectId);
        if (subj && subj.defaultTagId && (data.tags || []).some(tg => tg.id === subj.defaultTagId)) {
          selectedTagId = subj.defaultTagId;
          saveFocusPrefs();
          rerender();
          return;
        }
        saveFocusPrefs();
      };
    }

    const taskSel = document.getElementById('focus-task-select');
    if (taskSel) {
      taskSel.onchange = (e) => {
        selectedTaskId = e.target.value;
      };
    }

    const startBtn = document.getElementById('focus-start-btn');
    if (startBtn) startBtn.onclick = () => startTimer(rerender);

    const pauseBtn = document.getElementById('focus-pause-btn');
    if (pauseBtn) pauseBtn.onclick = () => togglePause(rerender);

    const stopBtn = document.getElementById('focus-stop-btn');
    if (stopBtn) stopBtn.onclick = () => stopOrFinish(rerender);

    const ambBtn = document.getElementById('focus-ambient-hall');
    if (ambBtn) {
      ambBtn.onclick = () => {
        if (zenMode) setZenMode(false);
        window.AppState.setActiveTab('hall');
        if (window.StudyApp) window.StudyApp.renderAll(true);
      };
    }
    window.BookshelfModule.bindEvents(rerender);
  }

  function startSyncedSprint(mins) {
    if (isRunning) {
      window.AppState.setActiveTab('focus');
      if (window.StudyApp) window.StudyApp.renderAll(true);
      return;
    }
    mode = 'pomodoro';
    targetMinutes = clampFocusMinutes(mins);
    totalSec = getConfiguredTotalSec();
    saveFocusPrefs();
    window.AppState.setActiveTab('focus');
    startTimer(() => { if (window.StudyApp) window.StudyApp.renderAll(true); });
  }

  return {
    syncFromSettings,
    applyRemoteTimerState,
    startSyncedSprint,
    render,
    bindEvents
  };
})();