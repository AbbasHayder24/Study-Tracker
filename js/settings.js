/**
 * settings.js — Settings tab: Language (EN/AR), Smart 1-Field Auto-Sync, notifications, start date, subjects, tags, backup
 */
window.SettingsModule = (function () {
  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
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

        <!-- Smart Cloud Auto-Sync -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('smartAutoSync')}</h3>
              ${window.AppUI.infoButtonHtml('info-sync-btn')}
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isConnected ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}">
              ${isConnected ? (lastTime ? t('syncedAt', { t: lastTime }) : t('connected')) : t('off')}
            </span>
          </div>

          <input id="sync-token-input" type="password" dir="ltr" value="${window.AppUI.escapeHtml(syncCfg.token)}" placeholder="${window.AppUI.escapeHtml(t('tokenPlaceholder'))}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono"/>

          <div class="grid grid-cols-2 gap-2">
            <button id="sync-connect-btn" type="button" class="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">
              ${isConnected ? t('syncNowBtn') : t('connectSyncBtn')}
            </button>
            ${isConnected ? `
              <button id="sync-disconnect-btn" type="button" class="py-2.5 px-3 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 text-xs font-bold">
                ${t('disconnect')}
              </button>
            ` : `
              <button id="sync-test-btn" type="button" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
                ${t('howItWorks')}
              </button>
            `}
          </div>
          ${syncStatus.lastError ? `<div class="text-[11px] text-rose-500">${window.AppUI.escapeHtml(syncStatus.lastError)}</div>` : ''}
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
          <div class="flex items-center gap-1.5">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('notifSoundTitle')}</h3>
            ${window.AppUI.infoButtonHtml('info-notif-btn')}
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button id="setting-toggle-sound" class="py-2.5 px-3 rounded-xl text-xs font-bold ${settings.soundEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}">
              ${settings.soundEnabled ? t('soundOn') : t('soundOff')}
            </button>
            <button id="setting-test-sound" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold">
              ${t('testChime')}
            </button>
          </div>
          <button id="setting-enable-notif" class="w-full py-2.5 px-3 rounded-xl text-xs font-bold ${notifGranted ? 'bg-emerald-600 text-white' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'}">
            ${notifGranted ? t('notifActive') : t('enableNotif')}
          </button>
          <div class="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2">
            <div class="text-[11px] font-bold text-slate-600 dark:text-slate-300">${t('pushSectionLabel')}</div>
            <div class="grid grid-cols-2 gap-2">
              <button id="setting-toggle-push" type="button" class="py-2.5 px-3 rounded-xl text-xs font-bold ${pushActive ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}">
                ${pushActive ? t('pushActiveBtn') : t('pushEnableBtn')}
              </button>
              <button id="setting-test-push" type="button" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold">
                ${t('pushTestBtn')}
              </button>
            </div>
          </div>
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
          <form id="setting-add-subject-form" class="flex gap-2 mb-3">
            <input id="setting-subj-name" type="text" required placeholder="${window.AppUI.escapeHtml(t('newSubjectPlaceholder'))}" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <input id="setting-subj-color" type="color" value="#6366f1" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer p-0.5 bg-transparent"/>
            <button type="submit" class="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${t('add')}</button>
          </form>
          <div class="flex flex-wrap gap-2">
            ${data.subjects.map(s => `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white" style="background:${window.AppUI.escapeHtml(s.color)}">
                ${window.AppUI.escapeHtml(s.name)}
                <button type="button" data-del-subject="${window.AppUI.escapeHtml(s.id)}" class="hover:opacity-75 font-bold ml-1">×</button>
              </span>
            `).join('')}
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center gap-1.5 mb-3">
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${t('customTagsTitle')}</h3>
            ${window.AppUI.infoButtonHtml('info-tags-btn')}
          </div>
          <form id="setting-add-tag-form" class="flex gap-2 mb-3">
            <input id="setting-tag-name" type="text" required placeholder="${window.AppUI.escapeHtml(t('newTagPlaceholder'))}" class="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <input id="setting-tag-color" type="color" value="#8b5cf6" class="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer p-0.5 bg-transparent"/>
            <button type="submit" class="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${t('add')}</button>
          </form>
          <div class="space-y-2">
            ${data.tags.map(tg => `
              <div class="flex items-center gap-2">
                <input type="color" data-tag-color="${window.AppUI.escapeHtml(tg.id)}" value="${window.AppUI.escapeHtml(tg.color)}" class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent shrink-0"/>
                <input type="text" data-tag-name="${window.AppUI.escapeHtml(tg.id)}" value="${window.AppUI.escapeHtml(tg.name)}" class="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
                ${tg.id !== 'study'
                  ? `<button type="button" data-del-tag="${window.AppUI.escapeHtml(tg.id)}" class="px-2 py-1 text-rose-500 text-xs font-bold" title="${window.AppUI.escapeHtml(t('delete'))}">✕</button>`
                  : `<span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold px-1">${t('coreBadge')}</span>`
                }
              </div>
            `).join('')}
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

    const infoSyncBtn = document.getElementById('info-sync-btn');
    if (infoSyncBtn) infoSyncBtn.onclick = showSyncInfo;

    const testSyncInfoBtn = document.getElementById('sync-test-btn');
    if (testSyncInfoBtn) testSyncInfoBtn.onclick = showSyncInfo;

    const connectBtn = document.getElementById('sync-connect-btn');
    if (connectBtn) {
      connectBtn.onclick = async () => {
        const token = document.getElementById('sync-token-input').value.trim();
        if (!token) {
          window.AppUI.showToast(t('pasteTokenFirst'), 'warning');
          return;
        }
        const existingCfg = window.AppState.getSyncConfig();
        const sameToken = existingCfg.token === token;
        window.AppState.setSyncConfig(token, sameToken ? existingCfg.gistId : '');
        window.AppUI.showToast(t('syncingToast'), 'info');
        await window.AppState.syncNow(false);
        rerender();
      };
    }

    const disconnectBtn = document.getElementById('sync-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.onclick = () => {
        window.AppState.clearSyncConfig();
        window.AppUI.showToast(t('syncDisconnected'), 'warning');
        rerender();
      };
    }

    const infoNotifBtn = document.getElementById('info-notif-btn');
    if (infoNotifBtn) {
      infoNotifBtn.onclick = () => {
        window.AppUI.showInfo(t('notifSoundTitle'), t('notifInfoBody'));
      };
    }

    const soundToggle = document.getElementById('setting-toggle-sound');
    if (soundToggle) {
      soundToggle.onclick = () => {
        const data = window.AppState.getData();
        data.settings.soundEnabled = !data.settings.soundEnabled;
        window.AppState.save();
        if (data.settings.soundEnabled) window.AppUI.playChime();
        rerender();
      };
    }

    const testSoundBtn = document.getElementById('setting-test-sound');
    if (testSoundBtn) {
      testSoundBtn.onclick = () => {
        window.AppUI.playChime();
        window.AppUI.showToast(t('chimePlayed'), 'info');
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

    const tagForm = document.getElementById('setting-add-tag-form');
    if (tagForm) {
      tagForm.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById('setting-tag-name').value.trim();
        const color = document.getElementById('setting-tag-color').value || '#8b5cf6';
        if (!name) return;
        window.AppState.getData().tags.push({
          id: 'tag_' + Date.now(),
          name,
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
