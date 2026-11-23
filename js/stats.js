/**
 * stats.js — Stats tab with dynamic monthly, weekly, and tag breakdown SVG charts + bilingual EN/AR UI
 */
window.StatsModule = (function () {
  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function renderMonthlySVG(months) {
    const count = Math.max(1, months.length);
    const maxVal = Math.max(20, ...months.map(m => Math.max(m.logged, m.target)));
    const w = 360;
    const h = 150;
    const usableW = w - 28;
    const slotW = usableW / count;
    const barW = Math.min(28, Math.max(12, Math.floor(slotW * 0.52)));

    const bars = months.map((m, i) => {
      const x = 14 + i * slotW + (slotW - barW) / 2;
      const targetH = Math.round((m.target / maxVal) * 105);
      const loggedH = Math.round((m.logged / maxVal) * 105);
      const yTarget = 122 - targetH;
      const yLogged = 122 - loggedH;

      return `
        <g>
          <rect x="${x}" y="${yTarget}" width="${barW}" height="${targetH}" rx="4" fill="currentColor" class="text-slate-200 dark:text-slate-700"/>
          <rect x="${x}" y="${yLogged}" width="${barW}" height="${loggedH}" rx="4" fill="#6366f1"/>
          <text x="${x + barW / 2}" y="${Math.max(12, yLogged - 4)}" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" class="text-slate-600 dark:text-slate-300">${window.AppUI.formatHours(m.logged)}</text>
          <text x="${x + barW / 2}" y="140" text-anchor="middle" font-size="9" fill="currentColor" class="text-slate-500 dark:text-slate-400">M${m.monthNumber}</text>
        </g>
      `;
    }).join('');

    return `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-40" dir="ltr">
        <line x1="10" y1="122" x2="${w - 10}" y2="122" stroke="currentColor" stroke-width="1" class="text-slate-200 dark:text-slate-700"/>
        ${bars}
      </svg>
    `;
  }

  function renderWeeklySVG(weeks, weeklyTarget) {
    const count = Math.max(1, weeks.length);
    const maxVal = Math.max(weeklyTarget * 1.2 || 20, ...weeks.map(wk => Math.max(wk.logged, wk.target)));
    const w = 390;
    const h = 130;
    const usableW = w - 20;
    const step = usableW / count;
    const barW = Math.max(4, Math.min(18, step * 0.65));
    const targetY = 106 - Math.round(((weeklyTarget || 0) / maxVal) * 88);
    const labelEvery = count <= 12 ? 1 : (count <= 26 ? 4 : 6);

    const bars = weeks.map((wk, i) => {
      const x = 10 + i * step + (step - barW) / 2;
      const barH = Math.max(2, Math.round((wk.logged / maxVal) * 88));
      const y = 106 - barH;
      const color = wk.logged >= wk.target && wk.target > 0 ? '#10b981' : (wk.logged > 0 ? '#6366f1' : '#cbd5e1');
      return `
        <g>
          <title>W${wk.weekNumber}: ${wk.logged} / ${wk.target}</title>
          <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="${color}"/>
          ${(i % labelEvery === 0 || i === count - 1) ? `<text x="${x + barW / 2}" y="122" text-anchor="middle" font-size="8" fill="currentColor" class="text-slate-400">${wk.weekNumber}</text>` : ''}
        </g>
      `;
    }).join('');

    return `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-36" dir="ltr">
        <line x1="8" y1="${targetY}" x2="${w - 8}" y2="${targetY}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,3"/>
        <line x1="8" y1="106" x2="${w - 8}" y2="106" stroke="currentColor" stroke-width="1" class="text-slate-200 dark:text-slate-700"/>
        ${bars}
      </svg>
    `;
  }

  function render() {
    const ledger = window.LedgerEngine.computeLedger();
    const data = window.AppState.getData();
    const hUnit = t('hrs');

    const totalTasks = data.tasks.length;
    const doneTasks = data.tasks.filter(tk => tk.done).length;
    const taskRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const habitRate = window.HabitsModule.getOverallWeeklyCompliance();

    const tagStats = data.tags.map(tag => {
      const tagBooks = data.books.filter(b => b.tagId === tag.id && b.completed);
      const mins = tagBooks.reduce((s, b) => s + b.minutes, 0);
      return {
        tag,
        booksCount: tagBooks.length,
        hours: Math.round((mins / 60) * 100) / 100
      };
    });
    const maxTagHours = Math.max(1, ...tagStats.map(s => s.hours));

    const bestWeekLabel = ledger.bestWeek && ledger.bestWeek.logged > 0
      ? `W${ledger.bestWeek.weekNumber} (${window.AppUI.formatHours(ledger.bestWeek.logged)}${hUnit})`
      : '—';

    return `
      <div class="space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('dailyAvg')}</div>
            <div class="text-lg font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">${window.AppUI.formatHours(ledger.avgDailyHours)}${hUnit}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('bestWeek')}</div>
            <div class="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">${bestWeekLabel}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('tasksDone')}</div>
            <div class="text-lg font-extrabold text-sky-600 dark:text-sky-400 mt-0.5">${taskRate}%</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${t('habitsRate')}</div>
            <div class="text-lg font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">${habitRate}%</div>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-1.5 mb-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('monthlyProgressDynamic', { m: ledger.months.length })}</h3>
            ${window.AppUI.infoButtonHtml('info-stats-monthly')}
          </div>
          ${renderMonthlySVG(ledger.months)}
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-1.5 mb-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('weeklyProgressDynamic', { w: ledger.weeks.length })}</h3>
            ${window.AppUI.infoButtonHtml('info-stats-weekly')}
          </div>
          ${renderWeeklySVG(ledger.weeks, ledger.weeklyTarget)}
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-3">${t('focusByTag')}</h3>
          <div class="space-y-2.5">
            ${tagStats.map(item => {
              const pct = Math.round((item.hours / maxTagHours) * 100);
              return `
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <span class="font-medium text-slate-700 dark:text-slate-200">${window.AppUI.escapeHtml(item.tag.name)}</span>
                    <span class="text-slate-500 dark:text-slate-400">${item.booksCount} ${t('booksWord')} • ${window.AppUI.formatHours(item.hours)}${hUnit}</span>
                  </div>
                  <div class="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${window.AppUI.escapeHtml(item.tag.color)}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    const ledger = window.LedgerEngine.computeLedger();
    const mBtn = document.getElementById('info-stats-monthly');
    if (mBtn) {
      mBtn.onclick = () => {
        window.AppUI.showInfo(t('monthlyProgressDynamic', { m: ledger.months.length }), t('statsMonthlyInfo'));
      };
    }

    const wBtn = document.getElementById('info-stats-weekly');
    if (wBtn) {
      wBtn.onclick = () => {
        window.AppUI.showInfo(
          t('weeklyProgressDynamic', { w: ledger.weeks.length }),
          t('statsWeeklyInfoDynamic', { wk: window.AppUI.formatHours(ledger.weeklyTarget) })
        );
      };
    }
  }

  return {
    render,
    bindEvents
  };
})();
