/**
 * tasks.js — Study tasks manager with subjects, priorities, and bilingual EN/AR UI
 */
window.TasksModule = (function () {
  const C = window.APP_CONFIG;
  let filterStatus = 'all';
  let filterSubject = 'all';

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function getPendingSuggestions() {
    return window.AppState.getData().tasks.filter(tk => !tk.done);
  }

  function render() {
    const data = window.AppState.getData();
    const isAr = window.I18n && window.I18n.isRTL();
    const tasks = data.tasks.filter(tk => {
      if (filterStatus === 'pending' && tk.done) return false;
      if (filterStatus === 'done' && !tk.done) return false;
      if (filterSubject !== 'all' && tk.subjectId !== filterSubject) return false;
      return true;
    });

    const total = data.tasks.length;
    const doneCount = data.tasks.filter(tk => tk.done).length;
    const rate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    return `
      <div class="space-y-4">
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-bold text-slate-800 dark:text-slate-100">${t('studyTasks')}</h2>
            <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              ${t('doneSummary', { done: doneCount, total, rate })}
            </span>
          </div>

          <form id="task-add-form" class="space-y-2.5">
            <input id="task-title-input" type="text" required placeholder="${window.AppUI.escapeHtml(t('addTaskPlaceholder'))}" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <div class="grid grid-cols-2 gap-2">
              <select id="task-subject-input" class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs">
                ${data.subjects.map(s => `<option value="${window.AppUI.escapeHtml(s.id)}">${window.AppUI.escapeHtml(s.name)}</option>`).join('')}
              </select>
              <select id="task-priority-input" class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs">
                <option value="high">${t('highPriority')}</option>
                <option value="medium" selected>${t('mediumPriority')}</option>
                <option value="low">${t('lowPriority')}</option>
              </select>
            </div>
            <button type="submit" class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition">
              ${t('addTaskBtn')}
            </button>
          </form>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select id="task-filter-status" class="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
            <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>${t('allCount', { n: total })}</option>
            <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>${t('pendingCount', { n: total - doneCount })}</option>
            <option value="done" ${filterStatus === 'done' ? 'selected' : ''}>${t('completedCount', { n: doneCount })}</option>
          </select>
          <select id="task-filter-subject" class="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs flex-1">
            <option value="all">${t('allSubjects')}</option>
            ${data.subjects.map(s => `<option value="${window.AppUI.escapeHtml(s.id)}" ${filterSubject === s.id ? 'selected' : ''}>${window.AppUI.escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>

        <div class="space-y-2">
          ${tasks.length ? tasks.map(tk => {
            const subj = window.AppUI.getSubjectById(tk.subjectId);
            const prio = C.PRIORITIES[tk.priority] || C.PRIORITIES.medium;
            const prioLabel = isAr && prio.labelAr ? prio.labelAr : prio.label;
            return `
              <div class="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm border border-slate-200 dark:border-slate-700 flex items-start gap-3">
                <button type="button" data-toggle-task="${window.AppUI.escapeHtml(tk.id)}" class="mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${tk.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}">
                  ${tk.done ? '✓' : ''}
                </button>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium ${tk.done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}">${window.AppUI.escapeHtml(tk.title)}</div>
                  <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                    ${subj ? `<span class="text-[10px] px-2 py-0.5 rounded-full text-white" style="background:${window.AppUI.escapeHtml(subj.color)}">${window.AppUI.escapeHtml(subj.name)}</span>` : ''}
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${prio.badgeClass}">${prioLabel}</span>
                  </div>
                </div>
                <button type="button" data-delete-task="${window.AppUI.escapeHtml(tk.id)}" class="text-slate-400 hover:text-rose-500 text-xs px-1.5 py-1" title="${window.AppUI.escapeHtml(t('delete'))}">✕</button>
              </div>
            `;
          }).join('') : `
            <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700">
              ${t('noMatchingTasks')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    const form = document.getElementById('task-add-form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const title = document.getElementById('task-title-input').value.trim();
        if (!title) return;
        const subjectId = document.getElementById('task-subject-input').value;
        const priority = document.getElementById('task-priority-input').value;
        window.AppState.getData().tasks.unshift({
          id: 't_' + Date.now(),
          title,
          subjectId,
          priority,
          done: false,
          dueDate: window.AppState.getLocalTodayISO(),
          createdAt: window.AppState.getLocalTodayISO()
        });
        window.AppState.save();
        window.AppUI.showToast(t('taskAddedToast'), 'success');
        rerender();
      };
    }

    const stSel = document.getElementById('task-filter-status');
    if (stSel) stSel.onchange = (e) => { filterStatus = e.target.value; rerender(); };

    const sbSel = document.getElementById('task-filter-subject');
    if (sbSel) sbSel.onchange = (e) => { filterSubject = e.target.value; rerender(); };

    document.querySelectorAll('[data-toggle-task]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-toggle-task');
        const task = window.AppState.getData().tasks.find(tk => tk.id === id);
        if (task) {
          task.done = !task.done;
          window.AppState.save();
          rerender();
        }
      };
    });

    document.querySelectorAll('[data-delete-task]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-delete-task');
        const data = window.AppState.getData();
        data.tasks = data.tasks.filter(tk => tk.id !== id);
        window.AppState.markDeleted(id);
        window.AppState.save();
        rerender();
      };
    });
  }

  return {
    getPendingSuggestions,
    render,
    bindEvents
  };
})();
