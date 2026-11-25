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
  let sessionId = null;
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
      sessionId = null;
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

    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(st));
    } catch (e) {}

    if (!isPaused && lastRerender) {
      runTickInterval(lastRerender);
    } else if (isPaused && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
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

  function tickCheck(rerender) {
    if (!isRunning || isPaused) return;
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

  function buildScheduledPushMeta() {
    const tag = window.AppUI ? window.AppUI.getTagById(selectedTagId) : null;
    const mins = targetMinutes === 0 ? 5 : targetMinutes;
    const counts = tag && tag.countsForChallenge;
    return {
      sessionId,
      title: counts ? t('notifCompleteTitle') : t('notifCompleteShelfTitle'),
      body: counts ? t('notifCompleteChallenge', { m: mins }) : t('notifCompleteShelf', { m: mins })
    };
  }

  function startTimer(rerender) {
    if (isRunning) return;
    window.AppUI.unlockAudio();
    totalSec = getConfiguredTotalSec();
    accumulatedSec = 0;
    startedAt = Date.now();
    sessionId = 'bk_' + startedAt;
    isRunning = true;
    isPaused = false;
    saveTimerState(true);
    if (mode === 'pomodoro' && window.PushManagerClient) {
      window.PushManagerClient.scheduleTimerPush(totalSec, buildScheduledPushMeta());
    }
    runTickInterval(rerender);
    if (rerender) rerender();
  }

  function togglePause(rerender) {
    if (!isRunning) return;
    if (!isPaused) {
      accumulatedSec = getLiveElapsedSec();
      startedAt = null;
      isPaused = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (window.PushManagerClient) {
        window.PushManagerClient.cancelTimerPush();
      }
    } else {
      startedAt = Date.now();
      isPaused = false;
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
    const finalElapsed = (mode === 'pomodoro' && naturalFinish)
      ? totalSec
      : (mode === 'pomodoro' && totalSec > 0 ? Math.min(totalSec, liveElapsed) : liveElapsed);
    const finishedId = sessionId || ('bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
    isPaused = false;
    accumulatedSec = 0;
    startedAt = null;
    sessionId = null;
    saveTimerState(false);
    if (window.PushManagerClient) {
      window.PushManagerClient.cancelTimerPush();
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
      createdAt: new Date().toISOString()
    };

    data.books.push(book);

    const tag = window.AppUI.getTagById(selectedTagId);
    const roundedM = Math.round(actualMinutes);
    if (completed && tag && tag.countsForChallenge) {
      window.LedgerEngine.addStudyMinutesToDate(todayISO, actualMinutes, true);
      window.AppState.save(true, true);
      window.AppUI.sendSessionNotification(
        t('notifCompleteTitle'),
        t('notifCompleteChallenge', { m: roundedM })
      );
      window.AppUI.showToast(t('toastCompleteChallenge', { m: roundedM }), 'success');
    } else if (completed) {
      window.AppState.save(true, true);
      window.AppUI.sendSessionNotification(
        t('notifCompleteShelfTitle'),
        t('notifCompleteShelf', { m: roundedM })
      );
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
      clockEl.textContent = formatMMSS(rem);
      if (ringEl && totalSec > 0) {
        const circumference = 2 * Math.PI * 84;
        const progress = Math.min(1, elapsed / totalSec);
        ringEl.style.strokeDashoffset = String(circumference * (1 - progress));
      }
    } else {
      clockEl.textContent = formatMMSS(elapsed);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isRunning && !isPaused) {
      tickCheck(lastRerender);
    }
  });

  function render() {
    restoreTimerState();
    const data = window.AppState.getData();
    const tag = window.AppUI.getTagById(selectedTagId);
    const activeColor = tag ? tag.color : '#6366f1';
    const pendingTasks = window.TasksModule ? window.TasksModule.getPendingSuggestions() : [];

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
      ? t('paused')
      : (mode === 'pomodoro' ? formatDurationLabel(targetMinutes) : t('countingUp'));

    return `
      <div class="space-y-4">
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-1.5">
              <h2 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('focusSession')}</h2>
              ${window.AppUI.infoButtonHtml('info-focus-btn')}
            </div>
            ${mode === 'pomodoro' ? `
              <button id="focus-quick-test" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-medium">
                ${t('quickTest')}
              </button>
            ` : ''}
          </div>

          <div class="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl mb-4">
            <button id="mode-pomodoro" ${isRunning ? 'disabled' : ''} class="flex-1 py-2 rounded-lg text-xs font-bold transition ${mode === 'pomodoro' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
              ${t('pomodoro')}
            </button>
            <button id="mode-stopwatch" ${isRunning ? 'disabled' : ''} class="flex-1 py-2 rounded-lg text-xs font-bold transition ${mode === 'stopwatch' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
              ${t('stopwatch')}
            </button>
          </div>

          <div id="focus-dial-container" class="relative w-48 h-48 mx-auto my-2 flex items-center justify-center" style="${mode === 'pomodoro' && !isRunning ? 'touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;' : ''}">
            <svg id="focus-dial-svg" class="w-48 h-48" viewBox="0 0 192 192" style="overflow:visible">
              <circle cx="96" cy="96" r="84" fill="none" stroke="currentColor" stroke-width="8" class="text-slate-100 dark:text-slate-700"/>
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
                <circle id="focus-dial-knob" cx="${knobPos.x.toFixed(2)}" cy="${knobPos.y.toFixed(2)}" r="9"
                  fill="#ffffff" stroke="${activeColor}" stroke-width="3"
                  style="cursor:grab"/>
              ` : ''}
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center" style="pointer-events:none">
              <button id="focus-clock-btn" type="button" style="pointer-events:${mode === 'pomodoro' && !isRunning ? 'auto' : 'none'}" title="${isAr() ? 'اضغط لضبط الوقت بدقة' : 'Tap to set exact time'}">
                <span id="focus-clock-text" dir="ltr" class="font-extrabold tracking-wider text-slate-800 dark:text-white font-mono" style="font-size:${displaySec >= 3600 ? '1.5rem' : '1.875rem'};line-height:1.15">${formatMMSS(displaySec)}</span>
              </button>
              <span id="focus-status-sub" class="text-[11px] mt-1 font-medium ${isPaused ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-slate-400'}">
                ${statusSub}
              </span>
            </div>
          </div>

          ${mode === 'pomodoro' ? `
            <div class="flex items-center justify-center mt-2 mb-4">
              <button id="focus-end-time-pill" type="button" ${isRunning ? 'disabled' : ''}
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:opacity-80">
                <span>⏰</span>
                <span id="focus-end-time-label">${isAr() ? 'ينتهي' : 'Ends'} ${formatEndClock(isRunning ? Math.ceil(displaySec / 60) : targetMinutes)}</span>
                ${!isRunning ? `<span class="opacity-60 text-[10px]">✎</span>` : ''}
              </button>
            </div>
          ` : ''}

          ${(() => {
            const linkedSubjects = (data.subjects || []).filter(s => s.defaultTagId === selectedTagId);
            const hasLinkedSubjects = linkedSubjects.length > 0;
            if (linkType === 'subject' && !hasLinkedSubjects) {
              selectedSubjectId = '';
            }
            const showRightCol = (linkType === 'task') || hasLinkedSubjects;
            return `
          <div class="grid grid-cols-1 ${showRightCol ? 'sm:grid-cols-2' : ''} gap-2.5 mb-4 items-end">
            <div>
              <div class="flex items-center justify-between mb-1" style="min-height:26px">
                <label class="text-[11px] font-medium text-slate-500 dark:text-slate-400">${t('tagLabel')}</label>
                ${!showRightCol ? `
                  <button type="button" id="focus-link-task" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    + ${t('taskLabel')}
                  </button>
                ` : ''}
              </div>
              <select id="focus-tag-select" ${isRunning ? 'disabled' : ''} class="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
                ${data.tags.map(tg => `<option value="${window.AppUI.escapeHtml(tg.id)}" ${tg.id === selectedTagId ? 'selected' : ''}>${window.AppUI.escapeHtml(tg.name)}</option>`).join('')}
              </select>
            </div>
            ${showRightCol ? `
            <div>
              <div class="flex items-center justify-between mb-1" style="min-height:26px">
                <label class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  ${linkType === 'subject' ? t('subjectLabel') : t('taskLabel')}
                </label>
                <div class="inline-flex rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5 text-[10px]">
                  ${hasLinkedSubjects ? `
                    <button type="button" id="focus-link-subject" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md font-bold transition ${linkType === 'subject' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                      ${t('subjectLabel')}
                    </button>
                  ` : ''}
                  <button type="button" id="focus-link-task" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md font-bold transition ${linkType === 'task' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                    ${t('taskLabel')}
                  </button>
                </div>
              </div>
              ${linkType === 'subject' ? `
                <select id="focus-subject-select" ${isRunning ? 'disabled' : ''} class="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
                  <option value="">${window.AppUI.escapeHtml(t('noSubject'))}</option>
                  ${linkedSubjects.map(s => `<option value="${window.AppUI.escapeHtml(s.id)}" ${s.id === selectedSubjectId ? 'selected' : ''}>${window.AppUI.escapeHtml(s.name)}</option>`).join('')}
                </select>
              ` : `
                <select id="focus-task-select" ${isRunning ? 'disabled' : ''} class="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs">
                  <option value="">${window.AppUI.escapeHtml(t('noTask'))}</option>
                  ${pendingTasks.map(tk => `<option value="${window.AppUI.escapeHtml(tk.id)}" ${tk.id === selectedTaskId ? 'selected' : ''}>${window.AppUI.escapeHtml(tk.title)}</option>`).join('')}
                </select>
              `}
            </div>
            ` : ''}
          </div>
            `;
          })()}

          <div class="flex gap-2">
            ${!isRunning ? `
              <button id="focus-start-btn" class="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition">
                ${t('startFocus')}
              </button>
            ` : `
              <button id="focus-pause-btn" class="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold text-sm shadow-sm transition">
                ${isPaused ? t('resume') : t('pause')}
              </button>
              <button id="focus-stop-btn" class="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-sm transition">
                ${mode === 'stopwatch' ? t('finish') : t('stop')}
              </button>
            `}
          </div>
        </div>

        ${window.BookshelfModule.renderSection()}
      </div>
    `;
  }

  function bindEvents(rerender) {
    lastRerender = rerender;
    if (isRunning && !isPaused) {
      tickCheck(rerender);
      if (isRunning && !intervalId) runTickInterval(rerender);
    }

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

    window.BookshelfModule.bindEvents(rerender);
  }

  return {
    syncFromSettings,
    applyRemoteTimerState,
    render,
    bindEvents
  };
})();
