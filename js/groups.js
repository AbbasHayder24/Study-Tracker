/**
 * groups.js — Study Hall (القاعة) v69 — Clean YPT-Style Live Study Desks & Today/Week Leaderboard
 * Compatible with existing Firestore schema: groups/{groupId} & groups/{groupId}/members/{uid}
 */
window.GroupsModule = (function () {
  const CACHE_KEY = 'study_tracker_groups_cache_v1';
  const PENDING_JOIN_KEY = 'study_tracker_pending_join_code';
  const MAX_GROUPS = 3;
  const MAX_MEMBERS_PER_GROUP = 30;
  const MAX_GHOST_TIMER_MS = 6 * 3600 * 1000;
  const MAX_DAILY_MINUTES = 960;
  const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#e11d48', '#7c3aed', '#0d9488', '#d97706'];

  let groupMetaMap = {};
  let groupMembersMap = {};
  let groupFetchedAt = {};
  let activeUnsubMeta = null;
  let activeUnsubMembers = null;
  let activeListenedGroupId = null;
  let liveClockInterval = null;
  let leaderboardPeriod = 'today'; // 'today' | 'week'
  let presenceTimer = null;
  let lastPresenceSig = '';
  let lastRerenderFn = null;
  let isLoadingGroup = false;

  function isAr() {
    return !!(window.I18n && window.I18n.isRTL());
  }

  function escapeHtml(s) {
    return window.AppUI ? window.AppUI.escapeHtml(s) : String(s || '');
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        groupMetaMap = parsed.meta || {};
        groupMembersMap = parsed.members || {};
        groupFetchedAt = parsed.fetchedAt || {};
      }
    } catch (e) {}
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        meta: groupMetaMap,
        members: groupMembersMap,
        fetchedAt: groupFetchedAt
      }));
    } catch (e) {}
  }

  loadCache();

  function getSettings() {
    const data = window.AppState ? window.AppState.getData() : null;
    if (!data) return {};
    if (!data.settings) data.settings = {};
    if (!Array.isArray(data.settings.groupIds)) data.settings.groupIds = [];
    if (typeof data.settings.groupShowSubject !== 'boolean') data.settings.groupShowSubject = true;
    return data.settings;
  }

  function getJoinedGroupIds() {
    const st = getSettings();
    return Array.isArray(st.groupIds) ? st.groupIds.filter(Boolean).slice(0, MAX_GROUPS) : [];
  }

  function getActiveGroupId() {
    const ids = getJoinedGroupIds();
    if (!ids.length) return '';
    const st = getSettings();
    if (st.activeGroupId && ids.includes(st.activeGroupId)) return st.activeGroupId;
    st.activeGroupId = ids[0];
    return ids[0];
  }

  function setActiveGroupId(gid) {
    const st = getSettings();
    if (st.activeGroupId === gid) return;
    st.activeGroupId = gid;
    if (window.AppState) window.AppState.save(true);
  }

  function getWeekKey(isoDate) {
    const dt = window.AppState.parseLocalISO(isoDate);
    const dow = dt.getDay();
    const daysSinceSat = (dow + 1) % 7;
    dt.setDate(dt.getDate() - daysSinceSat);
    return window.AppState.getLocalTodayISO(dt);
  }

  function isVerifiedBook(b) {
    if (!b || !b.completed) return false;
    const mins = Number(b.minutes) || 0;
    if (mins < 5) return false;
    if (b.mode === 'pomodoro' && Number(b.durationSec) > 0 && Number(b.durationSec) <= 10) return false;
    return true;
  }

  function avatarColorFor(str) {
    const s = String(str || 'A');
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function avatarInitial(name) {
    const clean = String(name || 'S').trim();
    return clean ? Array.from(clean)[0].toUpperCase() : 'S';
  }

  function computeMyStatsPayload() {
    const data = window.AppState.getData();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const st = getSettings();
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);
    const todayTargetHrs = window.LedgerEngine ? window.LedgerEngine.getDailyTarget(todayISO) : 5.5;
    const dailyTargetMinutes = Math.max(30, Math.round(todayTargetHrs * 60));

    const verifiedBooks = (data.books || []).filter(isVerifiedBook);
    let todayMinutes = 0;
    let todayBooks = 0;
    let weekMinutes = 0;
    let totalMinutes = 0;
    const studyDaysSet = new Set();

    for (const b of verifiedBooks) {
      const m = Number(b.minutes) || 0;
      totalMinutes += m;
      if (b.date) {
        studyDaysSet.add(b.date);
        if (b.date === todayISO) {
          todayMinutes += m;
          todayBooks++;
        }
        if (getWeekKey(b.date) === weekKey) {
          weekMinutes += m;
        }
      }
    }

    let streak = 0;
    let cursor = todayISO;
    if (!studyDaysSet.has(cursor)) cursor = window.AppState.addDaysISO(todayISO, -1);
    while (studyDaysSet.has(cursor)) {
      streak++;
      cursor = window.AppState.addDaysISO(cursor, -1);
      if (streak > 999) break;
    }

    const timer = data.activeTimer || null;
    const isStudying = !!(timer && timer.isRunning);
    const isPaused = !!(isStudying && timer.isPaused);
    let currentLabel = '';
    if (isStudying && st.groupShowSubject !== false) {
      const subj = timer.selectedSubjectId && window.AppUI ? window.AppUI.getSubjectById(timer.selectedSubjectId) : null;
      const tag = timer.selectedTagId && window.AppUI ? window.AppUI.getTagById(timer.selectedTagId) : null;
      if (subj && subj.name) currentLabel = subj.name;
      else if (tag && tag.name) currentLabel = String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim() || tag.name;
    }

    const defaultName = (user && (user.displayName || (user.email ? user.email.split('@')[0] : ''))) || 'Student';
    const nickname = (st.groupNickname && String(st.groupNickname).trim()) || defaultName;

    return {
      uid: user ? user.uid : '',
      nickname: nickname.slice(0, 32),
      todayISO,
      todayMinutes: Math.min(MAX_DAILY_MINUTES, Math.round(todayMinutes)),
      dailyTargetMinutes,
      todayBooks,
      weekKey,
      weekMinutes: Math.min(MAX_DAILY_MINUTES * 7, Math.round(weekMinutes)),
      totalMinutes: Math.round(totalMinutes),
      streak,
      isStudying,
      isPaused,
      studyStartedAt: (isStudying && !isPaused && timer.startedAt) ? Number(timer.startedAt) : null,
      studyAccumulatedSec: isStudying ? (Number(timer.accumulatedSec) || 0) : 0,
      currentLabel: currentLabel.slice(0, 28),
      updatedAt: Date.now()
    };
  }

  function presenceSignature(p) {
    return JSON.stringify([
      p.nickname, p.todayISO, p.todayMinutes, p.dailyTargetMinutes, p.todayBooks,
      p.weekKey, p.weekMinutes, p.totalMinutes, p.streak,
      p.isStudying, p.isPaused, p.studyStartedAt, p.studyAccumulatedSec, p.currentLabel
    ]);
  }

  async function syncMyPresence(force = false) {
    if (!window.GoogleSync || !window.GoogleSync.getUser()) return;
    if (navigator.onLine === false) return;
    const ids = getJoinedGroupIds();
    if (!ids.length) return;

    const payload = computeMyStatsPayload();
    if (!payload.uid) return;
    const sig = presenceSignature(payload) + '|' + ids.join(',');
    if (!force && sig === lastPresenceSig) return;

    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) return;
      const db = ready.db;
      await Promise.all(ids.map((gid) =>
        db.collection('groups').doc(gid).collection('members').doc(ready.user.uid)
          .set(payload, { merge: true })
          .catch(() => {})
      ));
      lastPresenceSig = sig;
    } catch (e) {}
  }

  function schedulePresenceSync(immediate = false) {
    const ids = getJoinedGroupIds();
    if (!ids.length) return;
    if (!window.GoogleSync || !window.GoogleSync.getUser()) return;
    if (presenceTimer) clearTimeout(presenceTimer);
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      syncMyPresence(false);
    }, immediate ? 250 : 1500);
  }

  function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function isMemberActivelyStudying(m) {
    if (!m || !m.isStudying || m.isPaused || !m.studyStartedAt) return false;
    const elapsedMs = (Date.now() - Number(m.studyStartedAt)) + ((Number(m.studyAccumulatedSec) || 0) * 1000);
    if (elapsedMs < 0 || elapsedMs > MAX_GHOST_TIMER_MS) return false;
    return true;
  }

  function getMemberLiveElapsedSec(m) {
    if (!m || !m.isStudying) return 0;
    const acc = Number(m.studyAccumulatedSec) || 0;
    if (m.isPaused || !m.studyStartedAt) return acc;
    const delta = Math.max(0, Math.floor((Date.now() - Number(m.studyStartedAt)) / 1000));
    return Math.min(MAX_GHOST_TIMER_MS / 1000, acc + delta);
  }

  function formatClockHMS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function formatMinsShort(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (isAr()) {
      if (h > 0 && rem > 0) return `${h}س ${rem}د`;
      if (h > 0) return `${h}س`;
      return `${rem}د`;
    }
    if (h > 0 && rem > 0) return `${h}h ${rem}m`;
    if (h > 0) return `${h}h`;
    return `${rem}m`;
  }

  function getLiveStudyingCount() {
    const gid = getActiveGroupId();
    if (!gid || !Array.isArray(groupMembersMap[gid])) return 0;
    return groupMembersMap[gid].filter(isMemberActivelyStudying).length;
  }

  function startLiveClockTicker() {
    if (liveClockInterval) return;
    liveClockInterval = setInterval(() => {
      const gid = getActiveGroupId();
      const members = groupMembersMap[gid] || [];
      const byUid = new Map(members.map(m => [m.uid, m]));
      document.querySelectorAll('[data-live-member-clock]').forEach(el => {
        const uid = el.getAttribute('data-live-member-clock');
        const m = byUid.get(uid);
        if (m && isMemberActivelyStudying(m)) {
          el.textContent = formatClockHMS(getMemberLiveElapsedSec(m));
        }
      });
    }, 1000);
  }

  function stopLiveClockTicker() {
    if (liveClockInterval) {
      clearInterval(liveClockInterval);
      liveClockInterval = null;
    }
  }

  function detach() {
    if (activeUnsubMeta) { try { activeUnsubMeta(); } catch (e) {} activeUnsubMeta = null; }
    if (activeUnsubMembers) { try { activeUnsubMembers(); } catch (e) {} activeUnsubMembers = null; }
    activeListenedGroupId = null;
    stopLiveClockTicker();
  }

  async function attachLiveListener(rerender) {
    if (rerender) lastRerenderFn = rerender;
    const gid = getActiveGroupId();
    if (!gid || !window.GoogleSync || !window.GoogleSync.getUser()) {
      detach();
      return;
    }
    if (activeListenedGroupId === gid && activeUnsubMembers) {
      startLiveClockTicker();
      return;
    }

    detach();
    activeListenedGroupId = gid;
    isLoadingGroup = !groupMetaMap[gid];
    startLiveClockTicker();

    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        isLoadingGroup = false;
        return;
      }
      if (activeListenedGroupId !== gid) return;
      const db = ready.db;

      activeUnsubMeta = db.collection('groups').doc(gid).onSnapshot((doc) => {
        isLoadingGroup = false;
        if (!doc.exists) {
          removeGroupIdLocally(gid);
          if (lastRerenderFn) lastRerenderFn();
          return;
        }
        groupMetaMap[gid] = { id: gid, ...doc.data() };
        groupFetchedAt[gid] = Date.now();
        saveCache();
        if (lastRerenderFn) lastRerenderFn();
      }, () => {
        isLoadingGroup = false;
      });

      activeUnsubMembers = db.collection('groups').doc(gid).collection('members').onSnapshot((snap) => {
        const list = [];
        snap.forEach(d => list.push({ uid: d.id, ...d.data() }));
        groupMembersMap[gid] = list;
        groupFetchedAt[gid] = Date.now();
        saveCache();
        if (lastRerenderFn) lastRerenderFn();
      }, () => {});

      syncMyPresence(false);
    } catch (e) {
      isLoadingGroup = false;
    }
  }

  function addGroupIdLocally(gid) {
    const st = getSettings();
    const list = getJoinedGroupIds();
    if (!list.includes(gid)) list.push(gid);
    st.groupIds = list.slice(0, MAX_GROUPS);
    st.activeGroupId = gid;
    window.AppState.save(true);
  }

  function removeGroupIdLocally(gid) {
    const st = getSettings();
    st.groupIds = getJoinedGroupIds().filter(id => id !== gid);
    if (st.activeGroupId === gid) st.activeGroupId = st.groupIds[0] || '';
    delete groupMetaMap[gid];
    delete groupMembersMap[gid];
    saveCache();
    window.AppState.save(true);
    detach();
  }

  async function createGroup(nameInput) {
    const ar = isAr();
    const cleanName = String(nameInput || '').trim().slice(0, 36);
    if (!cleanName) {
      window.AppUI.showToast(ar ? 'اكتب اسم القاعة أولاً' : 'Enter a hall name first', 'error');
      return false;
    }
    if (getJoinedGroupIds().length >= MAX_GROUPS) {
      window.AppUI.showToast(ar ? `الحد الأقصى ${MAX_GROUPS} قاعات` : `Max ${MAX_GROUPS} halls reached`, 'error');
      return false;
    }

    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        window.AppUI.showToast(ar ? 'سجّل الدخول بحساب Google أولاً' : 'Sign in with Google first', 'error');
        return false;
      }
      const db = ready.db;
      let code = generateInviteCode();
      for (let i = 0; i < 4; i++) {
        const snap = await db.collection('groups').doc(code).get();
        if (!snap.exists) break;
        code = generateInviteCode();
      }

      const now = Date.now();
      const meta = {
        name: cleanName,
        code,
        ownerUid: ready.user.uid,
        createdAt: now,
        updatedAt: now
      };
      await db.collection('groups').doc(code).set(meta);
      const myPayload = computeMyStatsPayload();
      await db.collection('groups').doc(code).collection('members').doc(ready.user.uid).set(myPayload);

      groupMetaMap[code] = { id: code, ...meta };
      groupMembersMap[code] = [myPayload];
      saveCache();
      addGroupIdLocally(code);
      window.AppUI.showToast(ar ? `تم إنشاء «${cleanName}» 🎉` : `Created "${cleanName}" 🎉`, 'success');
      return true;
    } catch (err) {
      window.AppUI.showToast(ar ? 'تعذر إنشاء القاعة — تحقق من قواعد Firestore' : 'Failed to create hall — check Firestore rules', 'error');
      return false;
    }
  }

  async function joinGroupByCode(rawCode) {
    const ar = isAr();
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      window.AppUI.showToast(ar ? 'أدخل رمز دعوة صحيح' : 'Enter a valid invite code', 'error');
      return false;
    }
    if (getJoinedGroupIds().includes(code)) {
      setActiveGroupId(code);
      window.AppUI.showToast(ar ? 'أنت عضو في هذه القاعة بالفعل' : 'Already in this hall', 'info');
      return true;
    }
    if (getJoinedGroupIds().length >= MAX_GROUPS) {
      window.AppUI.showToast(ar ? `الحد الأقصى ${MAX_GROUPS} قاعات` : `Max ${MAX_GROUPS} halls reached`, 'error');
      return false;
    }

    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        window.AppUI.showToast(ar ? 'سجّل الدخول بحساب Google أولاً' : 'Sign in with Google first', 'error');
        return false;
      }
      const db = ready.db;
      const gDoc = await db.collection('groups').doc(code).get();
      if (!gDoc.exists) {
        window.AppUI.showToast(ar ? 'لم يتم العثور على قاعة بهذا الرمز' : 'No hall found with that code', 'error');
        return false;
      }
      const membersSnap = await db.collection('groups').doc(code).collection('members').get();
      if (membersSnap.size >= MAX_MEMBERS_PER_GROUP) {
        window.AppUI.showToast(ar ? 'القاعة ممتلئة حالياً' : 'This hall is currently full', 'error');
        return false;
      }

      const myPayload = computeMyStatsPayload();
      await db.collection('groups').doc(code).collection('members').doc(ready.user.uid).set(myPayload, { merge: true });

      groupMetaMap[code] = { id: code, ...gDoc.data() };
      const members = [];
      membersSnap.forEach(d => members.push({ uid: d.id, ...d.data() }));
      if (!members.some(m => m.uid === myPayload.uid)) members.push(myPayload);
      groupMembersMap[code] = members;
      saveCache();
      addGroupIdLocally(code);
      window.AppUI.showToast(ar ? `انضممت إلى «${groupMetaMap[code].name}» 🎉` : `Joined "${groupMetaMap[code].name}" 🎉`, 'success');
      return true;
    } catch (err) {
      window.AppUI.showToast(ar ? 'تعذر الانضمام — تحقق من الاتصال أو الصلاحيات' : 'Failed to join — check connection or rules', 'error');
      return false;
    }
  }

  async function leaveGroup(gid) {
    const ar = isAr();
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (ready && ready.db && ready.user) {
        await ready.db.collection('groups').doc(gid).collection('members').doc(ready.user.uid).delete().catch(() => {});
      }
    } catch (e) {}
    removeGroupIdLocally(gid);
    window.AppUI.showToast(ar ? 'غادرت القاعة' : 'Left the hall', 'info');
  }

  async function deleteGroup(gid) {
    const ar = isAr();
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (ready && ready.db && ready.user) {
        const mems = await ready.db.collection('groups').doc(gid).collection('members').get();
        await Promise.all(mems.docs.map(d => d.ref.delete().catch(() => {})));
        await ready.db.collection('groups').doc(gid).delete();
      }
      removeGroupIdLocally(gid);
      window.AppUI.showToast(ar ? 'تم حذف القاعة' : 'Hall deleted', 'info');
    } catch (e) {
      window.AppUI.showToast(ar ? 'تعذر حذف القاعة' : 'Could not delete hall', 'error');
    }
  }

  function copyInviteLink(code) {
    const ar = isAr();
    const url = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(code)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        window.AppUI.showToast(ar ? `تم نسخ رابط الدعوة (${code}) 🔗` : `Invite link copied (${code}) 🔗`, 'success');
      }).catch(() => {
        window.AppUI.showToast(`${ar ? 'الرمز:' : 'Code:'} ${code}`, 'info');
      });
    } else {
      window.AppUI.showToast(`${ar ? 'الرمز:' : 'Code:'} ${code}`, 'info');
    }
  }

  function checkJoinLink() {
    try {
      const params = new URLSearchParams(window.location.search);
      const joinCode = (params.get('join') || '').trim().toUpperCase();
      if (joinCode) {
        sessionStorage.setItem(PENDING_JOIN_KEY, joinCode);
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
        if (window.AppState) window.AppState.setActiveTab('hall');
      }
    } catch (e) {}
  }

  async function consumePendingJoinCode(rerender) {
    let pending = '';
    try { pending = sessionStorage.getItem(PENDING_JOIN_KEY) || ''; } catch (e) {}
    if (!pending) return;
    if (!window.GoogleSync || !window.GoogleSync.getUser()) return;
    try { sessionStorage.removeItem(PENDING_JOIN_KEY); } catch (e) {}
    const ok = await joinGroupByCode(pending);
    if (ok && rerender) rerender();
  }

  function openCreateModal(rerender) {
    const ar = isAr();
    window.AppUI.openModal({
      title: ar ? '🏛️ إنشاء قاعة دراسة' : '🏛️ Create Study Hall',
      bodyHtml: `
        <div class="space-y-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">${ar ? 'اسم القاعة' : 'Hall Name'}</label>
          <input id="hall-create-name" type="text" maxlength="36" placeholder="${ar ? 'مثال: قاعة الطب، تحدي USMLE...' : 'e.g. Med School Hall, USMLE Prep...'}" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="hall-create-submit" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'إنشاء' : 'Create'}</button>
      `
    });
    const btn = document.getElementById('hall-create-submit');
    if (btn) {
      btn.onclick = async () => {
        const val = (document.getElementById('hall-create-name').value || '').trim();
        btn.disabled = true;
        const ok = await createGroup(val);
        btn.disabled = false;
        if (ok) {
          window.AppUI.closeModal();
          if (rerender) rerender();
        }
      };
    }
  }

  function openJoinModal(rerender) {
    const ar = isAr();
    window.AppUI.openModal({
      title: ar ? '🔑 الانضمام لقاعة بكود' : '🔑 Join Hall by Code',
      bodyHtml: `
        <div class="space-y-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">${ar ? 'رمز الدعوة (6 أحرف)' : 'Invite Code (6 chars)'}</label>
          <input id="hall-join-code" type="text" maxlength="10" placeholder="ABC123" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm uppercase tracking-widest text-center font-bold"/>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="hall-join-submit" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'انضمام' : 'Join'}</button>
      `
    });
    const btn = document.getElementById('hall-join-submit');
    if (btn) {
      btn.onclick = async () => {
        const val = (document.getElementById('hall-join-code').value || '').trim();
        btn.disabled = true;
        const ok = await joinGroupByCode(val);
        btn.disabled = false;
        if (ok) {
          window.AppUI.closeModal();
          if (rerender) rerender();
        }
      };
    }
  }

  function openGroupSettingsModal(gid, meta, rerender) {
    const ar = isAr();
    const st = getSettings();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const isOwner = !!(user && meta && meta.ownerUid === user.uid);
    const curNick = st.groupNickname || (user && (user.displayName || (user.email ? user.email.split('@')[0] : ''))) || '';
    const showSubj = st.groupShowSubject !== false;

    window.AppUI.openModal({
      title: ar ? '⚙️ إعدادات القاعة' : '⚙️ Hall Settings',
      bodyHtml: `
        <div class="space-y-3.5">
          <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div>
              <div class="text-[10px] text-slate-400">${ar ? 'رمز الدعوة' : 'Invite Code'}</div>
              <div class="text-sm font-extrabold tracking-widest text-indigo-600 dark:text-indigo-400">${escapeHtml(gid)}</div>
            </div>
            <button id="hall-modal-copy" type="button" class="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
              ${ar ? '🔗 نسخ الرابط' : '🔗 Copy Link'}
            </button>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'اسمك الظاهر في القاعة' : 'Display Nickname'}</label>
            <input id="hall-set-nick" type="text" maxlength="32" value="${escapeHtml(curNick)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
          </div>
          <label class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 cursor-pointer">
            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${ar ? 'إظهار اسم المادة أثناء الدراسة' : 'Show subject while studying'}</span>
            <input id="hall-set-show-subj" type="checkbox" ${showSubj ? 'checked' : ''} class="w-4 h-4"/>
          </label>
        </div>
      `,
      footerHtml: `
        ${isOwner
          ? `<button id="grp-delete-btn" type="button" class="me-auto px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">${ar ? 'حذف القاعة' : 'Delete Hall'}</button>`
          : `<button id="grp-leave-btn" type="button" class="me-auto px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">${ar ? 'مغادرة' : 'Leave'}</button>`
        }
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="hall-set-save" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'حفظ' : 'Save'}</button>
      `
    });

    const copyBtn = document.getElementById('hall-modal-copy');
    if (copyBtn) copyBtn.onclick = () => copyInviteLink(gid);

    const saveBtn = document.getElementById('hall-set-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const nick = (document.getElementById('hall-set-nick').value || '').trim().slice(0, 32);
        const show = !!document.getElementById('hall-set-show-subj').checked;
        st.groupNickname = nick;
        st.groupShowSubject = show;
        window.AppState.save(true);
        syncMyPresence(true);
        window.AppUI.closeModal();
        window.AppUI.showToast(ar ? 'تم الحفظ ✓' : 'Saved ✓', 'success');
        if (rerender) rerender();
      };
    }

    const leaveBtn = document.getElementById('grp-leave-btn');
    if (leaveBtn) {
      leaveBtn.onclick = async () => {
        window.AppUI.closeModal();
        await leaveGroup(gid);
        if (rerender) rerender();
      };
    }

    const delBtn = document.getElementById('grp-delete-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!confirm(ar ? 'حذف هذه القاعة نهائياً للجميع؟' : 'Delete this hall for everyone?')) return;
        window.AppUI.closeModal();
        await deleteGroup(gid);
        if (rerender) rerender();
      };
    }
  }

  function render() {
    const ar = isAr();
    const user = window.GoogleSync && window.GoogleSync.getUser();

    if (!user) {
      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 text-center space-y-3">
          <div class="text-3xl">🏛️</div>
          <h2 class="text-base font-extrabold text-slate-800 dark:text-slate-100">${ar ? 'قاعة الدراسة الجماعية' : 'Study Hall'}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            ${ar ? 'ادرس مع أصدقائك بشكل حي وشاهد من يركز الآن وترتيب ساعات اليوم.' : 'Study live with friends, see who is focusing now, and compare daily hours.'}
          </p>
          <button id="hall-signin-btn" type="button" class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold">
            ${ar ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google'}
          </button>
        </div>
      `;
    }

    const groupIds = getJoinedGroupIds();
    const gid = getActiveGroupId();

    if (!groupIds.length || !gid) {
      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 text-center space-y-4">
          <div class="text-3xl">🏛️</div>
          <div class="space-y-1">
            <h2 class="text-base font-extrabold text-slate-800 dark:text-slate-100">${ar ? 'ابدأ قاعة دراستك' : 'Start Your Study Hall'}</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              ${ar ? 'أنشئ قاعة خاصة وشارك رابطها، أو انضم لقاعة أصدقائك برمز الدعوة.' : 'Create a private hall to share, or join friends with an invite code.'}
            </p>
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <button id="hall-open-create" type="button" class="py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">
              ${ar ? '+ إنشاء قاعة' : '+ Create Hall'}
            </button>
            <button id="hall-open-join" type="button" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
              ${ar ? '🔑 انضمام بكود' : '🔑 Join Code'}
            </button>
          </div>
        </div>
      `;
    }

    const meta = groupMetaMap[gid] || { name: gid, code: gid };
    const rawMembers = Array.isArray(groupMembersMap[gid]) ? groupMembersMap[gid] : [];
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);

    const members = rawMembers.map(m => {
      const studying = isMemberActivelyStudying(m);
      const paused = !!(m.isStudying && m.isPaused);
      const liveExtraMin = studying ? Math.floor(getMemberLiveElapsedSec(m) / 60) : 0;
      const baseToday = m.todayISO === todayISO ? (Number(m.todayMinutes) || 0) : 0;
      const baseWeek = m.weekKey === weekKey ? (Number(m.weekMinutes) || 0) : 0;
      return {
        ...m,
        _studying: studying,
        _paused: paused,
        _liveSec: studying ? getMemberLiveElapsedSec(m) : 0,
        _todayMins: Math.min(MAX_DAILY_MINUTES, baseToday + liveExtraMin),
        _weekMins: Math.min(MAX_DAILY_MINUTES * 7, baseWeek + liveExtraMin)
      };
    });

    const liveCount = members.filter(m => m._studying).length;
    const deskSorted = [...members].sort((a, b) => {
      const rankA = a._studying ? 2 : (a._paused ? 1 : 0);
      const rankB = b._studying ? 2 : (b._paused ? 1 : 0);
      if (rankB !== rankA) return rankB - rankA;
      return b._todayMins - a._todayMins;
    });

    const lbKey = leaderboardPeriod === 'week' ? '_weekMins' : '_todayMins';
    const lbSorted = [...members].sort((a, b) => b[lbKey] - a[lbKey]);
    const topMins = Math.max(1, lbSorted.length ? lbSorted[0][lbKey] : 1);

    const data = window.AppState.getData();
    const amStudying = !!(data && data.activeTimer && data.activeTimer.isRunning);

    const switcherHtml = groupIds.length > 1 ? `
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
        ${groupIds.map(id => {
          const nm = (groupMetaMap[id] && groupMetaMap[id].name) || id;
          const act = id === gid;
          return `<button type="button" data-hall-switch="${escapeHtml(id)}" class="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 ${act ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">${escapeHtml(nm)}</button>`;
        }).join('')}
      </div>
    ` : '';

    return `
      <div class="space-y-4">
        ${switcherHtml}

        <!-- Clean Hall Header Card -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(meta.name || gid)}</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${liveCount > 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}">
                  ${liveCount > 0 ? (ar ? `● ${liveCount} يدرسون` : `● ${liveCount} live`) : (ar ? `${members.length} أعضاء` : `${members.length} members`)}
                </span>
              </div>
              <div class="text-[11px] text-slate-400 mt-0.5">${ar ? 'الرمز:' : 'Code:'} <span class="font-bold tracking-wider text-slate-600 dark:text-slate-300">${escapeHtml(gid)}</span></div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button id="hall-copy-link" type="button" class="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm" title="${ar ? 'نسخ رابط الدعوة' : 'Copy invite link'}">🔗</button>
              ${groupIds.length < MAX_GROUPS ? `<button id="hall-add-more" type="button" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm font-bold" title="${ar ? 'إنشاء أو انضمام' : 'Create or join'}">+</button>` : ''}
              <button id="hall-settings-btn" type="button" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm" title="${ar ? 'إعدادات القاعة' : 'Hall settings'}">⚙️</button>
            </div>
          </div>
        </div>

        <!-- YPT-Style Live Study Desks Grid -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '📚 مقاعد الدراسة الحية' : '📚 Live Study Desks'}</h3>
            ${!amStudying ? `<button id="hall-start-focus" type="button" class="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold">${ar ? '▶ ابدأ التركيز' : '▶ Start Focus'}</button>` : ''}
          </div>
          ${isLoadingGroup && !deskSorted.length ? `
            <div class="py-6 text-center text-xs text-slate-400">...</div>
          ` : `
            <div class="grid grid-cols-2 gap-2.5">
              ${deskSorted.map(m => {
                const isMe = user && m.uid === user.uid;
                const col = avatarColorFor(m.nickname || m.uid);
                const stateCls = m._studying ? 'hall-desk-live' : (m._paused ? 'hall-desk-paused' : 'hall-desk-idle');
                const clockTxt = m._studying
                  ? formatClockHMS(m._liveSec)
                  : (m._paused ? (ar ? '⏸ متوقف' : '⏸ Paused') : formatMinsShort(m._todayMins));
                return `
                  <div class="hall-desk-card ${stateCls}">
                    <div class="flex items-center gap-2 min-w-0">
                      <div class="hall-avatar-ring ${m._studying ? 'is-live' : ''}">
                        <div class="hall-avatar" style="background:${col}">${escapeHtml(avatarInitial(m.nickname))}</div>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          ${escapeHtml(m.nickname || 'Student')}${isMe ? ` <span class="text-[9px] text-indigo-500">(${ar ? 'أنت' : 'You'})</span>` : ''}
                        </div>
                        <div class="text-[10px] truncate ${m._studying ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400'}">
                          ${m._studying
                            ? (m.currentLabel ? escapeHtml(m.currentLabel) : (ar ? 'يدرس الآن' : 'Studying now'))
                            : (m._paused ? (ar ? 'استراحة قصيرة' : 'Short pause') : (ar ? 'إجمالي اليوم' : 'Today total'))}
                        </div>
                      </div>
                    </div>
                    <div class="mt-2.5 flex items-baseline justify-between">
                      <span ${m._studying ? `data-live-member-clock="${escapeHtml(m.uid)}"` : ''} class="text-sm font-extrabold tabular-nums ${m._studying ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}">
                        ${clockTxt}
                      </span>
                      ${m.streak > 0 ? `<span class="text-[10px] text-amber-500 font-bold">🔥${m.streak}</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- Clean Segmented Leaderboard (Today / Week) -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '🏆 لوحة الترتيب' : '🏆 Leaderboard'}</h3>
            <div class="flex items-center gap-1 p-0.5 rounded-xl bg-slate-100 dark:bg-slate-900/60">
              <button type="button" data-lb-period="today" class="px-2.5 py-1 rounded-lg text-[11px] font-bold ${leaderboardPeriod === 'today' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">${ar ? 'اليوم' : 'Today'}</button>
              <button type="button" data-lb-period="week" class="px-2.5 py-1 rounded-lg text-[11px] font-bold ${leaderboardPeriod === 'week' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">${ar ? 'الأسبوع' : 'Week'}</button>
            </div>
          </div>
          <div class="space-y-2.5">
            ${lbSorted.map((m, idx) => {
              const mins = m[lbKey];
              const pct = Math.min(100, Math.round((mins / topMins) * 100));
              const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
              const isMe = user && m.uid === user.uid;
              return `
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-xs gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="w-6 text-center font-extrabold text-[11px] text-slate-500">${medal}</span>
                      <span class="font-bold truncate ${isMe ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-100'}">${escapeHtml(m.nickname || 'Student')}</span>
                    </div>
                    <span class="font-extrabold tabular-nums text-slate-700 dark:text-slate-200 shrink-0">${formatMinsShort(mins)}</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700/70 overflow-hidden">
                    <div class="h-full rounded-full ${isMe ? 'bg-indigo-600' : 'bg-emerald-500'}" style="width:${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function bindEvents(rerender) {
    lastRerenderFn = rerender;
    const ar = isAr();

    const signInBtn = document.getElementById('hall-signin-btn');
    if (signInBtn) {
      signInBtn.onclick = async () => {
        if (window.GoogleSync && window.GoogleSync.signIn) {
          await window.GoogleSync.signIn();
          if (rerender) rerender();
        }
      };
    }

    const createBtn = document.getElementById('hall-open-create');
    if (createBtn) createBtn.onclick = () => openCreateModal(rerender);

    const joinBtn = document.getElementById('hall-open-join');
    if (joinBtn) joinBtn.onclick = () => openJoinModal(rerender);

    const addMoreBtn = document.getElementById('hall-add-more');
    if (addMoreBtn) {
      addMoreBtn.onclick = () => {
        window.AppUI.openModal({
          title: ar ? '🏛️ إضافة قاعة' : '🏛️ Add Study Hall',
          bodyHtml: `
            <div class="grid grid-cols-2 gap-2.5">
              <button id="hall-pick-create" type="button" class="py-3 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? '+ إنشاء قاعة' : '+ Create Hall'}</button>
              <button id="hall-pick-join" type="button" class="py-3 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">${ar ? '🔑 انضمام بكود' : '🔑 Join Code'}</button>
            </div>
          `,
          footerHtml: `<button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إغلاق' : 'Close'}</button>`
        });
        const c = document.getElementById('hall-pick-create');
        if (c) c.onclick = () => openCreateModal(rerender);
        const j = document.getElementById('hall-pick-join');
        if (j) j.onclick = () => openJoinModal(rerender);
      };
    }

    const gid = getActiveGroupId();
    const copyBtn = document.getElementById('hall-copy-link');
    if (copyBtn && gid) copyBtn.onclick = () => copyInviteLink(gid);

    const settingsBtn = document.getElementById('hall-settings-btn');
    if (settingsBtn && gid) {
      settingsBtn.onclick = () => openGroupSettingsModal(gid, groupMetaMap[gid], rerender);
    }

    const startFocusBtn = document.getElementById('hall-start-focus');
    if (startFocusBtn) {
      startFocusBtn.onclick = () => {
        if (window.StudyApp && window.StudyApp.switchTab) window.StudyApp.switchTab('focus');
        else if (window.AppState) {
          window.AppState.setActiveTab('focus');
          if (rerender) rerender();
        }
      };
    }

    document.querySelectorAll('[data-hall-switch]').forEach(btn => {
      btn.onclick = () => {
        const nextId = btn.getAttribute('data-hall-switch');
        if (nextId && nextId !== getActiveGroupId()) {
          setActiveGroupId(nextId);
          detach();
          if (rerender) rerender();
        }
      };
    });

    document.querySelectorAll('[data-lb-period]').forEach(btn => {
      btn.onclick = () => {
        const p = btn.getAttribute('data-lb-period');
        if (p && p !== leaderboardPeriod) {
          leaderboardPeriod = p;
          if (rerender) rerender();
        }
      };
    });

    attachLiveListener(rerender);
    consumePendingJoinCode(rerender);
  }

  function onAuthReady() {
    syncMyPresence(false);
    if (lastRerenderFn && window.AppState && window.AppState.getActiveTab() === 'hall') {
      consumePendingJoinCode(lastRerenderFn);
    }
  }

  function onSignOut() {
    detach();
    lastPresenceSig = '';
  }

  return {
    render,
    bindEvents,
    detach,
    attachLiveListener,
    schedulePresenceSync,
    syncMyPresence,
    getLiveStudyingCount,
    checkJoinLink,
    onAuthReady,
    onSignOut
  };
})();
