/**
 * habits.js — Daily habits tracker with streaks, weekly compliance, and bilingual EN/AR UI
 */
window.HabitsModule = (function () {
  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function calculateStreak(habit, todayISO) {
    let streak = 0;
    let cursor = todayISO;
    if (!habit.completions[cursor]) {
      cursor = window.AppState.addDaysISO(todayISO, -1);
    }
    while (habit.completions[cursor]) {
      streak++;
      cursor = window.AppState.addDaysISO(cursor, -1);
    }
    return streak;
  }

  function getLast7Days(todayISO) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      days.push(window.AppState.addDaysISO(todayISO, -i));
    }
    return days;
  }

  function getOverallWeeklyCompliance() {
    const data = window.AppState.getData();
    const todayISO = window.AppState.getLocalTodayISO();
    const last7 = getLast7Days(todayISO);
    if (!data.habits.length) return 0;

    let totalDone = 0;
    let totalTarget = 0;
    data.habits.forEach(h => {
      const done7 = last7.filter(d => h.completions[d]).length;
      totalDone += done7;
      totalTarget += Math.min(7, h.targetDaysPerWeek || 7);
    });
    return totalTarget > 0 ? Math.min(100, Math.round((totalDone / totalTarget) * 100)) : 0;
  }

  function render() {
    const data = window.AppState.getData();
    const todayISO = window.AppState.getLocalTodayISO();
    const last7 = getLast7Days(todayISO);
    const weeklyPct = getOverallWeeklyCompliance();

    return `
      <div class="space-y-4">
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-bold text-slate-800 dark:text-slate-100">${t('dailyHabits')}</h2>
            <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              ${t('weeklyPct', { p: weeklyPct })}
            </span>
          </div>

          <form id="habit-add-form" class="flex gap-2">
            <input id="habit-title-input" type="text" required placeholder="${window.AppUI.escapeHtml(t('addHabitPlaceholder'))}" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <button type="submit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shrink-0">${t('add')}</button>
          </form>
        </div>

        <div class="space-y-2.5">
          ${data.habits.length ? data.habits.map(h => {
            const doneToday = !!h.completions[todayISO];
            const streak = calculateStreak(h, todayISO);
            const done7 = last7.filter(d => h.completions[d]).length;
            const habitPct = Math.round((done7 / 7) * 100);

            return `
              <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm border border-slate-200 dark:border-slate-700">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <button type="button" data-toggle-habit="${window.AppUI.escapeHtml(h.id)}"
                      class="w-7 h-7 rounded-xl border-2 flex items-center justify-center text-sm font-bold shrink-0 transition ${doneToday ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 text-transparent'}">
                      ✓
                    </button>
                    <div class="min-w-0">
                      <div class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">${window.AppUI.escapeHtml(h.icon || '✨')} ${window.AppUI.escapeHtml(h.title)}</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        ${t('streakLabel')} <strong class="text-amber-600 dark:text-amber-400">${streak}${t('daysShort')}</strong> • ${t('sevenDayLabel')} ${habitPct}%
                      </div>
                    </div>
                  </div>
                  <button type="button" data-delete-habit="${window.AppUI.escapeHtml(h.id)}" class="text-slate-400 hover:text-rose-500 text-xs px-1.5 py-1" title="${window.AppUI.escapeHtml(t('delete'))}">✕</button>
                </div>

                <div class="mt-3 flex items-center gap-1.5">
                  ${last7.map(d => {
                    const isDone = !!h.completions[d];
                    const dayShort = window.LedgerEngine.getDayName(d);
                    return `
                      <button type="button" data-habit-day="${window.AppUI.escapeHtml(h.id)}|${d}"
                        class="flex-1 flex flex-col items-center gap-1 py-1 rounded-lg transition hover:bg-slate-50 dark:hover:bg-slate-700/40" title="${d}">
                        <span class="w-full h-2 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}"></span>
                        <span class="text-[9px] text-slate-400">${dayShort}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('') : `
            <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center text-sm text-slate-500 border border-dashed border-slate-300 dark:border-slate-700">
              ${t('noHabitsYet')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    const form = document.getElementById('habit-add-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const title = document.getElementById('habit-title-input').value.trim();
        if (!title) return;
        window.AppState.getData().habits.push({
          id: 'hab_' + Date.now(),
          title,
          icon: '🔥',
          targetDaysPerWeek: 7,
          completions: {}
        });
        window.AppState.save();
        window.AppUI.showToast(t('habitAddedToast'), 'success');
        rerender();
      };
    }

    document.querySelectorAll('[data-toggle-habit]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-toggle-habit');
        const todayISO = window.AppState.getLocalTodayISO();
        const habit = window.AppState.getData().habits.find(h => h.id === id);
        if (habit) {
          habit.completions[todayISO] = !habit.completions[todayISO];
          window.AppState.save();
          rerender();
        }
      };
    });

    document.querySelectorAll('[data-habit-day]').forEach(btn => {
      btn.onclick = () => {
        const [id, iso] = btn.getAttribute('data-habit-day').split('|');
        const habit = window.AppState.getData().habits.find(h => h.id === id);
        if (habit) {
          habit.completions[iso] = !habit.completions[iso];
          window.AppState.save();
          rerender();
        }
      };
    });

    document.querySelectorAll('[data-delete-habit]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-delete-habit');
        const data = window.AppState.getData();
        data.habits = data.habits.filter(h => h.id !== id);
        window.AppState.markDeleted(id);
        window.AppState.save();
        rerender();
      };
    });
  }

  return {
    calculateStreak,
    getOverallWeeklyCompliance,
    render,
    bindEvents
  };
})();
