/**
 * reviews.js — Dynamic Bi-Weekly Reviews + Final Challenge Summary (EN/AR)
 */
window.ReviewsModule = (function () {
  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function getPeriodDefinitions(ledger) {
    const list = [];
    const totalPeriods = Math.ceil(ledger.totalWeeks / 2);

    for (let i = 0; i < totalPeriods; i++) {
      const startDayIdx = i * 14;
      const slice = ledger.days.slice(startDayIdx, startDayIdx + 14);
      if (!slice.length) continue;
      const wStart = i * 2 + 1;
      const wEnd = Math.min(ledger.totalWeeks, wStart + 1);
      const target = slice.reduce((s, d) => s + d.target, 0);
      const logged = slice.reduce((s, d) => s + d.logged, 0);

      list.push({
        id: `bw_${i + 1}`,
        group: t('weeksRange', { s: wStart, e: wEnd }),
        title: t('biWeeklyTitle', { n: i + 1, s: wStart, e: wEnd }),
        range: `${window.AppUI.formatDate(slice[0].iso)} – ${window.AppUI.formatDate(slice[slice.length - 1].iso)}`,
        logged: Math.round(logged * 100) / 100,
        target: Math.round(target * 100) / 100,
        percent: target > 0 ? Math.min(100, Math.round((logged / target) * 100)) : 0
      });
    }

    list.push({
      id: 'final',
      group: t('finalGroup'),
      title: t('finalTitleDynamic', { n: ledger.totalDays }),
      range: `${window.AppUI.formatDate(ledger.startDate)} – ${window.AppUI.formatDate(ledger.endDate)}`,
      logged: ledger.totalLogged,
      target: ledger.totalTarget,
      percent: ledger.overallPercent
    });

    return list;
  }

  function render(ledger) {
    const data = window.AppState.getData();
    const periods = getPeriodDefinitions(ledger);
    const hUnit = t('hrs');

    return `
      <div class="space-y-3">
        ${periods.map(p => {
          const saved = data.reviews[p.id] || { rating: 0, notes: '' };
          const isFinal = p.id === 'final';
          return `
            <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 border ${isFinal ? 'border-amber-400 dark:border-amber-500/60' : 'border-slate-200 dark:border-slate-700'} shadow-sm">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <span class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 mb-1">${p.group}</span>
                  <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100">${p.title}</h4>
                  <p class="text-[11px] text-slate-400">${p.range}</p>
                </div>
                <div class="text-right">
                  <div class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">${window.AppUI.formatHours(p.logged)} / ${window.AppUI.formatHours(p.target)}${hUnit}</div>
                  <div class="text-[11px] text-slate-500">${p.percent}%</div>
                </div>
              </div>

              <div class="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden my-2.5">
                <div class="h-full rounded-full ${isFinal ? 'bg-amber-500' : 'bg-indigo-600'}" style="width:${p.percent}%"></div>
              </div>

              <div class="flex items-center justify-between gap-2 mt-2">
                <p class="text-xs text-slate-600 dark:text-slate-300 truncate flex-1">
                  ${saved.notes ? window.AppUI.escapeHtml(saved.notes) : `<span class="text-slate-400 italic">${t('noReviewNotes')}</span>`}
                </p>
                <button type="button" data-edit-review="${p.id}" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 shrink-0">
                  ${saved.rating ? t('editReviewBtn', { r: saved.rating }) : t('writeReviewBtn')}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function bindEvents(ledger, rerender) {
    const periods = getPeriodDefinitions(ledger);
    const hUnit = t('hrs');
    document.querySelectorAll('[data-edit-review]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-edit-review');
        const period = periods.find(p => p.id === id);
        if (!period) return;
        const data = window.AppState.getData();
        const saved = data.reviews[id] || { rating: 4, notes: '' };

        window.AppUI.openModal({
          title: period.title,
          bodyHtml: `
            <div class="space-y-3">
              <div class="text-xs text-slate-500 dark:text-slate-400">
                ${t('loggedLabel')} <strong>${window.AppUI.formatHours(period.logged)}${hUnit}</strong> / <strong>${window.AppUI.formatHours(period.target)}${hUnit}</strong> (${period.percent}%)
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">${t('consistencyRating')}</label>
                <select id="rev-rating" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm">
                  ${[5, 4, 3, 2, 1].map(r => `<option value="${r}" ${saved.rating === r ? 'selected' : ''}>${'⭐'.repeat(r)} (${r}/5)</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">${t('keyLessons')}</label>
                <textarea id="rev-notes" rows="4" placeholder="${window.AppUI.escapeHtml(t('reviewPlaceholder'))}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm">${window.AppUI.escapeHtml(saved.notes || '')}</textarea>
              </div>
            </div>
          `,
          footerHtml: `
            <button id="rev-cancel" class="px-4 py-2 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${t('cancel')}</button>
            <button id="rev-save" class="px-4 py-2 rounded-xl text-sm bg-indigo-600 text-white font-medium">${t('save')}</button>
          `
        });

        document.getElementById('rev-cancel').onclick = window.AppUI.closeModal;
        document.getElementById('rev-save').onclick = () => {
          data.reviews[id] = {
            rating: Number(document.getElementById('rev-rating').value) || 4,
            notes: document.getElementById('rev-notes').value.trim(),
            updatedAt: new Date().toISOString()
          };
          window.AppState.save();
          window.AppUI.closeModal();
          window.AppUI.showToast(t('reviewSaved'), 'success');
          if (rerender) rerender();
        };
      };
    });
  }

  return {
    render,
    bindEvents
  };
})();
