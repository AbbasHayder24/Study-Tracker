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

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
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
      finishSession(true, rerender || lastRerender);
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
      finishSession((elapsed / 60) >= 5, rerender);
    } else {
      const completed = targetMinutes === 0 ? elapsed >= 5 : (elapsed / 60) >= 5;
      finishSession(completed, rerender);
    }
  }

  function finishSession(completed, rerender) {
    const finalElapsed = mode === 'pomodoro' && completed ? totalSec : getLiveElapsedSec();
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
    const progress = mode === 'pomodoro' && totalSec > 0 && isRunning ? Math.min(1, elapsed / totalSec) : 0;
    const dashOffset = circumference * (1 - progress);

    const statusSub = isPaused
      ? t('paused')
      : (mode === 'pomodoro' ? (targetMinutes === 0 ? t('quickTestSub') : t('minLabel', { m: targetMinutes })) : t('countingUp'));

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

          <div class="relative w-48 h-48 mx-auto my-2 flex items-center justify-center">
            <svg class="w-48 h-48 -rotate-90" viewBox="0 0 192 192">
              <circle cx="96" cy="96" r="84" fill="none" stroke="currentColor" stroke-width="10" class="text-slate-100 dark:text-slate-700"/>
              <circle id="focus-progress-ring" cx="96" cy="96" r="84" fill="none" stroke="${activeColor}" stroke-width="10" stroke-linecap="round"
                stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" class="transition-all duration-300"/>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span id="focus-clock-text" dir="ltr" class="text-3xl font-extrabold tracking-wider text-slate-800 dark:text-white font-mono">${formatMMSS(displaySec)}</span>
              <span id="focus-status-sub" class="text-[11px] mt-1 font-medium ${isPaused ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-slate-400'}">
                ${statusSub}
              </span>
            </div>
          </div>

          ${mode === 'pomodoro' ? `
            <div class="mt-3 mb-4" dir="ltr">
              <input id="focus-duration-slider" type="range" min="5" max="90" step="5" value="${targetMinutes === 0 ? 5 : targetMinutes}" ${isRunning ? 'disabled' : ''} class="w-full accent-indigo-600 cursor-pointer"/>
              <div class="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>5m</span><span>25m</span><span>50m</span><span>75m</span><span>90m</span>
              </div>
            </div>
          ` : ''}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
            <div>
              <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">${t('tagLabel')}</label>
              <select id="focus-tag-select" ${isRunning ? 'disabled' : ''} class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
                ${data.tags.map(tg => `<option value="${window.AppUI.escapeHtml(tg.id)}" ${tg.id === selectedTagId ? 'selected' : ''}>${window.AppUI.escapeHtml(tg.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  ${linkType === 'subject' ? t('subjectLabel') : t('taskLabel')}
                </label>
                <div class="inline-flex rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5 text-[10px]">
                  <button type="button" id="focus-link-subject" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md font-bold transition ${linkType === 'subject' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                    ${t('subjectLabel')}
                  </button>
                  <button type="button" id="focus-link-task" ${isRunning ? 'disabled' : ''} class="px-2 py-0.5 rounded-md font-bold transition ${linkType === 'task' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                    ${t('taskLabel')}
                  </button>
                </div>
              </div>
              ${linkType === 'subject' ? `
                <select id="focus-subject-select" ${isRunning ? 'disabled' : ''} class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
                  <option value="">${window.AppUI.escapeHtml(t('noSubject'))}</option>
                  ${data.subjects.map(s => `<option value="${window.AppUI.escapeHtml(s.id)}" ${s.id === selectedSubjectId ? 'selected' : ''}>${window.AppUI.escapeHtml(s.name)}</option>`).join('')}
                </select>
              ` : `
                <select id="focus-task-select" ${isRunning ? 'disabled' : ''} class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs">
                  <option value="">${window.AppUI.escapeHtml(t('noTask'))}</option>
                  ${pendingTasks.map(tk => `<option value="${window.AppUI.escapeHtml(tk.id)}" ${tk.id === selectedTaskId ? 'selected' : ''}>${window.AppUI.escapeHtml(tk.title)}</option>`).join('')}
                </select>
              `}
            </div>
          </div>

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

    const slider = document.getElementById('focus-duration-slider');
    if (slider) {
      slider.oninput = (e) => {
        targetMinutes = Number(e.target.value);
        totalSec = getConfiguredTotalSec();
        const clockEl = document.getElementById('focus-clock-text');
        if (clockEl) clockEl.textContent = formatMMSS(totalSec);
        const subEl = document.getElementById('focus-status-sub');
        if (subEl) subEl.textContent = t('minLabel', { m: targetMinutes });
      };
      slider.onchange = () => { saveFocusPrefs(); };
    }

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
    if (tagSel) tagSel.onchange = (e) => { selectedTagId = e.target.value; saveFocusPrefs(); rerender(); };

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
