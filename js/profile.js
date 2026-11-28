/**
 * profile.js — Personal Study Profile + Embedded Settings (v84)
 * Avatar & color customization, Major/Bio, Lifetime Stats, Best Streak, Unlockable Badges,
 * Cloud Sync, and full Settings panel nested smoothly inside Profile with animated segmented switcher.
 */
window.ProfileModule = (function () {
  const AVATARS = ['🦉', '🦊', '🐱', '🩺', '📚', '☕', '🚀', '🌿', '🧠', '⚡', '🎓', '✨'];
  const COLORS = ['#4f46e5', '#1B5E43', '#7C2338', '#0ea5e9', '#d97706', '#7c3aed'];
  let activeSubTab = 'overview'; // 'overview' | 'settings'
  let lastRerenderCb = null;

  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }

  function escapeHtml(s) {
    return window.AppUI ? window.AppUI.escapeHtml(s) : String(s || '');
  }

  function getProfileData() {
    const data = window.AppState.getData();
    if (!data.settings) data.settings = {};
    if (!data.settings.profile || typeof data.settings.profile !== 'object') {
      data.settings.profile = {};
    }
    const p = data.settings.profile;
    const gUser = window.GoogleSync && window.GoogleSync.getUser();
    const fallbackName = data.settings.groupNickname || (gUser && (gUser.displayName || (gUser.email ? gUser.email.split('@')[0] : ''))) || (isAr() ? 'طالب مجتهد' : 'Focused Learner');
    return {
      avatar: p.avatar || '🦉',
      color: p.color || '#4f46e5',
      name: (p.name && String(p.name).trim()) || fallbackName,
      major: (p.major && String(p.major).trim()) || '',
      bio: (p.bio && String(p.bio).trim()) || ''
    };
  }

  function getWeekKey(isoDate) {
    const dt = window.AppState.parseLocalISO(isoDate);
    const dow = dt.getDay();
    const daysSinceSat = (dow + 1) % 7;
    dt.setDate(dt.getDate() - daysSinceSat);
    return window.AppState.getLocalTodayISO(dt);
  }

  function getWeeklyTier(weekMins) {
    const hrs = (Number(weekMins) || 0) / 60;
    if (hrs >= 40) return { icon: '💎', ar: 'ماسي', en: 'Diamond' };
    if (hrs >= 25) return { icon: '🥇', ar: 'ذهبي', en: 'Gold' };
    if (hrs >= 15) return { icon: '🥈', ar: 'فضي', en: 'Silver' };
    if (hrs >= 5)  return { icon: '🥉', ar: 'برونزي', en: 'Bronze' };
    return { icon: '🌱', ar: 'مبتدئ', en: 'Starter' };
  }

  function extractStartHour(b) {
    try {
      const ts = Number(b.startedAt || b.createdAt || 0);
      if (ts > 100000000000) return new Date(ts).getHours();
      if (typeof b.startedAt === 'string' && b.startedAt.includes(':')) {
        const h = parseInt(b.startedAt.split(':')[0], 10);
        if (!Number.isNaN(h)) return h;
      }
    } catch (e) {}
    return -1;
  }

  function computeProfileStats() {
    const data = window.AppState.getData();
    const books = (data.books || []).filter(b => b && b.completed && (Number(b.minutes) || 0) > 0);
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);

    let totalMins = 0;
    let weekMins = 0;
    let longestSession = 0;
    let hasEarlyBird = false;
    let hasNightOwl = false;
    const daySet = new Set();

    for (const b of books) {
      const m = Number(b.minutes) || 0;
      totalMins += m;
      if (m > longestSession) longestSession = m;
      if (b.date) {
        daySet.add(b.date);
        if (getWeekKey(b.date) === weekKey) weekMins += m;
      }
      const hr = extractStartHour(b);
      if (hr >= 4 && hr < 9) hasEarlyBird = true;
      if (hr >= 22 || (hr >= 0 && hr < 4)) hasNightOwl = true;
    }

    // Current streak
    let currentStreak = 0;
    let cursor = todayISO;
    if (!daySet.has(cursor)) cursor = window.AppState.addDaysISO(todayISO, -1);
    while (daySet.has(cursor)) {
      currentStreak++;
      cursor = window.AppState.addDaysISO(cursor, -1);
      if (currentStreak > 999) break;
    }

    // Best all-time streak
    const sortedDays = Array.from(daySet).sort();
    let bestStreak = 0;
    let run = 0;
    for (let i = 0; i < sortedDays.length; i++) {
      if (i === 0) {
        run = 1;
      } else {
        const expected = window.AppState.addDaysISO(sortedDays[i - 1], 1);
        run = (sortedDays[i] === expected) ? (run + 1) : 1;
      }
      if (run > bestStreak) bestStreak = run;
    }

    let deficitHours = 0;
    try {
      if (window.LedgerEngine && window.LedgerEngine.computeLedger) {
        const led = window.LedgerEngine.computeLedger();
        deficitHours = Math.max(0, Math.round((Number(led && led.carriedDeficit) || 0) * 10) / 10);
      }
    } catch (e) {}

    const totalHours = Math.round((totalMins / 60) * 10) / 10;
    const tier = getWeeklyTier(weekMins);

    const badges = [
      { id: 'first', icon: '📖', ar: 'أول خطوة', en: 'First Book', descAr: 'أكمل أول كتاب', descEn: 'Complete 1 book', unlocked: books.length >= 1 },
      { id: '10h', icon: '⏱️', ar: 'نادي 10 ساعات', en: '10h Club', descAr: 'اجمع 10 ساعات', descEn: 'Reach 10 total hours', unlocked: totalHours >= 10 },
      { id: '50h', icon: '🏆', ar: 'أسطورة 50 ساعة', en: '50h Legend', descAr: 'اجمع 50 ساعة', descEn: 'Reach 50 total hours', unlocked: totalHours >= 50 },
      { id: 'streak7', icon: '🔥', ar: 'أسبوع متواصل', en: '7-Day Streak', descAr: '7 أيام متتالية', descEn: '7 consecutive days', unlocked: bestStreak >= 7 },
      { id: 'iron', icon: '🏋️', ar: 'نفس طويل', en: 'Iron Focus', descAr: 'جلسة 90 دقيقة', descEn: '90m single session', unlocked: longestSession >= 90 },
      { id: 'early', icon: '🌅', ar: 'طير الفجر', en: 'Early Bird', descAr: 'دراسة قبل 9 صباحاً', descEn: 'Study before 9 AM', unlocked: hasEarlyBird },
      { id: 'night', icon: '🦉', ar: 'بومة الليل', en: 'Night Owl', descAr: 'دراسة بعد 10 مساءً', descEn: 'Study after 10 PM', unlocked: hasNightOwl },
      { id: 'nodef', icon: '✨', ar: 'سجل نظيف', en: 'Zero Deficit', descAr: 'عجز 0 مع دراسة', descEn: '0 deficit with books', unlocked: books.length >= 1 && deficitHours <= 0 }
    ];

    return {
      totalHours,
      totalBooks: books.length,
      weekHours: Math.round((weekMins / 60) * 10) / 10,
      currentStreak,
      bestStreak,
      longestSession: Math.round(longestSession),
      deficitHours,
      tier,
      badges,
      unlockedCount: badges.filter(b => b.unlocked).length
    };
  }

  function openEditProfileModal(rerender) {
    const ar = isAr();
    const prof = getProfileData();
    let pickedAvatar = prof.avatar;
    let pickedColor = prof.color;

    window.AppUI.openModal({
      title: ar ? '✏️ تعديل البروفايل' : '✏️ Edit Profile',
      bodyHtml: `
        <div class="space-y-3.5">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">${ar ? 'اختر الأفاتار' : 'Choose Avatar'}</label>
            <div class="grid grid-cols-6 gap-1.5">
              ${AVATARS.map(av => `
                <button type="button" data-prof-av="${av}" class="h-10 rounded-xl text-lg flex items-center justify-center border transition ${pickedAvatar === av ? 'bg-indigo-600 border-indigo-600 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700'}">${av}</button>
              `).join('')}
            </div>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">${ar ? 'لون البطاقة' : 'Card Accent Color'}</label>
            <div class="flex items-center gap-2">
              ${COLORS.map(c => `
                <button type="button" data-prof-col="${c}" class="w-8 h-8 rounded-full border-2 transition ${pickedColor === c ? 'border-slate-800 dark:border-white scale-110' : 'border-transparent'}" style="background:${c}"></button>
              `).join('')}
            </div>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'الاسم الظاهر' : 'Display Name'}</label>
            <input id="prof-edit-name" type="text" maxlength="32" value="${escapeHtml(prof.name)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'التخصص أو الهدف' : 'Major / Goal'}</label>
            <input id="prof-edit-major" type="text" maxlength="44" value="${escapeHtml(prof.major)}" placeholder="${ar ? 'مثال: طالب طب • تحضير USMLE' : 'e.g. Med Student • USMLE Prep'}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'نبذة قصيرة (Bio)' : 'Short Bio'}</label>
            <input id="prof-edit-bio" type="text" maxlength="90" value="${escapeHtml(prof.bio)}" placeholder="${ar ? 'جملتك التحفيزية المفضلة...' : 'Your favorite study motto...'}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="prof-edit-save" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'حفظ' : 'Save'}</button>
      `
    });

    document.querySelectorAll('[data-prof-av]').forEach(btn => {
      btn.onclick = () => {
        pickedAvatar = btn.getAttribute('data-prof-av');
        document.querySelectorAll('[data-prof-av]').forEach(o => {
          const act = o.getAttribute('data-prof-av') === pickedAvatar;
          o.className = `h-10 rounded-xl text-lg flex items-center justify-center border transition ${act ? 'bg-indigo-600 border-indigo-600 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700'}`;
        });
      };
    });

    document.querySelectorAll('[data-prof-col]').forEach(btn => {
      btn.onclick = () => {
        pickedColor = btn.getAttribute('data-prof-col');
        document.querySelectorAll('[data-prof-col]').forEach(o => {
          const act = o.getAttribute('data-prof-col') === pickedColor;
          o.className = `w-8 h-8 rounded-full border-2 transition ${act ? 'border-slate-800 dark:border-white scale-110' : 'border-transparent'}`;
        });
      };
    });

    const saveBtn = document.getElementById('prof-edit-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const data = window.AppState.getData();
        if (!data.settings) data.settings = {};
        const nameVal = (document.getElementById('prof-edit-name').value || '').trim().slice(0, 32);
        const majorVal = (document.getElementById('prof-edit-major').value || '').trim().slice(0, 44);
        const bioVal = (document.getElementById('prof-edit-bio').value || '').trim().slice(0, 90);
        data.settings.profile = {
          avatar: pickedAvatar,
          color: pickedColor,
          name: nameVal,
          major: majorVal,
          bio: bioVal
        };
        if (nameVal) data.settings.groupNickname = nameVal;
        window.AppState.save(true);
        if (window.GroupsModule && window.GroupsModule.syncMyPresence) {
          window.GroupsModule.syncMyPresence(true);
        }
        window.AppUI.closeModal();
        window.AppUI.showToast(ar ? 'تم تحديث بروفايلك ✨' : 'Profile updated ✨', 'success');
        if (rerender) rerender();
      };
    }
  }

  function formatLastSync(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function renderOverviewContent(stats, gUser) {
    const ar = isAr();
    const hUnit = ar ? 'س' : 'h';
    return `
      <div class="space-y-4">
        <!-- Google Account & Cloud Sync Card -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200/70 dark:border-slate-700/70 space-y-3">
          ${(() => {
            const syncStatus = window.AppState.getSyncStatus();
            const lastTime = formatLastSync(syncStatus.lastSyncedAt);
            if (gUser) {
              const isErr = syncStatus.state === 'error' && syncStatus.lastError;
              const isSyncing = syncStatus.state === 'syncing';
              const statusBadge = isSyncing
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 shrink-0">${ar ? '🔄 يزامن...' : '🔄 Syncing'}</span>`
                : (isErr
                  ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 shrink-0">${ar ? '⚠️ خطأ' : '⚠️ Error'}</span>`
                  : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">● ${ar ? 'متصل' : 'Synced'}</span>`);
              const hasLocalBak = !!(window.GoogleSync && window.GoogleSync.getLocalPreSyncBackup && window.GoogleSync.getLocalPreSyncBackup());
              return `
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100">${ar ? '☁️ حساب Google والمزامنة' : '☁️ Google Account & Sync'}</div>
                    <div class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(gUser.email || gUser.displayName || '')}</div>
                  </div>
                  ${statusBadge}
                </div>
                ${isErr
                  ? `<div class="text-[11px] text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-xl">⚠️ ${escapeHtml(syncStatus.lastError)}</div>`
                  : `<div class="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>${ar ? 'المزامنة والدمج التلقائي مفعّلان' : 'Auto-sync & merge active'}</span>
                      ${lastTime ? `<span>${ar ? 'آخر مزامنة:' : 'Last:'} ${escapeHtml(lastTime)}</span>` : ''}
                    </div>`
                }
                <div class="grid grid-cols-2 gap-2">
                  <button id="prof-google-sync-now" type="button" class="py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? '🔄 مزامنة الآن' : '🔄 Sync Now'}</button>
                  <button id="prof-google-signout" type="button" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">${ar ? 'تسجيل الخروج' : 'Sign Out'}</button>
                </div>
                <details class="sync-recovery-details">
                  <summary class="text-[11px] font-bold text-slate-500 dark:text-slate-400 cursor-pointer py-1">${ar ? '🛡️ خيارات الاستعادة الاحتياطية' : '🛡️ Backup Recovery Options'}</summary>
                  <div class="grid grid-cols-2 gap-2 pt-2">
                    ${hasLocalBak ? `
                      <button id="prof-restore-local-bak" type="button" class="py-2 px-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                        ${ar ? '⏪ نسخة قبل المزامنة' : '⏪ Pre-Sync Backup'}
                      </button>
                    ` : ''}
                    <button id="prof-restore-cloud-bak" type="button" class="py-2 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold ${hasLocalBak ? '' : 'col-span-2'}">
                      ${ar ? '☁️ النسخة السحابية السابقة' : '☁️ Previous Cloud Backup'}
                    </button>
                  </div>
                </details>
              `;
            }
            return `
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100">${ar ? '☁️ ربط حساب Google' : '☁️ Link Google Account'}</div>
                <span class="text-[11px] text-slate-400">${ar ? 'غير متصل' : 'Not signed in'}</span>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                ${ar ? 'سجّل دخولك لمزامنة ساعاتك وبروفايلك تلقائياً بين الآيفون والآيباد والدخول إلى القاعة.' : 'Sign in to sync your hours & profile across devices and join Study Hall.'}
              </p>
              <button id="prof-google-signin" type="button" class="w-full py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">
                ${ar ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google'}
              </button>
            `;
          })()}
        </div>

        <!-- All-Time Stats Grid -->
        <div class="grid grid-cols-2 gap-2.5">
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm border border-slate-200/70 dark:border-slate-700/70">
            <div class="text-[11px] font-bold text-slate-400">${ar ? '⏱️ إجمالي الساعات' : '⏱️ Lifetime Hours'}</div>
            <div class="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">${stats.totalHours}${hUnit}</div>
            <div class="text-[10px] text-slate-400 mt-0.5">${ar ? `هذا الأسبوع: ${stats.weekHours}${hUnit}` : `This week: ${stats.weekHours}${hUnit}`}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm border border-slate-200/70 dark:border-slate-700/70">
            <div class="text-[11px] font-bold text-slate-400">${ar ? '📚 الكتب المكتملة' : '📚 Books Completed'}</div>
            <div class="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">${stats.totalBooks}</div>
            <div class="text-[10px] text-slate-400 mt-0.5">${ar ? `أطول جلسة: ${stats.longestSession}د` : `Longest: ${stats.longestSession}m`}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm border border-slate-200/70 dark:border-slate-700/70">
            <div class="text-[11px] font-bold text-slate-400">${ar ? '🔥 السلسلة الحالية' : '🔥 Current Streak'}</div>
            <div class="text-xl font-extrabold text-amber-500 tabular-nums mt-1">${stats.currentStreak} ${ar ? 'يوم' : 'd'}</div>
            <div class="text-[10px] text-slate-400 mt-0.5">${ar ? `الأعلى: ${stats.bestStreak} يوم` : `Best: ${stats.bestStreak}d`}</div>
          </div>
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm border border-slate-200/70 dark:border-slate-700/70">
            <div class="text-[11px] font-bold text-slate-400">${ar ? '⚖️ العجز الحالي' : '⚖️ Current Deficit'}</div>
            <div class="text-xl font-extrabold tabular-nums mt-1 ${stats.deficitHours > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">
              ${stats.deficitHours > 0 ? `${stats.deficitHours}${hUnit}` : (ar ? '0 ✓' : '0 ✓')}
            </div>
            <div class="text-[10px] text-slate-400 mt-0.5">${stats.deficitHours > 0 ? (ar ? 'قابل للتعويض' : 'Catch up anytime') : (ar ? 'سجل نظيف!' : 'All caught up!')}</div>
          </div>
        </div>

        <!-- Unlockable Badges Wall -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200/70 dark:border-slate-700/70 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '🏅 جدار الأوسمة' : '🏅 Achievements Wall'}</h3>
            <span class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">${stats.unlockedCount} / ${stats.badges.length}</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${stats.badges.map(b => `
              <div class="profile-badge-card ${b.unlocked ? '' : 'profile-badge-locked'}">
                <span class="text-xl shrink-0">${b.icon}</span>
                <div class="min-w-0">
                  <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">${ar ? b.ar : b.en}</div>
                  <div class="text-[10px] text-slate-400 truncate">${ar ? b.descAr : b.descEn}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderSettingsContent() {
    const ar = isAr();
    const themePref = window.AppState && window.AppState.getThemePref ? window.AppState.getThemePref() : 'auto';
    const langPref = window.I18n && window.I18n.getLangPref ? window.I18n.getLangPref() : 'auto';
    const settingsHtml = window.SettingsModule ? window.SettingsModule.render() : '';
    const pillCls = (act) => act
      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
      : 'bg-slate-100 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-transparent';

    return `
      <div class="space-y-4">
        <!-- Device-Synced Appearance & Language Card -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div>
            <div class="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">🌗 ${ar ? 'المظهر (الوضع الداكن)' : 'Appearance'}</div>
            <div class="grid grid-cols-3 gap-1.5">
              <button type="button" data-prof-theme="auto" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(themePref === 'auto')}">📱 ${ar ? 'الجهاز' : 'Device'}</button>
              <button type="button" data-prof-theme="light" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(themePref === 'light')}">☀️ ${ar ? 'فاتح' : 'Light'}</button>
              <button type="button" data-prof-theme="dark" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(themePref === 'dark')}">🌙 ${ar ? 'داكن' : 'Dark'}</button>
            </div>
          </div>
          <div class="pt-2.5 border-t border-slate-100 dark:border-slate-700">
            <div class="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">🌐 ${ar ? 'اللغة' : 'Language'}</div>
            <div class="grid grid-cols-3 gap-1.5">
              <button type="button" data-prof-lang="auto" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(langPref === 'auto')}">📱 ${ar ? 'الجهاز' : 'Device'}</button>
              <button type="button" data-prof-lang="ar" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(langPref === 'ar')}">العربية</button>
              <button type="button" data-prof-lang="en" class="py-2 px-2 rounded-xl text-[11px] font-bold border transition ${pillCls(langPref === 'en')}">English</button>
            </div>
          </div>
        </div>
        ${settingsHtml}
      </div>
    `;
  }

  function updateSubTabIndicator(immediate = false) {
    const bar = document.getElementById('profile-subtabs-bar');
    const ind = document.getElementById('profile-subtabs-indicator');
    if (!bar || !ind) return;
    const activeBtn = bar.querySelector(`[data-prof-subtab="${activeSubTab}"]`);
    if (!activeBtn) return;

    if (immediate) ind.classList.add('no-transition');
    ind.style.width = `${activeBtn.offsetWidth}px`;
    ind.style.transform = `translate3d(${activeBtn.offsetLeft}px, 0, 0)`;
    ind.style.opacity = '1';
    if (immediate) {
      void ind.offsetWidth;
      ind.classList.remove('no-transition');
    }
  }

  function bindOverviewEvents(rerender) {
    const ar = isAr();
    const gSignInBtn = document.getElementById('prof-google-signin');
    if (gSignInBtn && window.GoogleSync) {
      gSignInBtn.onclick = async () => {
        const res = await window.GoogleSync.signIn();
        if (res && res.ok && !res.redirecting && rerender) rerender();
      };
    }
    const gSyncNowBtn = document.getElementById('prof-google-sync-now');
    if (gSyncNowBtn && window.GoogleSync) {
      gSyncNowBtn.onclick = async () => {
        const res = await window.GoogleSync.syncNow(false);
        if (res && res.updated && rerender) rerender();
        else if (rerender) rerender();
      };
    }
    const gSignOutBtn = document.getElementById('prof-google-signout');
    if (gSignOutBtn && window.GoogleSync) {
      gSignOutBtn.onclick = async () => {
        await window.GoogleSync.signOut();
        if (rerender) rerender();
      };
    }
    const localBakBtn = document.getElementById('prof-restore-local-bak');
    if (localBakBtn && window.GoogleSync) {
      localBakBtn.onclick = () => {
        window.AppUI.confirmAction({
          title: ar ? 'استعادة نسخة ما قبل المزامنة' : 'Restore Pre-Sync Backup',
          message: ar ? 'سيتم استرجاع بياناتك المحلية المحفوظة قبل آخر مزامنة. هل تريد المتابعة؟' : 'Restore your local data snapshot saved before the last sync?',
          confirmText: ar ? 'استعادة' : 'Restore',
          onConfirm: async () => {
            const res = await window.GoogleSync.restoreLocalPreSyncBackup();
            window.AppUI.showToast(res.ok ? (ar ? 'تمت الاستعادة بنجاح ⏪' : 'Backup restored ⏪') : (res.error || 'Error'), res.ok ? 'success' : 'warning');
            if (res.ok && rerender) rerender();
          }
        });
      };
    }
    const cloudBakBtn = document.getElementById('prof-restore-cloud-bak');
    if (cloudBakBtn && window.GoogleSync) {
      cloudBakBtn.onclick = () => {
        window.AppUI.confirmAction({
          title: ar ? 'استعادة النسخة السحابية السابقة' : 'Restore Previous Cloud Backup',
          message: ar ? 'سيتم سحب النسخة الاحتياطية التلقائية السابقة من السحابة واستبدال البيانات الحالية. هل تريد المتابعة؟' : 'Pull the automatic previous backup from Firestore and restore it?',
          confirmText: ar ? 'استعادة' : 'Restore',
          onConfirm: async () => {
            const res = await window.GoogleSync.restoreCloudBackup();
            window.AppUI.showToast(res.ok ? (ar ? 'تمت استعادة النسخة السحابية ☁️' : 'Cloud backup restored ☁️') : (res.error || 'Error'), res.ok ? 'success' : 'warning');
            if (res.ok && rerender) rerender();
          }
        });
      };
    }
  }

  function bindSettingsEvents(rerender) {
    document.querySelectorAll('[data-prof-theme]').forEach(btn => {
      btn.onclick = () => {
        const next = btn.getAttribute('data-prof-theme');
        if (window.AppState && window.AppState.setThemePref) {
          window.AppState.setThemePref(next, true, true);
        }
        if (rerender) rerender();
      };
    });
    document.querySelectorAll('[data-prof-lang]').forEach(btn => {
      btn.onclick = () => {
        const next = btn.getAttribute('data-prof-lang');
        if (window.I18n && window.I18n.setLang) {
          window.I18n.setLang(next, true, true);
        }
        if (window.AppState && window.AppState.markLedgerDirty) window.AppState.markLedgerDirty();
        if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
      };
    });
    if (window.SettingsModule && window.SettingsModule.bindEvents) {
      window.SettingsModule.bindEvents(rerender);
    }
  }

  function setSubTab(nextSub, animate = true) {
    if (nextSub !== 'overview' && nextSub !== 'settings') return;
    const prevSub = activeSubTab;
    activeSubTab = nextSub;

    const bar = document.getElementById('profile-subtabs-bar');
    const contentEl = document.getElementById('profile-subtab-content');
    if (!bar || !contentEl) return;

    bar.querySelectorAll('[data-prof-subtab]').forEach(btn => {
      const isAct = btn.getAttribute('data-prof-subtab') === activeSubTab;
      btn.classList.toggle('is-active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });
    updateSubTabIndicator(!animate);

    if (prevSub === nextSub && contentEl.children.length) return;

    const stats = computeProfileStats();
    const gUser = window.GoogleSync && window.GoogleSync.getUser();
    contentEl.innerHTML = activeSubTab === 'settings'
      ? renderSettingsContent()
      : renderOverviewContent(stats, gUser);

    if (animate) {
      contentEl.classList.remove('tab-slide-next', 'tab-slide-prev', 'tab-animate');
      void contentEl.offsetWidth;
      contentEl.classList.add(activeSubTab === 'settings' ? 'tab-slide-next' : 'tab-slide-prev');
    }

    if (activeSubTab === 'settings') {
      bindSettingsEvents(lastRerenderCb);
    } else {
      bindOverviewEvents(lastRerenderCb);
    }
  }

  function render() {
    const ar = isAr();
    const prof = getProfileData();
    const stats = computeProfileStats();
    const gUser = window.GoogleSync && window.GoogleSync.getUser();

    return `
      <div class="space-y-4">
        <!-- Profile Hero Card -->
        <div class="profile-hero-card" style="--prof-accent:${escapeHtml(prof.color)}">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="profile-hero-avatar" style="background:${escapeHtml(prof.color)}">${escapeHtml(prof.avatar)}</div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <h2 class="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(prof.name)}</h2>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 shrink-0">${stats.tier.icon} ${ar ? stats.tier.ar : stats.tier.en}</span>
                </div>
                ${prof.major ? `<div class="text-xs font-bold text-slate-600 dark:text-slate-300 truncate mt-0.5">${escapeHtml(prof.major)}</div>` : ''}
                ${gUser && gUser.email ? `<div class="text-[10px] text-slate-400 truncate mt-0.5">☁️ ${escapeHtml(gUser.email)}</div>` : ''}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button id="prof-share-btn" type="button" class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm" title="${ar ? 'نسخ بطاقة البروفايل' : 'Share Profile'}">📤</button>
              <button id="prof-edit-btn" type="button" class="px-3 h-8 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'تعديل' : 'Edit'}</button>
            </div>
          </div>
          ${prof.bio ? `<p class="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">“${escapeHtml(prof.bio)}”</p>` : ''}
        </div>

        <!-- Profile / Settings Sliding Segmented Switcher -->
        <div id="profile-subtabs-bar" class="profile-subtabs" role="tablist">
          <div id="profile-subtabs-indicator" class="profile-subtabs-indicator" aria-hidden="true"></div>
          <button type="button" role="tab" data-prof-subtab="overview" aria-selected="${activeSubTab === 'overview' ? 'true' : 'false'}" class="profile-subtab-btn ${activeSubTab === 'overview' ? 'is-active' : ''}">
            <span>👤</span>
            <span>${ar ? 'ملفي والأوسمة' : 'Overview'}</span>
          </button>
          <button type="button" role="tab" data-prof-subtab="settings" aria-selected="${activeSubTab === 'settings' ? 'true' : 'false'}" class="profile-subtab-btn ${activeSubTab === 'settings' ? 'is-active' : ''}">
            <span>⚙️</span>
            <span>${ar ? 'الإعدادات' : 'Settings'}</span>
          </button>
        </div>

        <!-- Active Sub-Tab Body -->
        <div id="profile-subtab-content">
          ${activeSubTab === 'settings' ? renderSettingsContent() : renderOverviewContent(stats, gUser)}
        </div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    lastRerenderCb = rerender;
    const ar = isAr();
    const editBtn = document.getElementById('prof-edit-btn');
    if (editBtn) editBtn.onclick = () => openEditProfileModal(rerender);

    const shareBtn = document.getElementById('prof-share-btn');
    if (shareBtn) {
      shareBtn.onclick = () => {
        const prof = getProfileData();
        const stats = computeProfileStats();
        const text = [
          `${prof.avatar} ${prof.name}${prof.major ? ' • ' + prof.major : ''}`,
          ar
            ? `${stats.tier.icon} الرتبة: ${stats.tier.ar} | ⏱️ الإجمالي: ${stats.totalHours}س | 📚 ${stats.totalBooks} كتاب | 🔥 السلسلة: ${stats.currentStreak} يوم | 🏅 الأوسمة: ${stats.unlockedCount}/${stats.badges.length}`
            : `${stats.tier.icon} Tier: ${stats.tier.en} | ⏱️ Total: ${stats.totalHours}h | 📚 ${stats.totalBooks} books | 🔥 Streak: ${stats.currentStreak}d | 🏅 Badges: ${stats.unlockedCount}/${stats.badges.length}`
        ].join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            window.AppUI.showToast(ar ? 'تم نسخ بطاقة بروفايلك 📋' : 'Profile card copied 📋', 'success');
          }).catch(() => {});
        }
      };
    }

    const bar = document.getElementById('profile-subtabs-bar');
    if (bar) {
      bar.querySelectorAll('[data-prof-subtab]').forEach(btn => {
        btn.onclick = () => {
          const next = btn.getAttribute('data-prof-subtab');
          if (next && next !== activeSubTab) {
            setSubTab(next, true);
          }
        };
      });
      requestAnimationFrame(() => updateSubTabIndicator(true));
    }

    if (activeSubTab === 'settings') {
      bindSettingsEvents(rerender);
    } else {
      bindOverviewEvents(rerender);
    }
  }

  return {
    render,
    bindEvents,
    getProfileData,
    computeProfileStats,
    setSubTab
  };
})();