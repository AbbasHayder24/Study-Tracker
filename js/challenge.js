/**
 * challenge.js — Challenge tab: summary dashboard, customizable challenge editor, dynamic day log, and reviews (EN/AR)
 */
window.ChallengeModule = (function () {
  let previewPenalty = false;
  let subView = 'summary';
  let selectedWeek = 'all';

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function openEditChallengeModal(rerender) {
    const C = window.APP_CONFIG;
    const data = window.AppState.getData();
    const cfg = window.LedgerEngine.getChallengeConfig();
    const isAr = window.I18n && window.I18n.isRTL();
    const dayNames = isAr ? C.CHALLENGE.DAY_NAMES_AR : C.CHALLENGE.DAY_NAMES;
    // Order starting Saturday (6) -> Friday (5)
    const dayOrder = [6, 0, 1, 2, 3, 4, 5];
    const hUnit = t('hrs');

    window.AppUI.openModal({
      title: t('editChallengeTitle'),
      bodyHtml: `
        <div class="space-y-3 max-h-[65vh] overflow-y-auto pr-0.5">
          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('challengeNameLabel')}</label>
            <input id="ch-edit-name" type="text" value="${window.AppUI.escapeHtml(cfg.name)}" placeholder="${window.AppUI.escapeHtml(t('challengeTitle'))}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"/>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('startDateShort')}</label>
              <input id="ch-edit-start" type="date" value="${window.AppUI.escapeHtml(data.startDate)}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('durationWeeksLabel')}</label>
              <input id="ch-edit-weeks" type="number" min="1" max="52" step="1" value="${cfg.totalWeeks}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">${t('dailyTargetsLabel')}</label>
            <div class="grid grid-cols-4 gap-1.5">
              ${dayOrder.map(dow => `
                <div class="bg-slate-50 dark:bg-slate-900 rounded-xl p-1.5 border border-slate-200 dark:border-slate-700 text-center">
                  <div class="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">${dayNames[dow]}</div>
                  <input data-ch-dow="${dow}" type="number" min="0" max="24" step="0.5" value="${cfg.dailyTargets[dow]}" class="ch-dow-input w-full text-center px-1 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"/>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">${t('weeklyFlexLabel')}</label>
              <input id="ch-edit-flex" type="number" min="0" max="40" step="0.5" value="${cfg.weeklyFlexHours}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">${t('dailyGraceLabel')}</label>
              <input id="ch-edit-grace" type="number" min="0" max="4" step="0.25" value="${cfg.dailyGraceHours}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">${t('penaltyLimitLabel')}</label>
              <input id="ch-edit-penalty" type="number" min="1" max="100" step="1" value="${cfg.penaltyThresholdHours}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
          </div>

          <div id="ch-edit-preview" class="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold text-center">
            ${cfg.totalDays}d • ${window.AppUI.formatHours(cfg.weeklyTarget)}${hUnit}/wk • ${window.AppUI.formatHours(cfg.totalTargetHours)}${hUnit}
          </div>
        </div>
      `,
      footerHtml: `
        <button id="ch-edit-reset" type="button" class="px-3 py-2 rounded-xl text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 mr-auto">${t('resetDefaults')}</button>
        <button id="ch-edit-cancel" type="button" class="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${t('cancel')}</button>
        <button id="ch-edit-save" type="button" class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">${t('save')}</button>
      `
    });

    const updatePreview = () => {
      const wks = Math.max(1, Math.min(52, Math.round(Number(document.getElementById('ch-edit-weeks').value) || 1)));
      let wkSum = 0;
      document.querySelectorAll('.ch-dow-input').forEach(inp => {
        const v = Number(inp.value);
        if (Number.isFinite(v) && v >= 0) wkSum += Math.min(24, v);
      });
      const totalHrs = Math.round(wkSum * wks * 100) / 100;
      const previewEl = document.getElementById('ch-edit-preview');
      if (previewEl) {
        previewEl.textContent = t('challengePreviewLine', {
          days: wks * 7,
          wk: window.AppUI.formatHours(wkSum),
          total: window.AppUI.formatHours(totalHrs)
        });
      }
    };

    updatePreview();
    document.getElementById('ch-edit-weeks').oninput = updatePreview;
    document.querySelectorAll('.ch-dow-input').forEach(inp => { inp.oninput = updatePreview; });

    document.getElementById('ch-edit-cancel').onclick = window.AppUI.closeModal;

    document.getElementById('ch-edit-reset').onclick = () => {
      document.getElementById('ch-edit-name').value = '';
      document.getElementById('ch-edit-weeks').value = C.CHALLENGE.TOTAL_WEEKS;
      document.getElementById('ch-edit-flex').value = C.CHALLENGE.WEEKLY_FLEX_HOURS;
      document.getElementById('ch-edit-grace').value = C.CHALLENGE.DAILY_GRACE_HOURS;
      document.getElementById('ch-edit-penalty').value = C.CHALLENGE.PENALTY_THRESHOLD_HOURS;
      document.querySelectorAll('.ch-dow-input').forEach(inp => {
        const dow = Number(inp.getAttribute('data-ch-dow'));
        inp.value = C.CHALLENGE.DAILY_TARGETS[dow];
      });
      updatePreview();
    };

    document.getElementById('ch-edit-save').onclick = () => {
      const newName = document.getElementById('ch-edit-name').value.trim();
      const newStart = document.getElementById('ch-edit-start').value;
      const newWeeks = Math.max(1, Math.min(52, Math.round(Number(document.getElementById('ch-edit-weeks').value) || C.CHALLENGE.TOTAL_WEEKS)));
      const newFlex = Math.max(0, Number(document.getElementById('ch-edit-flex').value) || 0);
      const newGrace = Math.max(0, Number(document.getElementById('ch-edit-grace').value) || 0);
      const newPenalty = Math.max(1, Number(document.getElementById('ch-edit-penalty').value) || C.CHALLENGE.PENALTY_THRESHOLD_HOURS);

      const newTargets = {};
      document.querySelectorAll('.ch-dow-input').forEach(inp => {
        const dow = Number(inp.getAttribute('data-ch-dow'));
        const v = Number(inp.value);
        newTargets[dow] = Number.isFinite(v) && v >= 0 ? Math.min(24, v) : 0;
      });

      if (!data.settings) data.settings = {};
      data.settings.challenge = {
        name: newName,
        totalWeeks: newWeeks,
        weeklyFlexHours: newFlex,
        dailyGraceHours: newGrace,
        penaltyThresholdHours: newPenalty,
        dailyTargets: newTargets
      };

      if (newStart && newStart !== data.startDate) {
        data.startDate = newStart;
        data.startDateUpdatedAt = Date.now();
      }

      if (selectedWeek !== 'all' && Number(selectedWeek) > newWeeks) {
        selectedWeek = 'all';
      }

      window.AppState.markLedgerDirty();
      window.AppState.save(true);
      window.AppUI.closeModal();
      window.AppUI.showToast(t('challengeUpdatedToast'), 'success');
      if (rerender) rerender();
    };
  }

  function renderSummary(ledger) {
    const today = ledger.todayDay;
    const todayTarget = today ? today.target : window.LedgerEngine.getDailyTarget(ledger.todayISO);
    const todayLogged = today ? today.logged : 0;
    const todayPct = todayTarget > 0 ? Math.min(100, Math.round((todayLogged / todayTarget) * 100)) : 0;
    const biWeekTag = ledger.biWeekLabel ? ` (${ledger.biWeekLabel})` : '';
    const hUnit = t('hrs');
    const titleText = ledger.challengeName ? `🏆 ${window.AppUI.escapeHtml(ledger.challengeName)}` : t('challengeTitle');

    return `
      <div class="space-y-3">
        ${(() => { const list = [...(ledger.pendingPenalties || [])]; if (previewPenalty) list.unshift({ key: '__preview_penalty__', label: 'W1-W2', deficit: 2.5, isPreview: true }); return list.length > 0 ? list.map(p => {
          const ar = !!(window.I18n && window.I18n.isRTL());
          const hrsTxt = window.AppUI.formatHours(p.deficit);
          const msg = ar
            ? `⚠️ <strong>عقوبة مستحقة (${window.AppUI.escapeHtml(p.label)}):</strong> انتهى الأسبوع الثاني بعجز <strong>${hrsTxt}${hUnit}</strong>. لن يختفي هذا التنبيه حتى تؤكد تنفيذ العقوبة.`
            : `⚠️ <strong>Penalty Due (${window.AppUI.escapeHtml(p.label)}):</strong> Completed 2-week period with a <strong>${hrsTxt}${hUnit}</strong> deficit. This alert stays until you confirm the penalty is applied.`;
          const btnTxt = ar ? '✅ أكّدت تنفيذ العقوبة' : '✅ Confirm Penalty Applied';
          return `
          <div class="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-900/30 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs font-medium space-y-2.5">
            <div>${msg}</div>
            <button type="button" data-confirm-penalty="${window.AppUI.escapeHtml(p.key)}" data-penalty-label="${window.AppUI.escapeHtml(p.label)}"
              class="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold">
              ${btnTxt}
            </button>
          </div>
          `;
        }).join('') : ''; })()}

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">${titleText}</h3>
                ${window.AppUI.infoButtonHtml('info-challenge-btn')}
              </div>
              <p class="text-[11px] text-slate-400">${window.AppUI.formatDate(ledger.startDate)} – ${window.AppUI.formatDate(ledger.endDate)}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button id="test-penalty-btn" type="button" class="px-2 py-1 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title="${(window.I18n && window.I18n.isRTL()) ? 'تجربة ظهور العقوبة' : 'Preview Penalty'}">
                🧪
              </button>
              <button id="edit-challenge-btn" type="button" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                ⚙️ ${t('edit')}
              </button>
              <span class="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">${ledger.overallPercent}%</span>
            </div>
          </div>
          <div class="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-2">
            <div class="h-full rounded-full bg-gradient-to-r from-indigo-600 to-sky-500 transition-all" style="width:${ledger.overallPercent}%"></div>
          </div>
          <div class="flex justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>${t('loggedLabel')} <strong>${window.AppUI.formatHours(ledger.totalLogged)}${hUnit}</strong></span>
            <span>${t('goalLabel')} <strong>${window.AppUI.formatHours(ledger.totalTarget)}${hUnit}</strong></span>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('todayHeader', { day: window.LedgerEngine.getDayName(ledger.todayISO) })}</h4>
              <p class="text-[11px] text-slate-400">${today ? t('dayOfWeek', { d: today.dayNumber, total: ledger.totalDays, w: today.weekNumber }) : t('outsideRange')}</p>
            </div>
            <button type="button" data-edit-day="${ledger.todayISO}" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              ${t('edit')}
            </button>
          </div>
          <div class="flex justify-between text-xs mb-1">
            <span>${window.AppUI.formatHours(todayLogged)} / ${window.AppUI.formatHours(todayTarget)}${hUnit}</span>
            <span class="font-bold">${todayPct}%</span>
          </div>
          <div class="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div class="h-full rounded-full ${todayLogged >= todayTarget ? 'bg-emerald-500' : 'bg-indigo-500'}" style="width:${todayPct}%"></div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2.5">
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700 text-center">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('hourBank')}</div>
            <div class="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">+${window.AppUI.formatHours(ledger.hourBank)}${hUnit}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700 text-center">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('deficitLabel')}${biWeekTag}</div>
            <div class="text-base font-extrabold ${ledger.penaltyAlert ? 'text-rose-600' : 'text-amber-600 dark:text-amber-400'} mt-0.5">${window.AppUI.formatHours(ledger.carriedDeficit)}${hUnit}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700 text-center">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('flexUsed')}</div>
            <div class="text-base font-extrabold text-sky-600 dark:text-sky-400 mt-0.5">${window.AppUI.formatHours(ledger.totalFlexUsed)}${hUnit}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderDailyLog(ledger) {
    const hUnit = t('hrs');
    const weeksOptions = ledger.weeks.map(w =>
      `<option value="${w.weekNumber}" ${String(selectedWeek) === String(w.weekNumber) ? 'selected' : ''}>${t('weekOption', { w: w.weekNumber, logged: window.AppUI.formatHours(w.logged), target: window.AppUI.formatHours(w.target) })}</option>`
    ).join('');

    const filteredDays = selectedWeek === 'all'
      ? ledger.days
      : ledger.days.filter(d => d.weekNumber === Number(selectedWeek));

    return `
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <select id="challenge-week-filter" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium">
            <option value="all" ${selectedWeek === 'all' ? 'selected' : ''}>${t('allDaysCount', { n: ledger.totalDays })}</option>
            ${weeksOptions}
          </select>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div class="max-h-[460px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/70">
            ${filteredDays.map(d => {
              const diffColor = d.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : (d.inGrace ? 'text-sky-600 dark:text-sky-400' : 'text-rose-500');
              const diffSign = d.diff > 0 ? '+' : '';
              return `
                <div class="px-3.5 py-2.5 flex items-center justify-between gap-2 ${d.isToday ? 'bg-indigo-50/70 dark:bg-indigo-900/20' : ''}">
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-slate-800 dark:text-slate-100">
                      ${t('dayRowMeta', { d: d.dayNumber, day: d.dayName })} ${d.isToday ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white ml-1">${t('dayBadgeToday')}</span>` : ''}
                    </div>
                    <div class="text-[11px] text-slate-400">${window.AppUI.formatDate(d.iso)} • ${t('weekNum', { w: d.weekNumber })}</div>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <div class="text-right">
                      <div class="text-xs font-bold text-slate-800 dark:text-slate-100">${window.AppUI.formatHours(d.logged)} / ${window.AppUI.formatHours(d.target)}${hUnit}</div>
                      <div class="text-[10px] font-medium ${d.isFuture && d.logged === 0 ? 'text-slate-400' : diffColor}">
                        ${d.isFuture && d.logged === 0 ? t('upcoming') : (d.inGrace ? t('graceOk') : `${diffSign}${window.AppUI.formatHours(d.diff)}${hUnit}`)}
                      </div>
                    </div>
                    <button type="button" data-edit-day="${d.iso}" class="px-2 py-1 rounded-lg text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-100">
                      ${t('edit')}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const ledger = window.LedgerEngine.computeLedger();

    return `
      <div class="space-y-4">
        <div class="flex p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <button data-ch-sub="summary" class="flex-1 py-2 rounded-lg text-xs font-bold transition ${subView === 'summary' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}">${t('summaryTab')}</button>
          <button data-ch-sub="log" class="flex-1 py-2 rounded-lg text-xs font-bold transition ${subView === 'log' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}">${t('logTabDynamic', { n: ledger.totalDays })}</button>
          <button data-ch-sub="reviews" class="flex-1 py-2 rounded-lg text-xs font-bold transition ${subView === 'reviews' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}">${t('reviewsTab')}</button>
        </div>

        ${subView === 'summary' ? renderSummary(ledger) : ''}
        ${subView === 'log' ? renderDailyLog(ledger) : ''}
        ${subView === 'reviews' ? window.ReviewsModule.render(ledger) : ''}
      </div>
    `;
  }

  function bindEvents(rerender) {
    const ledger = window.LedgerEngine.computeLedger();
    const hUnit = t('hrs');

    const editChBtn = document.getElementById('edit-challenge-btn');
    if (editChBtn) {
      editChBtn.onclick = () => openEditChallengeModal(rerender);
    }

    const infoBtn = document.getElementById('info-challenge-btn');
    if (infoBtn) {
      infoBtn.onclick = () => {
        const c = ledger.config;
        window.AppUI.showInfo(t('challengeInfoTitle'), t('challengeInfoDynamic', {
          total: window.AppUI.formatHours(c.totalTargetHours),
          weeks: c.totalWeeks,
          days: c.totalDays,
          wk: window.AppUI.formatHours(c.weeklyTarget),
          grace: window.AppUI.formatHours(c.dailyGraceHours),
          flex: window.AppUI.formatHours(c.weeklyFlexHours),
          penalty: window.AppUI.formatHours(c.penaltyThresholdHours)
        }));
      };
    }

    document.querySelectorAll('[data-ch-sub]').forEach(btn => {
      btn.onclick = () => {
        subView = btn.getAttribute('data-ch-sub');
        rerender();
      };
    });

    const wkFilter = document.getElementById('challenge-week-filter');
    if (wkFilter) {
      wkFilter.onchange = (e) => {
        selectedWeek = e.target.value;
        rerender();
      };
    }

    document.querySelectorAll('[data-edit-day]').forEach(btn => {
      btn.onclick = () => {
        const iso = btn.getAttribute('data-edit-day');
        const data = window.AppState.getData();
        const entry = data.dailyLogs[iso] || { hours: 0, note: '' };
        const target = window.LedgerEngine.getDailyTarget(iso);

        window.AppUI.openModal({
          title: t('editDayTitle', { day: window.LedgerEngine.getDayName(iso), date: window.AppUI.formatDate(iso) }),
          bodyHtml: `
            <div class="space-y-3">
              <div class="text-xs text-slate-500">${t('dailyTargetText')} <strong>${target}${hUnit}</strong></div>
              <div>
                <label class="block text-xs font-medium mb-1">${t('loggedHoursLabel')}</label>
                <input id="day-log-hours" type="number" step="0.25" min="0" max="24" value="${entry.hours || 0}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"/>
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">${t('noteLabel')}</label>
                <input id="day-log-note" type="text" value="${window.AppUI.escapeHtml(entry.note || '')}" placeholder="${window.AppUI.escapeHtml(t('notePlaceholder'))}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"/>
              </div>
            </div>
          `,
          footerHtml: `
            <button id="day-log-cancel" class="px-4 py-2 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${t('cancel')}</button>
            <button id="day-log-save" class="px-4 py-2 rounded-xl text-sm bg-indigo-600 text-white font-medium">${t('save')}</button>
          `
        });

        document.getElementById('day-log-cancel').onclick = window.AppUI.closeModal;
        document.getElementById('day-log-save').onclick = () => {
          const hrs = document.getElementById('day-log-hours').value;
          const note = document.getElementById('day-log-note').value.trim();
          window.LedgerEngine.setDayLog(iso, hrs, note);
          window.AppUI.closeModal();
          window.AppUI.showToast(t('dayLogUpdated'), 'success');
          rerender();
        };
      };
    });

    const testPenBtn = document.getElementById('test-penalty-btn');
    if (testPenBtn) {
      testPenBtn.onclick = () => {
        previewPenalty = !previewPenalty;
        rerender();
      };
    }

    document.querySelectorAll('[data-confirm-penalty]').forEach(btn => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-confirm-penalty');
        const label = btn.getAttribute('data-penalty-label') || '';
        const ar = !!(window.I18n && window.I18n.isRTL());
        window.AppUI.confirmAction({
          title: ar ? `تأكيد تنفيذ العقوبة (${label})` : `Confirm Penalty (${label})`,
          message: ar
            ? 'هل أنت متأكد أنك نفّذت العقوبة بالكامل؟ بعد التأكيد سيختفي التنبيه لهذه الفترة.'
            : 'Are you sure you have completed the penalty? Confirming will dismiss this alert for this 2-week period.',
          confirmText: ar ? 'نعم، نفّذتها' : 'Yes, Applied',
          danger: true,
          onConfirm: () => {
            if (key === '__preview_penalty__') {
              previewPenalty = false;
            } else {
              window.LedgerEngine.resolvePenalty(key);
            }
            window.AppUI.showToast(ar ? 'تم تأكيد تنفيذ العقوبة وإغلاق التنبيه' : 'Penalty confirmed & cleared', 'success');
            rerender();
          }
        });
      };
    });

    if (subView === 'reviews') {
      window.ReviewsModule.bindEvents(ledger, rerender);
    }
  }

  return {
    openEditChallengeModal,
    render,
    bindEvents
  };
})();
