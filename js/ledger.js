/**
 * ledger.js — Customizable Challenge Calculation Engine (supports custom weeks, daily targets, flex, grace & penalty)
 * Calculates deficit independently for each 2-week period.
 */
window.LedgerEngine = (function () {
  const C = window.APP_CONFIG;

  function getChallengeConfig() {
    const data = window.AppState ? window.AppState.getData() : null;
    const custom = (data && data.settings && data.settings.challenge) || {};
    const defTargets = C.CHALLENGE.DAILY_TARGETS;
    const rawTargets = custom.dailyTargets || {};
    const dailyTargets = {};
    for (let d = 0; d <= 6; d++) {
      const val = Number(rawTargets[d]);
      dailyTargets[d] = Number.isFinite(val) && val >= 0 ? Math.min(24, val) : defTargets[d];
    }

    const totalWeeks = Math.max(1, Math.min(52, Math.round(Number(custom.totalWeeks) || C.CHALLENGE.TOTAL_WEEKS)));
    const totalDays = totalWeeks * 7;
    const weeklyTarget = Math.round(Object.values(dailyTargets).reduce((s, v) => s + v, 0) * 100) / 100;
    const totalTargetHours = Math.round(weeklyTarget * totalWeeks * 100) / 100;
    const weeklyFlexHours = Number.isFinite(Number(custom.weeklyFlexHours)) && Number(custom.weeklyFlexHours) >= 0
      ? Number(custom.weeklyFlexHours)
      : C.CHALLENGE.WEEKLY_FLEX_HOURS;
    const dailyGraceHours = Number.isFinite(Number(custom.dailyGraceHours)) && Number(custom.dailyGraceHours) >= 0
      ? Number(custom.dailyGraceHours)
      : C.CHALLENGE.DAILY_GRACE_HOURS;
    const penaltyThresholdHours = 0;
    const name = typeof custom.name === 'string' ? custom.name.trim() : '';

    return {
      name,
      totalWeeks,
      totalDays,
      dailyTargets,
      weeklyTarget,
      totalTargetHours,
      weeklyFlexHours,
      dailyGraceHours,
      penaltyThresholdHours
    };
  }

  function getDailyTarget(isoDate) {
    const dt = window.AppState.parseLocalISO(isoDate);
    const cfg = getChallengeConfig();
    return cfg.dailyTargets[dt.getDay()] ?? 5.5;
  }

  function getDayName(isoDate) {
    const dt = window.AppState.parseLocalISO(isoDate);
    const list = (window.I18n && window.I18n.isRTL() && C.CHALLENGE.DAY_NAMES_AR)
      ? C.CHALLENGE.DAY_NAMES_AR
      : C.CHALLENGE.DAY_NAMES;
    return list[dt.getDay()];
  }

  function getTodaySummary() {
    const data = window.AppState.getData();
    const todayISO = window.AppState.getLocalTodayISO();
    const target = getDailyTarget(todayISO);
    const entry = data.dailyLogs[todayISO];
    const logged = entry ? Number(entry.hours) || 0 : 0;
    return { todayISO, target, logged };
  }

  function computeLedger() {
    if (!window.AppState.isLedgerDirty() && window.AppState.getCachedLedger()) {
      return window.AppState.getCachedLedger();
    }

    const data = window.AppState.getData();
    const cfg = getChallengeConfig();
    const startDate = data.startDate || window.AppState.getLocalTodayISO();
    const todayISO = window.AppState.getLocalTodayISO();

    const days = [];
    const weeks = [];
    const months = [];

    let totalLogged = 0;
    let totalTargetElapsed = 0;
    let hourBank = 0;
    let carriedDeficit = 0;
    let totalFlexUsed = 0;
    let todayIndex = -1;
    let currentBiWeekIndex = 0;

    const totalMonths = Math.max(1, Math.min(12, Math.round(cfg.totalWeeks / 4.333) || 1));

    for (let i = 0; i < cfg.totalDays; i++) {
      const iso = window.AppState.addDaysISO(startDate, i);
      const target = getDailyTarget(iso);
      const logEntry = data.dailyLogs[iso];
      const logged = logEntry ? Number(logEntry.hours) || 0 : 0;
      const note = logEntry && logEntry.note ? logEntry.note : '';
      const isFuture = iso > todayISO;
      const isToday = iso === todayISO;
      if (isToday) todayIndex = i;

      const diff = logged - target;
      const grace = cfg.dailyGraceHours;
      const inGrace = !isFuture && logged < target && (target - logged) <= grace + 1e-9;
      const effectiveDayNet = inGrace ? 0 : diff;
      if (!isFuture) {
        totalLogged += logged;
        totalTargetElapsed += target;
      }

      days.push({
        dayNumber: i + 1,
        weekNumber: Math.floor(i / 7) + 1,
        monthNumber: Math.min(totalMonths, Math.floor((i * totalMonths) / cfg.totalDays) + 1),
        iso,
        dayName: getDayName(iso),
        target,
        logged,
        diff,
        inGrace,
        effectiveDayNet,
        note,
        isToday,
        isFuture
      });
    }

    for (let w = 0; w < cfg.totalWeeks; w++) {
      const slice = days.slice(w * 7, (w + 1) * 7);
      const weekTarget = Math.round(slice.reduce((acc, d) => acc + d.target, 0) * 100) / 100;
      const weekLogged = slice.reduce((acc, d) => acc + d.logged, 0);
      const allFuture = slice.every(d => d.isFuture);
      const hasStarted = slice.some(d => !d.isFuture);

      let weekDiff = weekLogged - weekTarget;
      let flexUsed = 0;
      let bankDelta = 0;
      let deficitDelta = 0;

      if (hasStarted || weekLogged > 0) {
        if (hasStarted) {
          currentBiWeekIndex = Math.floor(w / 2);
          if (w % 2 === 0) {
            carriedDeficit = 0;
          }
        }

        const elapsedDaysInWeek = slice.filter(d => !d.isFuture);
        const effectiveNet = elapsedDaysInWeek.reduce(
          (sum, d) => sum + (d.isToday && d.effectiveDayNet < 0 ? 0 : d.effectiveDayNet),
          0
        );

        if (effectiveNet >= 0) {
          let surplus = effectiveNet;
          if (carriedDeficit > 0) {
            const paid = Math.min(carriedDeficit, surplus);
            carriedDeficit -= paid;
            surplus -= paid;
            deficitDelta -= paid;
          }
          if (surplus > 0) {
            hourBank += surplus;
            bankDelta += surplus;
          }
        } else {
          const rawDeficit = -effectiveNet;
          flexUsed = Math.min(cfg.weeklyFlexHours, rawDeficit);
          totalFlexUsed += flexUsed;
          const afterFlex = rawDeficit - flexUsed;

          if (afterFlex > 0) {
            const drawnFromBank = Math.min(hourBank, afterFlex);
            hourBank -= drawnFromBank;
            bankDelta -= drawnFromBank;

            const remainingDeficit = afterFlex - drawnFromBank;
            if (remainingDeficit > 0) {
              carriedDeficit += remainingDeficit;
              deficitDelta += remainingDeficit;
            }
          }
        }
      }

      weeks.push({
        weekNumber: w + 1,
        biWeekNumber: Math.floor(w / 2) + 1,
        startDate: slice[0].iso,
        endDate: slice[slice.length - 1].iso,
        target: weekTarget,
        logged: Math.round(weekLogged * 100) / 100,
        diff: Math.round(weekDiff * 100) / 100,
        flexUsed: Math.round(flexUsed * 100) / 100,
        bankDelta: Math.round(bankDelta * 100) / 100,
        deficitDelta: Math.round(deficitDelta * 100) / 100,
        bankAfter: Math.round(hourBank * 100) / 100,
        deficitAfter: Math.round(carriedDeficit * 100) / 100,
        allFuture,
        days: slice
      });
    }

    // Build balanced monthly buckets across totalDays
    for (let mIdx = 0; mIdx < totalMonths; mIdx++) {
      const startIdx = Math.floor((mIdx * cfg.totalDays) / totalMonths);
      const endIdx = Math.floor(((mIdx + 1) * cfg.totalDays) / totalMonths);
      const slice = days.slice(startIdx, endIdx);
      if (!slice.length) continue;
      const mTarget = slice.reduce((s, d) => s + d.target, 0);
      const mLogged = slice.reduce((s, d) => s + d.logged, 0);
      months.push({
        monthNumber: mIdx + 1,
        label: `Month ${mIdx + 1}`,
        startDate: slice[0].iso,
        endDate: slice[slice.length - 1].iso,
        target: Math.round(mTarget * 100) / 100,
        logged: Math.round(mLogged * 100) / 100,
        percent: mTarget > 0 ? Math.min(100, Math.round((mLogged / mTarget) * 100)) : 0
      });
    }

    const elapsedDaysCount = days.filter(d => !d.isFuture).length;
    const avgDailyHours = elapsedDaysCount > 0 ? totalLogged / elapsedDaysCount : 0;
    const bestWeek = weeks.reduce((best, w) => (w.logged > (best ? best.logged : -1) ? w : best), null);
    const roundedDeficit = Math.round(carriedDeficit * 100) / 100;
    const resolvedPenalties = (data && data.resolvedPenalties && typeof data.resolvedPenalties === 'object')
      ? data.resolvedPenalties
      : {};
    const pendingPenalties = [];
    for (let bwIdx = 0; bwIdx * 2 < weeks.length; bwIdx++) {
      const w1 = weeks[bwIdx * 2];
      const w2 = weeks[bwIdx * 2 + 1];
      const endWeek = w2 || w1;
      const lastDay = endWeek && endWeek.days && endWeek.days[endWeek.days.length - 1];
      const periodFullyEnded = !!(lastDay && !lastDay.isFuture && !lastDay.isToday);
      if (periodFullyEnded && endWeek.deficitAfter > 0) {
        const pKey = `bw_${bwIdx + 1}_${endWeek.endDate}`;
        if (!resolvedPenalties[pKey]) {
          pendingPenalties.push({
            key: pKey,
            biWeekNumber: bwIdx + 1,
            label: w2 ? `W${w1.weekNumber}-W${w2.weekNumber}` : `W${w1.weekNumber}`,
            deficit: endWeek.deficitAfter,
            endDate: endWeek.endDate
          });
        }
      }
    }
    const penaltyAlert = pendingPenalties.length > 0;
    const biWeekStart = currentBiWeekIndex * 2 + 1;
    const biWeekEnd = Math.min(cfg.totalWeeks, biWeekStart + 1);

    const result = {
      config: cfg,
      challengeName: cfg.name,
      totalDays: cfg.totalDays,
      totalWeeks: cfg.totalWeeks,
      totalMonths: months.length,
      weeklyTarget: cfg.weeklyTarget,
      startDate,
      endDate: days[days.length - 1].iso,
      todayISO,
      todayIndex,
      todayDay: todayIndex >= 0 ? days[todayIndex] : null,
      totalTarget: cfg.totalTargetHours,
      totalLogged: Math.round(totalLogged * 100) / 100,
      totalTargetElapsed: Math.round(totalTargetElapsed * 100) / 100,
      overallPercent: cfg.totalTargetHours > 0
        ? Math.min(100, Math.round((totalLogged / cfg.totalTargetHours) * 1000) / 10)
        : 0,
      hourBank: Math.round(hourBank * 100) / 100,
      carriedDeficit: roundedDeficit,
      biWeekLabel: biWeekStart === biWeekEnd ? `W${biWeekStart}` : `W${biWeekStart}–W${biWeekEnd}`,
      totalFlexUsed: Math.round(totalFlexUsed * 100) / 100,
      penaltyAlert,
      pendingPenalties,
      elapsedDaysCount,
      avgDailyHours: Math.round(avgDailyHours * 100) / 100,
      bestWeek,
      days,
      weeks,
      months
    };

    window.AppState.setCachedLedger(result);
    return result;
  }

  function addStudyMinutesToDate(isoDate, minutes, skipSave = false) {
    const data = window.AppState.getData();
    const hoursToAdd = Math.round((minutes / 60) * 100) / 100;
    const current = data.dailyLogs[isoDate] ? Number(data.dailyLogs[isoDate].hours) || 0 : 0;
    const note = data.dailyLogs[isoDate] ? (data.dailyLogs[isoDate].note || '') : '';
    data.dailyLogs[isoDate] = {
      hours: Math.max(0, Math.round((current + hoursToAdd) * 100) / 100),
      note,
      updatedAt: Date.now()
    };
    window.AppState.markLedgerDirty();
    if (!skipSave) window.AppState.save();
  }

  function setDayLog(isoDate, hours, note) {
    const data = window.AppState.getData();
    const cleanHours = Math.max(0, Math.round((Number(hours) || 0) * 100) / 100);
    data.dailyLogs[isoDate] = { hours: cleanHours, note: note || '', updatedAt: Date.now() };
    window.AppState.markLedgerDirty();
    window.AppState.save();
  }

  function resolvePenalty(penaltyKey) {
    if (!penaltyKey) return;
    const data = window.AppState.getData();
    if (!data.resolvedPenalties || typeof data.resolvedPenalties !== 'object') {
      data.resolvedPenalties = {};
    }
    data.resolvedPenalties[penaltyKey] = Date.now();
    window.AppState.markLedgerDirty();
    window.AppState.save();
  }

  return {
    getChallengeConfig,
    resolvePenalty,
    getDailyTarget,
    getDayName,
    getDayNameAr: getDayName,
    getTodaySummary,
    computeLedger,
    addStudyMinutesToDate,
    setDayLog
  };
})();