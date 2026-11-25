/**
 * stats.js — Clean, Focused Study Analytics Dashboard (EN/AR)
 * Keeps only the 5 high-signal essentials: Period Filter, 4 Core Study KPIs,
 * 24h Peak Focus Rhythm, Interactive 12-Week Study Heatmap, and Subjects Donut Chart.
 */
window.StatsModule = (function () {
  let statsPeriod = 'all'; // 'week' | 'month' | 'all'
  let selectedHeatmapIso = '';

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }

  function escapeHtml(s) {
    return window.AppUI ? window.AppUI.escapeHtml(s) : String(s || '');
  }

  function filterBooksByPeriod(books, period, todayISO) {
    if (period === 'week') {
      const startISO = window.AppState.addDaysISO(todayISO, -6);
      return books.filter(b => b.date && b.date >= startISO && b.date <= todayISO);
    }
    if (period === 'month') {
      const startISO = window.AppState.addDaysISO(todayISO, -29);
      return books.filter(b => b.date && b.date >= startISO && b.date <= todayISO);
    }
    return books;
  }

  function computeStudyStreaks(dailyLogs, books, todayISO) {
    const activeDays = new Set();
    Object.keys(dailyLogs || {}).forEach(iso => {
      if ((Number(dailyLogs[iso] && dailyLogs[iso].hours) || 0) > 0) activeDays.add(iso);
    });
    (books || []).forEach(b => {
      if (b && b.completed && b.date && (Number(b.minutes) || 0) >= 5) activeDays.add(b.date);
    });

    let current = 0;
    let cursor = todayISO;
    if (!activeDays.has(cursor)) cursor = window.AppState.addDaysISO(todayISO, -1);
    while (activeDays.has(cursor)) {
      current++;
      cursor = window.AppState.addDaysISO(cursor, -1);
      if (current > 999) break;
    }

    const sorted = Array.from(activeDays).sort();
    let best = 0;
    let run = 0;
    let prev = '';
    for (const iso of sorted) {
      if (prev && window.AppState.addDaysISO(prev, 1) === iso) run++;
      else run = 1;
      if (run > best) best = run;
      prev = iso;
    }
    return { current, best };
  }

  function compute24hPeakFocus(books) {
    const hours = new Array(24).fill(0);
    const windows = [
      { id: 'morning', ar: 'الصباح', en: 'Morning', icon: '🌅', color: '#f59e0b', mins: 0 },
      { id: 'afternoon', ar: 'الظهيرة', en: 'Afternoon', icon: '☀️', color: '#0ea5e9', mins: 0 },
      { id: 'evening', ar: 'المساء', en: 'Evening', icon: '🌆', color: '#6366f1', mins: 0 },
      { id: 'night', ar: 'الليل', en: 'Night', icon: '🌙', color: '#8b5cf6', mins: 0 }
    ];
    let totalMins = 0;

    (books || []).forEach(b => {
      if (!b || !b.completed) return;
      const m = Number(b.minutes) || 0;
      if (m <= 0) return;
      let dt = null;
      if (b.startedAt) dt = new Date(Number(b.startedAt));
      else if (b.createdAt && String(b.createdAt).includes('T')) dt = new Date(b.createdAt);
      if (!dt || Number.isNaN(dt.getTime())) return;
      const hr = dt.getHours();
      hours[hr] += m;
      totalMins += m;
      if (hr >= 5 && hr < 12) windows[0].mins += m;
      else if (hr >= 12 && hr < 17) windows[1].mins += m;
      else if (hr >= 17 && hr < 22) windows[2].mins += m;
      else windows[3].mins += m;
    });

    let peakHour = -1;
    let peakHourMins = 0;
    for (let h = 0; h < 24; h++) {
      if (hours[h] > peakHourMins) {
        peakHourMins = hours[h];
        peakHour = h;
      }
    }
    const bestWindow = windows.reduce((a, b) => (b.mins > a.mins ? b : a), windows[0]);
    return { hours, windows, totalMins, peakHour, peakHourMins, bestWindow: totalMins > 0 ? bestWindow : null };
  }

  function formatHourLabel(h, ar) {
    if (h < 0) return '—';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const suf = h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM');
    return `${h12}:00 ${suf}`;
  }

  function render24hPeakSVG(peak) {
    const w = 360;
    const h = 112;
    const maxM = Math.max(15, ...peak.hours);
    const padX = 10;
    const usableW = w - padX * 2;
    const step = usableW / 24;
    const barW = Math.max(6, step * 0.64);
    const baseY = 88;
    const isDark = window.AppState.getIsDark();

    const getBarColor = (hr, isPeak) => {
      if (isPeak) return '#f59e0b';
      if (hr >= 5 && hr < 12) return '#fbbf24';
      if (hr >= 12 && hr < 17) return '#38bdf8';
      if (hr >= 17 && hr < 22) return '#6366f1';
      return '#8b5cf6';
    };

    const bars = peak.hours.map((m, hr) => {
      const x = padX + hr * step + (step - barW) / 2;
      const isPeak = hr === peak.peakHour && m > 0;
      const bh = m > 0 ? Math.max(5, Math.round((m / maxM) * 66)) : 3;
      const y = baseY - bh;
      const fill = m > 0 ? getBarColor(hr, isPeak) : (isDark ? '#1e293b' : '#e2e8f0');
      const opacity = m > 0 ? (isPeak ? '1' : '0.82') : '0.7';
      return `
        <g>
          <title>${String(hr).padStart(2, '0')}:00 — ${Math.round(m)}m</title>
          ${isPeak ? `<rect x="${x - 2}" y="${y - 2}" width="${barW + 4}" height="${bh + 4}" rx="4" fill="#f59e0b" opacity="0.22"/>` : ''}
          <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${fill}" opacity="${opacity}"/>
          ${isPeak ? `<circle cx="${x + barW / 2}" cy="${Math.max(8, y - 6)}" r="2.8" fill="#f59e0b"/>` : ''}
        </g>
      `;
    }).join('');

    const labels = [0, 6, 12, 18, 23].map(hr => {
      const x = padX + hr * step + step / 2;
      return `<text x="${x}" y="104" text-anchor="middle" font-size="8.5" font-weight="600" fill="currentColor" class="text-slate-400">${String(hr).padStart(2, '0')}:00</text>`;
    }).join('');

    return `
      <svg viewBox="0 0 ${w} ${h}" class="w-full" style="max-height:125px" dir="ltr">
        <line x1="${padX}" y1="${baseY}" x2="${w - padX}" y2="${baseY}" stroke="currentColor" stroke-width="1" class="text-slate-200 dark:text-slate-700"/>
        ${bars}
        ${labels}
      </svg>
    `;
  }

  function renderSubjectsDonutSVG(subjStats, totalHours, hUnit) {
    const r = 46;
    const circ = 2 * Math.PI * r;
    const isDark = window.AppState.getIsDark();
    let offset = 0;

    const segments = totalHours > 0
      ? subjStats.filter(s => s.hours > 0).map(s => {
          const frac = s.hours / totalHours;
          const dash = Math.max(2, frac * circ);
          const seg = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${escapeHtml(s.subj.color)}" stroke-width="14" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
          offset += dash;
          return seg;
        }).join('')
      : `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${isDark ? '#1e293b' : '#e2e8f0'}" stroke-width="14"/>`;

    return `
      <svg width="116" height="116" viewBox="0 0 120 120" style="width:116px;height:116px;min-width:116px;flex-shrink:0" dir="ltr">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${isDark ? '#1e293b' : '#f1f5f9'}" stroke-width="14"/>
        ${segments}
        <text x="60" y="57" text-anchor="middle" font-size="15" font-weight="800" fill="currentColor" class="text-slate-800 dark:text-slate-100">${window.AppUI.formatHours(totalHours)}</text>
        <text x="60" y="71" text-anchor="middle" font-size="9" font-weight="600" fill="currentColor" class="text-slate-400">${escapeHtml(hUnit)}</text>
      </svg>
    `;
  }

  function renderHeatmapSVG(dailyLogs, todayISO) {
    const cols = 12;
    const rows = 7;
    const cell = 14;
    const gap = 3;
    const startISO = window.AppState.addDaysISO(todayISO, -(cols * rows - 1));
    const isDark = window.AppState.getIsDark();
    const palette = isDark
      ? ['#1e293b', '#1e3a5f', '#2563eb', '#10b981', '#f59e0b']
      : ['#e2e8f0', '#c7d2fe', '#818cf8', '#10b981', '#d97706'];

    const rects = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const idx = c * rows + r;
        const iso = window.AppState.addDaysISO(startISO, idx);
        const hrs = dailyLogs[iso] ? Number(dailyLogs[iso].hours) || 0 : 0;
        let level = 0;
        if (hrs > 0 && hrs < 2) level = 1;
        else if (hrs >= 2 && hrs < 4) level = 2;
        else if (hrs >= 4 && hrs < 6.5) level = 3;
        else if (hrs >= 6.5) level = 4;

        const x = 4 + c * (cell + gap);
        const y = 4 + r * (cell + gap);
        const isSel = selectedHeatmapIso === iso || (!selectedHeatmapIso && iso === todayISO);
        const stroke = isSel ? (isDark ? '#f8fafc' : '#1e293b') : 'none';
        rects.push(`
          <rect data-hm-day="${iso}" style="cursor:pointer" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" fill="${palette[level]}" stroke="${stroke}" stroke-width="${isSel ? 1.6 : 0}">
            <title>${iso}: ${window.AppUI.formatHours(hrs)}h</title>
          </rect>
        `);
      }
    }

    const totalW = 8 + cols * (cell + gap) - gap;
    const totalH = 8 + rows * (cell + gap) - gap;
    return `
      <svg viewBox="0 0 ${totalW} ${totalH}" class="w-full" style="max-height:145px" dir="ltr">
        ${rects.join('')}
      </svg>
    `;
  }

  function render() {
    const ledger = window.LedgerEngine.computeLedger();
    const data = window.AppState.getData();
    const hUnit = t('hrs');
    const ar = isAr();
    const todayISO = window.AppState.getLocalTodayISO();

    const periodBooks = filterBooksByPeriod(data.books || [], statsPeriod, todayISO);
    const compBooks = periodBooks.filter(b => b.completed);
    const periodBookHours = Math.round((compBooks.reduce((s, b) => s + (Number(b.minutes) || 0), 0) / 60) * 10) / 10;

    let periodLogged = 0;
    if (statsPeriod === 'all') {
      periodLogged = ledger.totalLogged;
    } else {
      const daysBack = statsPeriod === 'week' ? 7 : 30;
      for (let i = 0; i < daysBack; i++) {
        const d = window.AppState.addDaysISO(todayISO, -i);
        periodLogged += data.dailyLogs[d] ? Number(data.dailyLogs[d].hours) || 0 : 0;
      }
      periodLogged = Math.round(periodLogged * 10) / 10;
    }
    const displayHours = Math.max(periodLogged, periodBookHours);

    let this7 = 0;
    let prev7 = 0;
    for (let i = 0; i < 7; i++) {
      const d1 = window.AppState.addDaysISO(todayISO, -i);
      const d2 = window.AppState.addDaysISO(todayISO, -(i + 7));
      this7 += data.dailyLogs[d1] ? Number(data.dailyLogs[d1].hours) || 0 : 0;
      prev7 += data.dailyLogs[d2] ? Number(data.dailyLogs[d2].hours) || 0 : 0;
    }
    const wowDiff = Math.round((this7 - prev7) * 10) / 10;
    const wowSign = wowDiff > 0 ? '+' : '';
    const wowColor = wowDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500';

    const streaks = computeStudyStreaks(data.dailyLogs, data.books, todayISO);
    const avgSessionMins = compBooks.length
      ? Math.round(compBooks.reduce((s, b) => s + (Number(b.minutes) || 0), 0) / compBooks.length)
      : 0;
    const completionPct = periodBooks.length ? Math.round((compBooks.length / periodBooks.length) * 100) : 0;
    const goldCount = compBooks.filter(b => (Number(b.minutes) || 0) >= 75).length;

    const subjStats = (data.subjects || []).map(subj => {
      const sBooks = compBooks.filter(b => b.subjectId === subj.id);
      const mins = sBooks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);
      return {
        subj,
        booksCount: sBooks.length,
        hours: Math.round((mins / 60) * 100) / 100
      };
    }).sort((a, b) => b.hours - a.hours);
    const totalSubjHours = Math.round(subjStats.reduce((s, x) => s + x.hours, 0) * 100) / 100;

    const peak = compute24hPeakFocus(compBooks);

    const hmIso = selectedHeatmapIso || todayISO;
    const hmEntry = (data.dailyLogs && data.dailyLogs[hmIso]) || null;
    const hmHrs = hmEntry ? Number(hmEntry.hours) || 0 : 0;
    const hmNote = hmEntry && hmEntry.note ? hmEntry.note : '';

    return `
      <div class="space-y-4">
        <!-- Period Filter -->
        <div class="flex p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 gap-1">
          ${[
            { id: 'week', ar: 'آخر 7 أيام', en: '7 Days' },
            { id: 'month', ar: 'آخر 30 يوماً', en: '30 Days' },
            { id: 'all', ar: 'الكل', en: 'All Time' }
          ].map(p => `
            <button type="button" data-stats-period="${p.id}" class="flex-1 py-2 rounded-lg text-xs font-bold transition ${statsPeriod === p.id ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400'}">
              ${ar ? p.ar : p.en}
            </button>
          `).join('')}
        </div>

        <!-- 4 Core Study KPIs -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${ar ? 'إجمالي الساعات' : 'Total Hours'}</div>
            <div class="text-lg font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">${window.AppUI.formatHours(displayHours)}${hUnit}</div>
            <div class="text-[10px] font-bold ${wowColor}" dir="ltr">${wowSign}${window.AppUI.formatHours(wowDiff)}${hUnit} ${ar ? '(7 أيام)' : '(7d)'}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${ar ? 'السلسلة الحالية' : 'Study Streak'}</div>
            <div class="text-lg font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">🔥 ${streaks.current}${t('daysShort')}</div>
            <div class="text-[10px] text-slate-400">${ar ? 'أطول سلسلة:' : 'Best:'} ${streaks.best}${t('daysShort')}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${ar ? 'متوسط الجلسة' : 'Avg Session'}</div>
            <div class="text-lg font-extrabold text-sky-600 dark:text-sky-400 mt-0.5">${avgSessionMins}${t('minShort')}</div>
            <div class="text-[10px] text-slate-400">${ar ? 'إكمال:' : 'Done:'} ${completionPct}%</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
            <div class="text-[11px] text-slate-500 dark:text-slate-400">${ar ? 'الكتب المكتملة' : 'Books Earned'}</div>
            <div class="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">📚 ${compBooks.length}</div>
            <div class="text-[10px] text-amber-600 dark:text-amber-400 font-bold">🏆 ${goldCount} ${ar ? 'موسوعة' : 'Gold'}</div>
          </div>
        </div>

        <!-- 24h Peak Focus Rhythm -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">⚡ ${ar ? 'أوقات ذروة التركيز (24 ساعة)' : '24h Peak Focus Rhythm'}</h3>
            <p class="text-[11px] text-slate-400 mt-0.5">
              ${peak.peakHour >= 0
                ? (ar
                    ? `أقوى ساعة: ${formatHourLabel(peak.peakHour, true)} • الفترة الذهبية: ${peak.bestWindow.icon} ${peak.bestWindow.ar}`
                    : `Peak hour: ${formatHourLabel(peak.peakHour, false)} • Golden window: ${peak.bestWindow.icon} ${peak.bestWindow.en}`)
                : (ar ? 'أكمل جلسات دراسة ليظهر إيقاع تركيزك اليومي' : 'Complete sessions to reveal your daily focus rhythm')}
            </p>
          </div>

          ${render24hPeakSVG(peak)}

          ${peak.totalMins > 0 ? `
            <div class="w-full h-2.5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-700">
              ${peak.windows.map(win => {
                const wPct = Math.round((win.mins / peak.totalMins) * 100);
                return wPct > 0 ? `<div style="width:${wPct}%;background:${win.color}" title="${ar ? win.ar : win.en}: ${wPct}%"></div>` : '';
              }).join('')}
            </div>
          ` : ''}

          <div class="grid grid-cols-4 gap-1.5">
            ${peak.windows.map(win => {
              const pct = peak.totalMins > 0 ? Math.round((win.mins / peak.totalMins) * 100) : 0;
              const isTop = peak.bestWindow && peak.bestWindow.id === win.id;
              return `
                <div class="p-2 rounded-xl border text-center ${isTop ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/30' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40'}">
                  <div class="text-sm leading-none">${win.icon}</div>
                  <div class="text-[10px] font-bold text-slate-700 dark:text-slate-200 mt-1">${ar ? win.ar : win.en}</div>
                  <div class="text-xs font-extrabold mt-0.5" style="color:${win.color}">${pct}%</div>
                  <div class="text-[9px] text-slate-400">${window.AppUI.formatHours(win.mins / 60)}${hUnit}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Interactive 12-Week Study Heatmap -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">🔥 ${ar ? 'خريطة الاستمرارية (12 أسبوعاً)' : '12-Week Study Heatmap'}</h3>
            <span class="text-[10px] text-slate-400">${ar ? 'اضغط أي يوم للتفاصيل' : 'Tap any day'}</span>
          </div>
          ${renderHeatmapSVG(data.dailyLogs || {}, todayISO)}
          <div class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2 text-xs">
            <span class="font-bold text-slate-700 dark:text-slate-200">${window.AppUI.formatDate(hmIso)}</span>
            <span class="text-slate-500 dark:text-slate-400 truncate flex-1 text-center">${hmNote ? escapeHtml(hmNote) : (ar ? 'لا توجد ملاحظة' : 'No note')}</span>
            <span class="font-extrabold text-indigo-600 dark:text-indigo-400 shrink-0">${window.AppUI.formatHours(hmHrs)}${hUnit}</span>
          </div>
        </div>

        <!-- Subjects Breakdown Donut Chart -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">📘 ${ar ? 'توزيع الساعات حسب المواد' : 'Hours by Subject'}</h3>
          <div class="flex items-center gap-3">
            ${renderSubjectsDonutSVG(subjStats, totalSubjHours, hUnit)}
            <div class="flex-1 min-w-0 space-y-2">
              ${subjStats.length ? subjStats.slice(0, 6).map(item => {
                const share = totalSubjHours > 0 ? Math.round((item.hours / totalSubjHours) * 100) : 0;
                return `
                  <div class="flex items-center justify-between gap-2 text-xs">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span style="width:10px;height:10px;min-width:10px;border-radius:9999px;display:inline-block;flex-shrink:0;background:${escapeHtml(item.subj.color)}"></span>
                      <span class="font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(item.subj.name)}</span>
                    </div>
                    <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 shrink-0">${window.AppUI.formatHours(item.hours)}${hUnit} (${share}%)</span>
                  </div>
                `;
              }).join('') : `<div class="text-xs text-slate-400">${ar ? 'لا توجد مواد مسجّلة' : 'No subjects yet'}</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    document.querySelectorAll('[data-stats-period]').forEach(btn => {
      btn.onclick = () => {
        const nextP = btn.getAttribute('data-stats-period');
        if (nextP && nextP !== statsPeriod) {
          statsPeriod = nextP;
          if (rerender) rerender();
        }
      };
    });

    document.querySelectorAll('[data-hm-day]').forEach(rect => {
      rect.onclick = () => {
        const iso = rect.getAttribute('data-hm-day');
        if (iso && iso !== selectedHeatmapIso) {
          selectedHeatmapIso = iso;
          if (rerender) rerender();
        }
      };
    });
  }

  return {
    render,
    bindEvents
  };
})();
