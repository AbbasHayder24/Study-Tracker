/**
 * settings.js — Settings tab: Language (EN/AR), Smart 1-Field Auto-Sync, notifications, start date, subjects, tags, backup
 */
window.SettingsModule = (function () {
  const CLASSIC_SWATCHES = [
    '#1E3A5F', '#C9A24D', '#1E7A5F', '#962B3A', '#475569',
    '#4F46E5', '#0EA5E9', '#D97706', '#7C3AED', '#E11D48'
  ];
  const TAG_EMOJIS = [
    '🏆', '🧠', '📖', '🔬', '💻', '🩺', '✍️', '🎯',
    '⚡', '☕', '🎧', '📚', '📝', '🧪', '🏛️', '📐',
    '🎨', '🔥', '⏰', '💡', '🌿', '📌', '⭐', '🎓'
  ];
  let pendingNewTagEmoji = '🏷️';

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }

  function extractLeadingEmoji(str) {
    const s = String(str || '').trim();
    const m = s.match(/^((?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*))\s*/u);
    return m ? { emoji: m[1], rest: s.slice(m[0].length) } : { emoji: '🏷️', rest: s };
  }

  function applyEmojiToName(name, emoji) {
    const parsed = extractLeadingEmoji(name);
    const cleanEmoji = String(emoji || '').trim();
    const base = parsed.rest || parsed.emoji;
    return cleanEmoji ? `${cleanEmoji} ${base}` : base;
  }

  function formatLastSync(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function render() {
    const data = window.AppState.getData();
    const settings = data.settings || { soundEnabled: true, notificationsEnabled: false };
    const notifGranted = settings.notificationsEnabled && typeof window.Notification !== 'undefined' && Notification.permission === 'granted';
    const pushWorkerUrl = window.PushManagerClient ? window.PushManagerClient.getWorkerUrl() : (settings.pushWorkerUrl || '');
    const pushActive = !!settings.pushEnabled && !!pushWorkerUrl && typeof window.Notification !== 'undefined' && Notification.permission === 'granted';
    const syncCfg = window.AppState.getSyncConfig();
    const syncStatus = window.AppState.getSyncStatus();
    const isConnected = !!syncCfg.token;
    const lastTime = formatLastSync(syncStatus.lastSyncedAt);
    const curLang = window.I18n ? window.I18n.getLang() : 'en';

    return `
      <div class="space-y-4">
        <!-- Language Switcher -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('languageTitle')}</h3>
          <div class="grid grid-cols-2 gap-2">
            <button id="setting-lang-en" type="button" class="py-2.5 px-3 rounded-xl text-xs font-bold transition ${curLang === 'en' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}">
              🇬🇧 English
            </button>
            <button id="setting-lang-ar" type="button" class="py-2.5 px-3 rounded-xl text-xs font-bold transition ${curLang === 'ar' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}">
              🇮🇶 العربية
            </button>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${isAr() ? '☁️ المزامنة بحساب Google' : '☁️ Google Account Sync'}</h3>
            ${window.GoogleSync && window.GoogleSync.getUser()
              ? `<span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">● ${isAr() ? 'متصل' : 'Connected'}</span>`
              : `<span class="text-[11px] text-slate-400">${isAr() ? 'غير متصل' : 'Not signed in'}</span>`
            }
          </div>
          ${(() => {
            const gUser = window.GoogleSync && window.GoogleSync.getUser();
            if (gUser) {
              return `
                <div class="text-xs text-slate-600 dark:text-slate-300 truncate">${window.AppUI.escapeHtml(gUser.displayName || gUser.email)} ${gUser.displayName && gUser.email ? `(${window.AppUI.escapeHtml(gUser.email)})` : ''}</div>
                <div class="grid grid-cols-2 gap-2">
                  <button id="setting-google-sync-now" type="button" class="py-2 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">${isAr() ? '🔄 مزامنة الآن' : '🔄 Sync Now'}</button>
                  <button id="setting-google-signout" type="button" class="py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">${isAr() ? 'تسجيل الخروج' : 'Sign Out'}</button>
                </div>
              `;
            }
            return `
              <button id="setting-google-signin" type="button" class="w-full py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">
                ${isAr() ? 'تسجيل الدخول والمزامنة بحساب Google' : 'Sign in & Sync with Google'}
              </button>
            `;
          })()}
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">${t('startDateTitle')}</h3>
            <div class="flex gap-2">
              <input id="setting-start-date" type="date" value="${window.AppUI.escapeHtml(data.startDate)}" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
              <button id="setting-save-date" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">${t('save')}</button>
            </div>
            <button id="setting-edit-challenge" type="button" class="mt-2.5 w-full py-2.5 px-3 rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-bold">
              ${t('customizeChallengeBtn')}
            </button>
          </div>
          <div>
            <div class="flex items-center gap-1.5 mb-1.5">
              <label for="setting-day-start-hour" class="text-xs font-bold text-slate-700 dark:text-slate-200">${t('newDayStartsAt')}</label>
              ${window.AppUI.infoButtonHtml('info-daystart-btn')}
            </div>
            <select id="setting-day-start-hour" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">
              ${[0,1,2,3,4,5,6].map(h => {
                const cur = Number(settings.dayStartHour) || 0;
                const label = h === 0 ? t('midnightDefault') : t('hourAm', { h });
                return `<option value="${h}" ${cur === h ? 'selected' : ''}>${label}</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 mb-3">${t('subjectsTitle')}</h3>
          <form id="setting-add-subject-form" class="flex items-center gap-2 mb-3" style="width:100%;min-width:0">
            <input id="setting-subj-name" type="text" required placeholder="${window.AppUI.escapeHtml(t('newSubjectPlaceholder'))}" style="min-width:0;width:0;flex:1 1 0%" class="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <input id="setting-subj-color" type="color" value="#1E3A5F" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer p-0.5 bg-transparent shrink-0"/>
            <button type="submit" class="h-10 px-3.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shrink-0 flex items-center justify-center">${t('add')}</button>
          </form>
          <div class="flex flex-wrap gap-2">
            ${data.subjects.map(s => {
              const linkedTag = s.defaultTagId ? data.tags.find(tg => tg.id === s.defaultTagId) : null;
              const tagBadge = linkedTag ? `<span class="opacity-85 text-[10px]">${window.AppUI.escapeHtml(extractLeadingEmoji(linkedTag.name).emoji)}</span>` : '';
              return `
              <button type="button" data-edit-subject="${window.AppUI.escapeHtml(s.id)}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white hover:opacity-85" style="background:${window.AppUI.escapeHtml(s.color)}" title="${isAr() ? 'اضغط للتعديل أو الحذف' : 'Tap to edit or delete'}">
                ${tagBadge}<span>${window.AppUI.escapeHtml(s.name)}</span>
              </button>
            `;
            }).join('')}
          </div>
          <p class="text-[10px] text-slate-400 mt-2">${isAr() ? 'اضغط على أي مادة لتعديل اسمها أو لونها أو ربطها بتاغ افتراضي.' : 'Tap any subject to edit its name, color, or linked default tag.'}</p>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-1.5 mb-3">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('customTagsTitle')}</h3>
            ${window.AppUI.infoButtonHtml('info-tags-btn')}
          </div>
          <form id="setting-add-tag-form" class="flex items-center gap-1.5 mb-3" style="width:100%;min-width:0">
            <button id="setting-new-tag-emoji-btn" type="button" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-base flex items-center justify-center shrink-0" title="${isAr() ? 'اختر إيموجي' : 'Choose emoji'}">${pendingNewTagEmoji}</button>
            <input id="setting-tag-name" type="text" required placeholder="${window.AppUI.escapeHtml(t('newTagPlaceholder'))}" style="min-width:0;width:0;flex:1 1 0%" class="h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <input id="setting-tag-color" type="color" value="#1E3A5F" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer p-0.5 bg-transparent shrink-0"/>
            <button type="submit" class="h-10 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold shrink-0 flex items-center justify-center">${t('add')}</button>
          </form>
          <div class="space-y-2">
            ${data.tags.map(tg => {
              const curEmoji = extractLeadingEmoji(tg.name).emoji;
              return `
              <div class="flex items-center gap-1.5" style="width:100%;min-width:0">
                <button type="button" data-tag-emoji="${window.AppUI.escapeHtml(tg.id)}" class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm flex items-center justify-center shrink-0" title="${isAr() ? 'تغيير الإيموجي' : 'Change emoji'}">${curEmoji}</button>
                <input type="color" data-tag-color="${window.AppUI.escapeHtml(tg.id)}" value="${window.AppUI.escapeHtml(tg.color)}" class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent shrink-0"/>
                <input type="text" data-tag-name="${window.AppUI.escapeHtml(tg.id)}" value="${window.AppUI.escapeHtml(tg.name)}" style="min-width:0;width:0;flex:1 1 0%" class="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
                ${tg.id !== 'study'
                  ? `<button type="button" data-del-tag="${window.AppUI.escapeHtml(tg.id)}" class="w-7 h-8 flex items-center justify-center text-rose-500 text-xs font-bold shrink-0" title="${window.AppUI.escapeHtml(t('delete'))}">✕</button>`
                  : `<span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold px-1 shrink-0">${t('coreBadge')}</span>`
                }
              </div>
            `;
            }).join('')}
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center gap-1.5">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('backupTitle')}</h3>
            ${window.AppUI.infoButtonHtml('info-backup-btn')}
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button id="setting-export-json" class="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">${t('downloadJson')}</button>
            <button id="setting-copy-json" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold">${t('copyJson')}</button>
          </div>
          <div class="pt-1">
            <input id="setting-import-file" type="file" accept=".json,application/json" class="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900/40 dark:file:text-indigo-300"/>
          </div>
          <div>
            <textarea id="setting-paste-json" rows="2" dir="ltr" placeholder="${window.AppUI.escapeHtml(t('pasteJsonPlaceholder'))}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono"></textarea>
            <button id="setting-restore-paste" class="mt-1.5 w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">${t('restoreFromText')}</button>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2">
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('dataMgmtTitle')}</h3>
          <div class="grid grid-cols-2 gap-2">
            <button id="setting-load-demo" class="py-2.5 px-3 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-bold">${t('loadDemo')}</button>
            <button id="setting-reset-all" class="py-2.5 px-3 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 text-xs font-bold">${t('resetAll')}</button>
          </div>
        </div>
      </div>
    `;
  }

  function restoreFromJSONString(raw, rerender) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
      window.AppState.replaceData(parsed);
      window.AppUI.showToast(t('backupRestored'), 'success');
      rerender();
    } catch (e) {
      window.AppUI.showToast(t('invalidJson'), 'danger');
    }
  }

  function showSyncInfo() {
    window.AppUI.showInfo(t('syncInfoTitle'), t('syncInfoBody'));
  }

  function bindEvents(rerender) {
    const gSignInBtn = document.getElementById('setting-google-signin');
    if (gSignInBtn && window.GoogleSync) {
      gSignInBtn.onclick = async () => {
        const res = await window.GoogleSync.signIn();
        if (res && res.ok && !res.redirecting) rerender();
      };
    }
    const gSyncNowBtn = document.getElementById('setting-google-sync-now');
    if (gSyncNowBtn && window.GoogleSync) {
      gSyncNowBtn.onclick = async () => {
        const res = await window.GoogleSync.syncNow(false);
        if (res && res.updated) rerender();
      };
    }
    const gSignOutBtn = document.getElementById('setting-google-signout');
    if (gSignOutBtn && window.GoogleSync) {
      gSignOutBtn.onclick = async () => {
        await window.GoogleSync.signOut();
        rerender();
      };
    }

    const langEnBtn = document.getElementById('setting-lang-en');
    const langArBtn = document.getElementById('setting-lang-ar');
    if (langEnBtn) {
      langEnBtn.onclick = () => {
        window.I18n.setLang('en', true, true);
        window.AppState.markLedgerDirty();
        rerender();
      };
    }
    if (langArBtn) {
      langArBtn.onclick = () => {
        window.I18n.setLang('ar', true, true);
        window.AppState.markLedgerDirty();
        rerender();
      };
    }

    const enableNotifBtn = document.getElementById('setting-enable-notif');
    if (enableNotifBtn) {
      enableNotifBtn.onclick = async () => {
        await window.AppUI.requestNotificationPermission();
        rerender();
      };
    }

    const togglePushBtn = document.getElementById('setting-toggle-push');
    if (togglePushBtn && window.PushManagerClient) {
      togglePushBtn.onclick = async () => {
        const data = window.AppState.getData();
        if (data.settings && data.settings.pushEnabled) {
          await window.PushManagerClient.unsubscribe();
          window.AppUI.showToast(t('pushDisabledToast'), 'info');
          rerender();
          return;
        }
        const res = await window.PushManagerClient.subscribe();
        if (res.ok) {
          window.AppUI.showToast(t('pushEnabledToast'), 'success');
        } else {
          window.AppUI.showToast(res.error || t('notifError'), 'warning');
        }
        rerender();
      };
    }

    const testPushBtn = document.getElementById('setting-test-push');
    if (testPushBtn && window.PushManagerClient) {
      testPushBtn.onclick = async () => {
        const res = await window.PushManagerClient.sendTestPush(5);
        if (res.ok) {
          window.AppUI.showToast(t('pushTestScheduled'), 'success');
        } else {
          window.AppUI.showToast(res.error || t('notifError'), 'warning');
        }
      };
    }

    const infoTagsBtn = document.getElementById('info-tags-btn');
    if (infoTagsBtn) {
      infoTagsBtn.onclick = () => {
        window.AppUI.showInfo(t('customTagsTitle'), t('tagsInfoBody'));
      };
    }

    const infoBackupBtn = document.getElementById('info-backup-btn');
    if (infoBackupBtn) {
      infoBackupBtn.onclick = () => {
        window.AppUI.showInfo(t('backupTitle'), t('backupInfoBody'));
      };
    }

    const infoDayStartBtn = document.getElementById('info-daystart-btn');
    if (infoDayStartBtn) {
      infoDayStartBtn.onclick = () => {
        window.AppUI.showInfo(t('newDayStartsAt'), t('dayStartInfoBody'));
      };
    }

    const dayStartSel = document.getElementById('setting-day-start-hour');
    if (dayStartSel) {
      dayStartSel.onchange = (e) => {
        const data = window.AppState.getData();
        data.settings.dayStartHour = Number(e.target.value) || 0;
        window.AppState.markLedgerDirty();
        window.AppState.save();
        window.AppUI.showToast(t('dayStartSaved'), 'success');
        rerender();
      };
    }

    const editChBtn = document.getElementById('setting-edit-challenge');
    if (editChBtn && window.ChallengeModule && window.ChallengeModule.openEditChallengeModal) {
      editChBtn.onclick = () => window.ChallengeModule.openEditChallengeModal(rerender);
    }

    const saveDateBtn = document.getElementById('setting-save-date');
    if (saveDateBtn) {
      saveDateBtn.onclick = () => {
        const val = document.getElementById('setting-start-date').value;
        if (!val) return;
        window.AppState.getData().startDate = val;
        window.AppState.getData().startDateUpdatedAt = Date.now();
        window.AppState.markLedgerDirty();
        window.AppState.save();
        window.AppUI.showToast(t('startDateUpdated'), 'success');
        rerender();
      };
    }

    const subjForm = document.getElementById('setting-add-subject-form');
    if (subjForm) {
      subjForm.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('setting-subj-name').value.trim();
        const color = document.getElementById('setting-subj-color').value || '#6366f1';
        if (!name) return;
        window.AppState.getData().subjects.push({
          id: 'subj_' + Date.now(),
          name,
          color
        });
        window.AppState.save();
        window.AppUI.showToast(t('subjectAdded'), 'success');
        rerender();
      };
    }

    function openEmojiPickerModal(currentEmoji, onSelect) {
      const ar = isAr();
      const gridHtml = TAG_EMOJIS.map(em => `
        <button type="button" data-pick-emoji="${em}" style="width:100%;height:38px" class="rounded-xl border ${em === currentEmoji ? 'border-indigo-200 bg-indigo-50 dark:bg-indigo-900/40' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'} text-lg flex items-center justify-center hover:opacity-80">${em}</button>
      `).join('');
      const bodyHtml = `
        <div class="space-y-3">
          <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px">${gridHtml}</div>
          <div class="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700" style="width:100%;min-width:0">
            <input id="custom-emoji-input" type="text" maxlength="8" placeholder="${ar ? 'أو اكتب أي إيموجي...' : 'Or type any emoji...'}" value="${window.AppUI.escapeHtml(currentEmoji || '')}" style="min-width:0;width:0;flex:1 1 0%" class="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <button id="custom-emoji-apply" type="button" class="h-10 px-3.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shrink-0 flex items-center justify-center">${ar ? 'تطبيق' : 'Apply'}</button>
          </div>
        </div>
      `;
      window.AppUI.openModal({ title: ar ? 'اختر إيموجي للتاغ' : 'Choose Tag Emoji', bodyHtml, footerHtml: '' });
      document.querySelectorAll('[data-pick-emoji]').forEach(b => {
        b.onclick = () => {
          onSelect(b.getAttribute('data-pick-emoji'));
          window.AppUI.closeModal();
        };
      });
      const applyBtn = document.getElementById('custom-emoji-apply');
      if (applyBtn) {
        applyBtn.onclick = () => {
          const val = (document.getElementById('custom-emoji-input').value || '').trim();
          onSelect(val);
          window.AppUI.closeModal();
        };
      }
    }

    document.querySelectorAll('[data-edit-subject]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-edit-subject');
        const data = window.AppState.getData();
        const subj = data.subjects.find(s => s.id === id);
        if (!subj) return;
        const ar = isAr();
        const swatchesHtml = CLASSIC_SWATCHES.map(c => `
          <button type="button" data-subj-swatch="${c}" class="w-7 h-7 rounded-full" style="background:${c};border:2px solid ${c.toLowerCase() === String(subj.color || '').toLowerCase() ? 'currentColor' : 'transparent'}"></button>
        `).join('');
        const tagOpts = [
          `<option value="">${ar ? '— بدون ربط تلقائي —' : '— No default tag —'}</option>`,
          ...data.tags.map(tg => `<option value="${window.AppUI.escapeHtml(tg.id)}" ${subj.defaultTagId === tg.id ? 'selected' : ''}>${window.AppUI.escapeHtml(tg.name)}</option>`)
        ].join('');

        const bodyHtml = `
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'اسم المادة' : 'Subject Name'}</label>
              <input id="edit-subj-name" type="text" value="${window.AppUI.escapeHtml(subj.name)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'لون المادة' : 'Subject Color'}</label>
              <div class="flex items-center gap-2 mb-2">
                <input id="edit-subj-color" type="color" value="${window.AppUI.escapeHtml(subj.color || '#1E3A5F')}" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer p-0.5 bg-transparent"/>
                <div class="flex flex-wrap gap-1.5">${swatchesHtml}</div>
              </div>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'التاغ الافتراضي عند اختيار المادة في المؤقت' : 'Default Tag in Focus Timer'}</label>
              <select id="edit-subj-tag" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium">${tagOpts}</select>
            </div>
            <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input id="edit-subj-update-books" type="checkbox" checked class="accent-indigo-600"/>
              <span>${ar ? 'تحديث لون الكتب والجلسات السابقة لهذه المادة' : 'Update color on past books & sessions for this subject'}</span>
            </label>
          </div>
        `;
        const footerHtml = `
          <button id="edit-subj-delete-btn" type="button" class="mr-auto px-3.5 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">${ar ? 'حذف' : 'Delete'}</button>
          <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
          <button id="edit-subj-save-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'حفظ' : 'Save'}</button>
        `;
        window.AppUI.openModal({ title: ar ? 'تعديل المادة' : 'Edit Subject', bodyHtml, footerHtml });

        const colorInput = document.getElementById('edit-subj-color');
        document.querySelectorAll('[data-subj-swatch]').forEach(sw => {
          sw.onclick = () => {
            if (colorInput) colorInput.value = sw.getAttribute('data-subj-swatch');
          };
        });

        const delBtn = document.getElementById('edit-subj-delete-btn');
        if (delBtn) {
          delBtn.onclick = () => {
            data.subjects = data.subjects.filter(item => item.id !== subj.id);
            window.AppState.markDeleted(subj.id);
            window.AppState.save();
            window.AppUI.closeModal();
            window.AppUI.showToast(ar ? 'تم حذف المادة' : 'Subject deleted', 'info');
            rerender();
          };
        }

        const saveBtn = document.getElementById('edit-subj-save-btn');
        if (saveBtn) {
          saveBtn.onclick = () => {
            const newName = (document.getElementById('edit-subj-name').value || '').trim();
            const newColor = (colorInput && colorInput.value) || subj.color || '#1E3A5F';
            const newTagId = (document.getElementById('edit-subj-tag').value || '').trim();
            const updateBooks = !!(document.getElementById('edit-subj-update-books') && document.getElementById('edit-subj-update-books').checked);
            if (!newName) return;

            subj.name = newName;
            subj.color = newColor;
            if (newTagId) subj.defaultTagId = newTagId;
            else delete subj.defaultTagId;

            if (updateBooks && Array.isArray(data.focusSessions)) {
              data.focusSessions.forEach(sess => {
                if (sess && sess.subjectId === subj.id) {
                  sess.color = newColor;
                  sess.subjectName = newName;
                }
              });
            }
            window.AppState.save();
            window.AppUI.closeModal();
            window.AppUI.showToast(ar ? 'تم تحديث المادة بنجاح' : 'Subject updated', 'success');
            rerender();
          };
        }
      };
    });

    document.querySelectorAll('[data-del-subject]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-del-subject');
        const data = window.AppState.getData();
        data.subjects = data.subjects.filter(s => s.id !== id);
        window.AppState.markDeleted(id);
        window.AppState.save();
        rerender();
      };
    });

    const newTagEmojiBtn = document.getElementById('setting-new-tag-emoji-btn');
    if (newTagEmojiBtn) {
      newTagEmojiBtn.onclick = () => {
        openEmojiPickerModal(pendingNewTagEmoji, (picked) => {
          pendingNewTagEmoji = picked || '🏷️';
          newTagEmojiBtn.textContent = pendingNewTagEmoji;
        });
      };
    }

    document.querySelectorAll('[data-tag-emoji]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-tag-emoji');
        const tag = window.AppState.getData().tags.find(tg => tg.id === id);
        if (!tag) return;
        const cur = extractLeadingEmoji(tag.name).emoji;
        openEmojiPickerModal(cur, (picked) => {
          tag.name = applyEmojiToName(tag.name, picked);
          window.AppState.save();
          window.AppUI.showToast(isAr() ? 'تم تحديث إيموجي التاغ' : 'Tag emoji updated', 'success');
          rerender();
        });
      };
    });

    const tagForm = document.getElementById('setting-add-tag-form');
    if (tagForm) {
      tagForm.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('setting-tag-name').value.trim();
        const color = document.getElementById('setting-tag-color').value || '#8b5cf6';
        if (!name) return;
        const finalTagName = pendingNewTagEmoji ? applyEmojiToName(name, pendingNewTagEmoji) : name;
        window.AppState.getData().tags.push({
          id: 'tag_' + Date.now(),
          name: finalTagName,
          color,
          countsForChallenge: false
        });
        window.AppState.save();
        window.AppUI.showToast(t('tagAdded'), 'success');
        rerender();
      };
    }

    document.querySelectorAll('[data-tag-name]').forEach(input => {
      input.onchange = (e) => {
        const id = input.getAttribute('data-tag-name');
        const tag = window.AppState.getData().tags.find(tg => tg.id === id);
        const val = e.target.value.trim();
        if (tag && val) {
          tag.name = val;
          window.AppState.save();
          window.AppUI.showToast(t('tagNameUpdated'), 'success');
        }
      };
    });

    document.querySelectorAll('[data-tag-color]').forEach(input => {
      input.onchange = (e) => {
        const id = input.getAttribute('data-tag-color');
        const tag = window.AppState.getData().tags.find(tg => tg.id === id);
        if (tag) {
          tag.color = e.target.value;
          window.AppState.save();
          window.AppUI.showToast(t('tagColorUpdated'), 'success');
        }
      };
    });

    document.querySelectorAll('[data-del-tag]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-del-tag');
        if (id === 'study') return;
        const data = window.AppState.getData();
        data.tags = data.tags.filter(tg => tg.id !== id);
        window.AppState.markDeleted(id);
        window.AppState.save();
        window.AppUI.showToast(t('tagDeleted'), 'warning');
        rerender();
      };
    });

    const expBtn = document.getElementById('setting-export-json');
    if (expBtn) {
      expBtn.onclick = () => {
        const json = JSON.stringify(window.AppState.getData(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `study-tracker-backup-${window.AppState.getLocalTodayISO()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        window.AppUI.showToast(t('backupDownloaded'), 'success');
      };
    }

    const copyBtn = document.getElementById('setting-copy-json');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const json = JSON.stringify(window.AppState.getData(), null, 2);
        try {
          await navigator.clipboard.writeText(json);
          window.AppUI.showToast(t('jsonCopied'), 'success');
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = json;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          window.AppUI.showToast(t('jsonCopied'), 'success');
        }
      };
    }

    const fileInput = document.getElementById('setting-import-file');
    if (fileInput) {
      fileInput.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => restoreFromJSONString(ev.target.result, rerender);
        reader.readAsText(file);
      };
    }

    const pasteBtn = document.getElementById('setting-restore-paste');
    if (pasteBtn) {
      pasteBtn.onclick = () => {
        const raw = document.getElementById('setting-paste-json').value.trim();
        if (raw) restoreFromJSONString(raw, rerender);
      };
    }

    const demoBtn = document.getElementById('setting-load-demo');
    if (demoBtn) {
      demoBtn.onclick = () => {
        window.AppUI.confirmAction({
          title: t('loadDemo'),
          message: t('loadDemoMsg'),
          confirmText: t('loadDemoConfirm'),
          onConfirm: () => {
            window.AppState.loadDemoData();
            window.AppUI.showToast(t('demoLoaded'), 'success');
            rerender();
          }
        });
      };
    }

    const resetBtn = document.getElementById('setting-reset-all');
    if (resetBtn) {
      resetBtn.onclick = () => {
        window.AppUI.confirmAction({
          title: t('resetAll'),
          message: t('resetAllMsg'),
          confirmText: t('resetAllConfirm'),
          danger: true,
          onConfirm: () => {
            window.AppState.resetAll();
            window.AppUI.showToast(t('allCleared'), 'warning');
            rerender();
          }
        });
      };
    }
  }

  return {
    render,
    bindEvents
  };
})();
