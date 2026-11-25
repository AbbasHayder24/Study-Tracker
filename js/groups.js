/**
 * groups.js — YPT-Style Study Groups & Leaderboard via Firebase Firestore
 * Features: Live Study Room with local ticking clocks, Today/Week/Total leaderboard,
 * shared weekly group goal, verified timer-only hours + ghost-timer protection,
 * multi-group switcher (up to 3), nickname & subject privacy, deep-link invites (?join=CODE),
 * owner admin controls, offline cache, and quota-friendly onSnapshot lifecycle.
 */
window.GroupsModule = (function () {
  const CACHE_KEY = 'study_tracker_groups_cache_v1';
  const PENDING_JOIN_KEY = 'study_tracker_pending_join_code';
  const MAX_GROUPS = 3;
  const MAX_MEMBERS_PER_GROUP = 30;
  const MAX_GHOST_TIMER_MS = 6 * 3600 * 1000; // 6 hours max (matches FocusModule)
  const MAX_DAILY_MINUTES = 960; // 16 hours/day anti-cheat cap

  let groupMetaMap = {};      // { [groupId]: metaObj }
  let groupMembersMap = {};   // { [groupId]: memberObj[] }
  let groupFetchedAt = {};    // { [groupId]: timestamp }
  let activeUnsubMeta = null;
  let activeUnsubMembers = null;
  let activeListenedGroupId = null;
  let liveClockInterval = null;
  let leaderboardPeriod = 'today'; // 'today' | 'week' | 'total'
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

  // Load cached groups from localStorage for instant offline display
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

  // Saturday-start week key (YYYY-MM-DD of Saturday) matching the app's Challenge week
  function getWeekKey(isoDate) {
    const dt = window.AppState.parseLocalISO(isoDate);
    const dow = dt.getDay(); // 0=Sun..6=Sat
    const daysSinceSat = (dow + 1) % 7;
    dt.setDate(dt.getDate() - daysSinceSat);
    return window.AppState.getLocalTodayISO(dt);
  }

  function isVerifiedBook(b) {
    if (!b || !b.completed) return false;
    const mins = Number(b.minutes) || 0;
    if (mins < 5) return false;
    // Exclude 5-second quick-test pomodoro books
    if (b.mode === 'pomodoro' && Number(b.durationSec) > 0 && Number(b.durationSec) <= 10) return false;
    return true;
  }

  function computeMyStatsPayload() {
    const data = window.AppState.getData();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const st = getSettings();
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);

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

    // Calculate verified study streak
    let streak = 0;
    let cursor = todayISO;
    if (!studyDaysSet.has(cursor)) {
      cursor = window.AppState.addDaysISO(todayISO, -1);
    }
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
      if (subj && subj.name) {
        currentLabel = subj.name;
      } else if (tag && tag.name) {
        currentLabel = String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim() || tag.name;
      }
    }

    const defaultName = (user && (user.displayName || (user.email ? user.email.split('@')[0] : ''))) || 'Student';
    const nickname = (st.groupNickname && String(st.groupNickname).trim()) || defaultName;

    return {
      uid: user ? user.uid : '',
      nickname: nickname.slice(0, 32),
      todayISO,
      todayMinutes: Math.min(MAX_DAILY_MINUTES, Math.round(todayMinutes)),
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
      p.nickname, p.todayISO, p.todayMinutes, p.todayBooks,
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
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
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
      const nodes = document.querySelectorAll('[data-live-member-clock]');
      if (!nodes.length) return;
      nodes.forEach(el => {
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
    if (activeUnsubMeta) {
      try { activeUnsubMeta(); } catch (e) {}
      activeUnsubMeta = null;
    }
    if (activeUnsubMembers) {
      try { activeUnsubMembers(); } catch (e) {}
      activeUnsubMembers = null;
    }
    activeListenedGroupId = null;
    stopLiveClockTicker();
  }

  async function attachLiveListener(rerender) {
    lastRerenderFn = rerender || lastRerenderFn;
    const gid = getActiveGroupId();
    if (!gid) {
      detach();
      return;
    }
    if (!window.GoogleSync || !window.GoogleSync.getUser()) return;
    if (navigator.onLine === false) return;
    if (activeListenedGroupId === gid && activeUnsubMembers) {
      startLiveClockTicker();
      return;
    }

    detach();
    activeListenedGroupId = gid;
    isLoadingGroup = !groupMetaMap[gid];

    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        isLoadingGroup = false;
        return;
      }
      if (activeListenedGroupId !== gid) return;
      const db = ready.db;

      const groupRef = db.collection('groups').doc(gid);
      activeUnsubMeta = groupRef.onSnapshot((snap) => {
        if (!snap.exists) {
          // Group was deleted by owner — remove locally
          const st = getSettings();
          st.groupIds = (st.groupIds || []).filter(id => id !== gid);
          if (st.activeGroupId === gid) st.activeGroupId = st.groupIds[0] || '';
          delete groupMetaMap[gid];
          delete groupMembersMap[gid];
          saveCache();
          window.AppState.save(true);
          detach();
          if (lastRerenderFn) lastRerenderFn();
          return;
        }
        groupMetaMap[gid] = { id: snap.id, ...snap.data() };
        groupFetchedAt[gid] = Date.now();
        isLoadingGroup = false;
        saveCache();
        if (lastRerenderFn) lastRerenderFn();
      }, () => {
        isLoadingGroup = false;
      });

      activeUnsubMembers = groupRef.collection('members').onSnapshot((qSnap) => {
        const list = [];
        qSnap.forEach(doc => {
          list.push({ uid: doc.id, ...doc.data() });
        });
        groupMembersMap[gid] = list;
        groupFetchedAt[gid] = Date.now();
        isLoadingGroup = false;
        saveCache();

        // Check if current user was removed by owner
        const myUid = ready.user.uid;
        if (list.length > 0 && !list.some(m => m.uid === myUid)) {
          // Re-check meta: if owner removed us, leave cleanly
          if (groupMetaMap[gid] && groupMetaMap[gid].ownerUid !== myUid) {
            const st = getSettings();
            st.groupIds = (st.groupIds || []).filter(id => id !== gid);
            if (st.activeGroupId === gid) st.activeGroupId = st.groupIds[0] || '';
            window.AppState.save(true);
            detach();
          }
        }

        startLiveClockTicker();
        if (lastRerenderFn) lastRerenderFn();
      }, () => {
        isLoadingGroup = false;
      });

      // Push fresh presence when entering group view
      syncMyPresence(false);
    } catch (e) {
      isLoadingGroup = false;
    }
  }

  async function createGroup(name, weeklyGoalHours) {
    const ar = isAr();
    const cleanName = String(name || '').trim().slice(0, 40);
    if (!cleanName) return { ok: false, error: ar ? 'أدخل اسم المجموعة' : 'Enter a group name' };
    if (getJoinedGroupIds().length >= MAX_GROUPS) {
      return { ok: false, error: ar ? `الحد الأقصى ${MAX_GROUPS} مجموعات` : `Maximum ${MAX_GROUPS} groups allowed` };
    }
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        return { ok: false, error: ar ? 'سجّل الدخول بحساب Google أولاً' : 'Sign in with Google first' };
      }
      const db = ready.db;
      const code = generateInviteCode();
      const goal = Math.max(5, Math.min(2000, Math.round(Number(weeklyGoalHours) || 100)));
      const docRef = db.collection('groups').doc();
      const meta = {
        name: cleanName,
        code,
        ownerUid: ready.user.uid,
        weeklyGoalHours: goal,
        locked: false,
        createdAt: Date.now()
      };
      await docRef.set(meta);
      const myPayload = computeMyStatsPayload();
      await docRef.collection('members').doc(ready.user.uid).set(myPayload);

      const st = getSettings();
      st.groupIds = Array.from(new Set([...(st.groupIds || []), docRef.id])).slice(0, MAX_GROUPS);
      st.activeGroupId = docRef.id;
      groupMetaMap[docRef.id] = { id: docRef.id, ...meta };
      groupMembersMap[docRef.id] = [myPayload];
      groupFetchedAt[docRef.id] = Date.now();
      saveCache();
      window.AppState.save(true, true);
      return { ok: true, groupId: docRef.id, code };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : (ar ? 'تعذر إنشاء المجموعة' : 'Failed to create group') };
    }
  }

  async function joinGroupByCode(rawCode) {
    const ar = isAr();
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      return { ok: false, error: ar ? 'أدخل رمز دعوة صحيحاً' : 'Enter a valid invite code' };
    }
    if (getJoinedGroupIds().length >= MAX_GROUPS) {
      return { ok: false, error: ar ? `الحد الأقصى ${MAX_GROUPS} مجموعات` : `Maximum ${MAX_GROUPS} groups allowed` };
    }
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db || !ready.user) {
        return { ok: false, error: ar ? 'سجّل الدخول بحساب Google أولاً' : 'Sign in with Google first' };
      }
      const db = ready.db;
      const qSnap = await db.collection('groups').where('code', '==', code).limit(1).get();
      if (qSnap.empty) {
        return { ok: false, error: ar ? 'لم يتم العثور على مجموعة بهذا الرمز' : 'No group found with that code' };
      }
      const gDoc = qSnap.docs[0];
      const gData = gDoc.data() || {};
      if (gData.locked && gData.ownerUid !== ready.user.uid) {
        return { ok: false, error: ar ? 'الانضمام لهذه المجموعة مغلق حالياً' : 'This group is currently locked' };
      }

      const memSnap = await gDoc.ref.collection('members').get();
      const alreadyIn = memSnap.docs.some(d => d.id === ready.user.uid);
      if (!alreadyIn && memSnap.size >= MAX_MEMBERS_PER_GROUP) {
        return { ok: false, error: ar ? 'المجموعة ممتلئة (الحد الأقصى 30 عضواً)' : 'Group is full (max 30 members)' };
      }

      const myPayload = computeMyStatsPayload();
      await gDoc.ref.collection('members').doc(ready.user.uid).set(myPayload, { merge: true });

      const st = getSettings();
      st.groupIds = Array.from(new Set([...(st.groupIds || []), gDoc.id])).slice(0, MAX_GROUPS);
      st.activeGroupId = gDoc.id;
      groupMetaMap[gDoc.id] = { id: gDoc.id, ...gData };
      saveCache();
      window.AppState.save(true, true);
      return { ok: true, groupId: gDoc.id, name: gData.name || '' };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : (ar ? 'تعذر الانضمام للمجموعة' : 'Failed to join group') };
    }
  }

  async function leaveGroup(gid) {
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (ready && ready.db && ready.user) {
        await ready.db.collection('groups').doc(gid).collection('members').doc(ready.user.uid).delete().catch(() => {});
      }
    } catch (e) {}
    const st = getSettings();
    st.groupIds = (st.groupIds || []).filter(id => id !== gid);
    if (st.activeGroupId === gid) st.activeGroupId = st.groupIds[0] || '';
    delete groupMetaMap[gid];
    delete groupMembersMap[gid];
    saveCache();
    detach();
    window.AppState.save(true, true);
  }

  async function deleteGroup(gid) {
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (ready && ready.db && ready.user) {
        const ref = ready.db.collection('groups').doc(gid);
        const mems = await ref.collection('members').get();
        await Promise.all(mems.docs.map(d => d.ref.delete().catch(() => {})));
        await ref.delete();
      }
    } catch (e) {}
    await leaveGroup(gid);
  }

  async function removeMember(gid, targetUid) {
    try {
      const ready = await window.GoogleSync.ensureReady();
      if (!ready || !ready.db) return false;
      await ready.db.collection('groups').doc(gid).collection('members').doc(targetUid).delete();
      return true;
    } catch (e) {
      return false;
    }
  }

  function buildInviteUrl(code) {
    try {
      const url = new URL(window.location.href);
      url.search = '?join=' + encodeURIComponent(code);
      url.hash = '';
      return url.toString();
    } catch (e) {
      return '?join=' + encodeURIComponent(code);
    }
  }

  function checkJoinLink() {
    try {
      const params = new URLSearchParams(window.location.search);
      const joinCode = (params.get('join') || '').trim().toUpperCase();
      if (!joinCode) return;
      sessionStorage.setItem(PENDING_JOIN_KEY, joinCode);
      // Clean query param so refresh doesn't re-trigger
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      // Navigate directly to Challenge -> Group
      if (window.AppState) window.AppState.setActiveTab('challenge');
      try { localStorage.setItem('study_tracker_challenge_subview', 'group'); } catch (e) {}
    } catch (e) {}
  }

  function consumePendingJoinCode(rerender) {
    let code = '';
    try { code = sessionStorage.getItem(PENDING_JOIN_KEY) || ''; } catch (e) {}
    if (!code) return;
    const user = window.GoogleSync && window.GoogleSync.getUser();
    if (!user) return; // Wait until user signs in
    try { sessionStorage.removeItem(PENDING_JOIN_KEY); } catch (e) {}
    const ar = isAr();
    window.AppUI.confirmAction({
      title: ar ? 'دعوة للانضمام إلى مجموعة دراسة' : 'Study Group Invitation',
      message: ar
        ? `هل تريد الانضمام إلى المجموعة برمز الدعوة (${code})؟`
        : `Join study group with invite code (${code})?`,
      confirmText: ar ? 'انضمام الآن' : 'Join Now',
      onConfirm: async () => {
        const res = await joinGroupByCode(code);
        if (res.ok) {
          window.AppUI.showToast(ar ? `تم الانضمام إلى "${res.name}" 🎉` : `Joined "${res.name}" 🎉`, 'success');
          if (rerender) rerender();
        } else {
          window.AppUI.showToast(res.error, 'danger');
        }
      }
    });
  }

  function openCreateModal(rerender) {
    const ar = isAr();
    window.AppUI.openModal({
      title: ar ? 'إنشاء مجموعة دراسة جديدة' : 'Create Study Group',
      bodyHtml: `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'اسم المجموعة' : 'Group Name'}</label>
            <input id="grp-create-name" type="text" maxlength="40" placeholder="${ar ? 'مثال: تحدي الطب — المرحلة الرابعة' : 'e.g. USMLE Step 1 Squad'}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'هدف المجموعة الأسبوعي (ساعة)' : 'Shared Weekly Goal (hours)'}</label>
            <input id="grp-create-goal" type="number" min="5" max="2000" step="5" value="120" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="grp-create-submit" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'إنشاء' : 'Create'}</button>
      `
    });
    const btn = document.getElementById('grp-create-submit');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        const name = document.getElementById('grp-create-name').value;
        const goal = document.getElementById('grp-create-goal').value;
        const res = await createGroup(name, goal);
        btn.disabled = false;
        if (res.ok) {
          window.AppUI.closeModal();
          window.AppUI.showToast(ar ? `تم إنشاء المجموعة! الرمز: ${res.code}` : `Group created! Code: ${res.code}`, 'success');
          if (rerender) rerender();
        } else {
          window.AppUI.showToast(res.error, 'danger');
        }
      };
    }
  }

  function openJoinModal(rerender) {
    const ar = isAr();
    window.AppUI.openModal({
      title: ar ? 'الانضمام برمز الدعوة' : 'Join Study Group',
      bodyHtml: `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'رمز الدعوة (6 أحرف)' : 'Invite Code (6 chars)'}</label>
            <input id="grp-join-code" type="text" maxlength="10" dir="ltr" placeholder="MED482" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-mono uppercase text-center tracking-widest"/>
          </div>
          <p class="text-[11px] text-slate-400">${ar ? 'تتم مشاركة ساعات المؤقت الموثّقة فقط؛ مهامك وملاحظاتك تبقى خاصة بك.' : 'Only verified timer hours are shared; your tasks and notes remain 100% private.'}</p>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="grp-join-submit" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'انضمام' : 'Join'}</button>
      `
    });
    const btn = document.getElementById('grp-join-submit');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        const code = document.getElementById('grp-join-code').value;
        const res = await joinGroupByCode(code);
        btn.disabled = false;
        if (res.ok) {
          window.AppUI.closeModal();
          window.AppUI.showToast(ar ? `تم الانضمام إلى "${res.name}" 🎉` : `Joined "${res.name}" 🎉`, 'success');
          if (rerender) rerender();
        } else {
          window.AppUI.showToast(res.error, 'danger');
        }
      };
    }
  }

  function openProfileModal(rerender) {
    const ar = isAr();
    const st = getSettings();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const fallbackName = (user && (user.displayName || (user.email ? user.email.split('@')[0] : ''))) || '';
    window.AppUI.openModal({
      title: ar ? 'ملفك وخصوصيتك في المجموعة' : 'Group Profile & Privacy',
      bodyHtml: `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'الاسم المعروض للأعضاء' : 'Display Nickname'}</label>
            <input id="grp-prof-nick" type="text" maxlength="32" value="${escapeHtml(st.groupNickname || fallbackName)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            <p class="text-[10px] text-slate-400 mt-1">${ar ? 'بريدك الإلكتروني لا يظهر أبداً لبقية الأعضاء.' : 'Your email address is never shown to other members.'}</p>
          </div>
          <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer pt-1">
            <input id="grp-prof-subj" type="checkbox" ${st.groupShowSubject !== false ? 'checked' : ''} class="accent-indigo-600"/>
            <span>${ar ? 'إظهار اسم المادة أو التاغ أثناء الدراسة' : 'Show current subject/tag while studying'}</span>
          </label>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="grp-prof-save" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'حفظ' : 'Save'}</button>
      `
    });
    const btn = document.getElementById('grp-prof-save');
    if (btn) {
      btn.onclick = async () => {
        st.groupNickname = (document.getElementById('grp-prof-nick').value || '').trim().slice(0, 32);
        st.groupShowSubject = !!document.getElementById('grp-prof-subj').checked;
        window.AppState.save(true);
        window.AppUI.closeModal();
        await syncMyPresence(true);
        window.AppUI.showToast(ar ? 'تم تحديث ملف المجموعة' : 'Group profile updated', 'success');
        if (rerender) rerender();
      };
    }
  }

  function openManageGroupModal(gid, rerender) {
    const ar = isAr();
    const meta = groupMetaMap[gid];
    if (!meta) return;
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const isOwner = !!(user && meta.ownerUid === user.uid);
    const members = groupMembersMap[gid] || [];

    const membersHtml = isOwner
      ? `<div class="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-1.5 max-h-36 overflow-y-auto">
          <div class="text-[11px] font-bold text-slate-500">${ar ? 'إدارة الأعضاء' : 'Manage Members'}</div>
          ${members.map(m => `
            <div class="flex items-center justify-between text-xs py-1">
              <span class="truncate">${escapeHtml(m.nickname || 'Student')} ${m.uid === meta.ownerUid ? '👑' : ''}</span>
              ${m.uid !== meta.ownerUid ? `<button type="button" data-kick-uid="${escapeHtml(m.uid)}" class="px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold">${ar ? 'إزالة' : 'Remove'}</button>` : ''}
            </div>
          `).join('')}
        </div>`
      : '';

    window.AppUI.openModal({
      title: isOwner ? (ar ? 'إعدادات المجموعة' : 'Group Settings') : (ar ? 'خيارات المجموعة' : 'Group Options'),
      bodyHtml: isOwner ? `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'اسم المجموعة' : 'Group Name'}</label>
            <input id="grp-edit-name" type="text" maxlength="40" value="${escapeHtml(meta.name)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'الهدف الأسبوعي (س)' : 'Weekly Goal (h)'}</label>
              <input id="grp-edit-goal" type="number" min="5" max="2000" step="5" value="${Number(meta.weeklyGoalHours) || 100}" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"/>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">${ar ? 'رمز الدعوة' : 'Invite Code'}</label>
              <button id="grp-regen-code" type="button" class="w-full h-10 px-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? '🔄 تجديد الرمز' : '🔄 New Code'}</button>
            </div>
          </div>
          <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
            <input id="grp-edit-locked" type="checkbox" ${meta.locked ? 'checked' : ''} class="accent-indigo-600"/>
            <span>${ar ? 'قفل الانضمام لأعضاء جدد' : 'Lock group to new members'}</span>
          </label>
          ${membersHtml}
        </div>
      ` : `
        <p class="text-xs text-slate-600 dark:text-slate-300">${ar ? `أنت عضو في مجموعة "${escapeHtml(meta.name)}". يمكنك مغادرتها في أي وقت دون التأثير على بياناتك الشخصية.` : `You are a member of "${escapeHtml(meta.name)}". Leaving will not affect your personal study data.`}</p>
      `,
      footerHtml: isOwner ? `
        <button id="grp-delete-btn" type="button" class="mr-auto px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold">${ar ? 'حذف المجموعة' : 'Delete'}</button>
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="grp-save-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'حفظ' : 'Save'}</button>
      ` : `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إغلاق' : 'Close'}</button>
        <button id="grp-leave-btn" type="button" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold">${ar ? 'مغادرة المجموعة' : 'Leave Group'}</button>
      `
    });

    if (isOwner) {
      let nextCode = meta.code;
      const regenBtn = document.getElementById('grp-regen-code');
      if (regenBtn) {
        regenBtn.onclick = () => {
          nextCode = generateInviteCode();
          regenBtn.textContent = nextCode;
        };
      }
      document.querySelectorAll('[data-kick-uid]').forEach(btn => {
        btn.onclick = async () => {
          const uid = btn.getAttribute('data-kick-uid');
          const ok = await removeMember(gid, uid);
          if (ok) {
            btn.closest('div').remove();
            window.AppUI.showToast(ar ? 'تمت إزالة العضو' : 'Member removed', 'info');
          }
        };
      });
      const saveBtn = document.getElementById('grp-save-btn');
      if (saveBtn) {
        saveBtn.onclick = async () => {
          const newName = (document.getElementById('grp-edit-name').value || '').trim().slice(0, 40);
          const newGoal = Math.max(5, Math.min(2000, Math.round(Number(document.getElementById('grp-edit-goal').value) || 100)));
          const locked = !!document.getElementById('grp-edit-locked').checked;
          if (!newName) return;
          try {
            const ready = await window.GoogleSync.ensureReady();
            await ready.db.collection('groups').doc(gid).set({
              name: newName,
              weeklyGoalHours: newGoal,
              code: nextCode,
              locked
            }, { merge: true });
            window.AppUI.closeModal();
            window.AppUI.showToast(ar ? 'تم حفظ إعدادات المجموعة' : 'Group settings saved', 'success');
            if (rerender) rerender();
          } catch (e) {
            window.AppUI.showToast(ar ? 'تعذر الحفظ' : 'Save failed', 'danger');
          }
        };
      }
      const delBtn = document.getElementById('grp-delete-btn');
      if (delBtn) {
        delBtn.onclick = () => {
          window.AppUI.confirmAction({
            title: ar ? 'حذف المجموعة نهائياً' : 'Delete Group',
            message: ar ? 'سيتم حذف المجموعة وإزالة جميع الأعضاء منها. هل أنت متأكد؟' : 'This will permanently delete the group for all members. Continue?',
            confirmText: ar ? 'نعم، احذف' : 'Delete',
            danger: true,
            onConfirm: async () => {
              await deleteGroup(gid);
              window.AppUI.showToast(ar ? 'تم حذف المجموعة' : 'Group deleted', 'warning');
              if (rerender) rerender();
            }
          });
        };
      }
    } else {
      const leaveBtn = document.getElementById('grp-leave-btn');
      if (leaveBtn) {
        leaveBtn.onclick = async () => {
          await leaveGroup(gid);
          window.AppUI.closeModal();
          window.AppUI.showToast(ar ? 'تمت مغادرة المجموعة' : 'Left group', 'info');
          if (rerender) rerender();
        };
      }
    }
  }

  function render() {
    const ar = isAr();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    if (!user) {
      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="text-3xl">👥</div>
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${ar ? 'مجموعات الدراسة والليدربورد' : 'Study Groups & Leaderboard'}</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            ${ar ? 'سجّل الدخول بحساب Google لإنشاء مجموعة دراسة أو الانضمام لأصدقائك، ومتابعة غرفة الدراسة الحية والترتيب اليومي والأسبوعي.' : 'Sign in with Google to create or join a study group, see who is studying live, and compete on daily & weekly leaderboards.'}
          </p>
          <button id="grp-signin-btn" type="button" class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold">
            ${ar ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google'}
          </button>
        </div>
      `;
    }

    const joinedIds = getJoinedGroupIds();
    if (!joinedIds.length) {
      return `
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-5 text-center shadow-sm border border-slate-200 dark:border-slate-700 space-y-3.5">
          <div class="text-3xl">🏆</div>
          <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">${ar ? 'ابدأ الدراسة مع فريقك' : 'Study Together & Stay Accountable'}</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            ${ar ? 'أنشئ مجموعة جديدة وشارك رمز الدعوة مع زملائك، أو انضم إلى مجموعة موجودة.' : 'Create a new study group and share the invite code, or join an existing group.'}
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button id="grp-open-create" type="button" class="py-2.5 px-3 rounded-xl bg-indigo-600 text-white text-xs font-bold">
              ${ar ? '➕ إنشاء مجموعة' : '➕ Create Group'}
            </button>
            <button id="grp-open-join" type="button" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
              ${ar ? '🔗 انضمام برمز' : '🔗 Join by Code'}
            </button>
          </div>
        </div>
      `;
    }

    const gid = getActiveGroupId();
    const meta = groupMetaMap[gid] || { name: ar ? 'جاري التحميل...' : 'Loading...', code: '------', weeklyGoalHours: 100 };
    const members = groupMembersMap[gid] || [];
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);

    // Compute normalized stats per member (zero-backend daily/weekly reset)
    const normalized = members.map(m => {
      const activeNow = isMemberActivelyStudying(m);
      const pausedNow = !!(m.isStudying && m.isPaused);
      const liveExtraMins = activeNow ? Math.floor(getMemberLiveElapsedSec(m) / 60) : 0;
      const dayMins = (m.todayISO === todayISO ? (Number(m.todayMinutes) || 0) : 0) + liveExtraMins;
      const wkMins = (m.weekKey === weekKey ? (Number(m.weekMinutes) || 0) : 0) + liveExtraMins;
      const totMins = (Number(m.totalMinutes) || 0) + liveExtraMins;
      const dayBooks = m.todayISO === todayISO ? (Number(m.todayBooks) || 0) : 0;
      return {
        ...m,
        activeNow,
        pausedNow,
        dayMins,
        wkMins,
        totMins,
        dayBooks
      };
    });

    const studyingCount = normalized.filter(m => m.activeNow).length;
    const totalWeekHours = Math.round((normalized.reduce((s, m) => s + m.wkMins, 0) / 60) * 10) / 10;
    const goalHours = Number(meta.weeklyGoalHours) || 100;
    const goalPct = goalHours > 0 ? Math.min(100, Math.round((totalWeekHours / goalHours) * 100)) : 0;

    // Sort leaderboard by selected period
    const ranked = [...normalized].sort((a, b) => {
      const av = leaderboardPeriod === 'today' ? a.dayMins : (leaderboardPeriod === 'week' ? a.wkMins : a.totMins);
      const bv = leaderboardPeriod === 'today' ? b.dayMins : (leaderboardPeriod === 'week' ? b.wkMins : b.totMins);
      if (bv !== av) return bv - av;
      return (b.streak || 0) - (a.streak || 0);
    });

    // Live study room sorted: studying first, then paused, then offline
    const roomOrder = [...normalized].sort((a, b) => {
      const score = (x) => x.activeNow ? 2 : (x.pausedNow ? 1 : 0);
      if (score(b) !== score(a)) return score(b) - score(a);
      return b.dayMins - a.dayMins;
    });

    const switcherHtml = joinedIds.length > 1 ? `
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        ${joinedIds.map(id => {
          const nm = (groupMetaMap[id] && groupMetaMap[id].name) || (ar ? 'مجموعة' : 'Group');
          return `<button type="button" data-switch-group="${escapeHtml(id)}" class="px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition ${id === gid ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}">${escapeHtml(nm)}</button>`;
        }).join('')}
      </div>
    ` : '';

    const offlineNotice = navigator.onLine === false && groupFetchedAt[gid]
      ? `<div class="text-[10px] text-amber-600 dark:text-amber-400 text-center">${ar ? 'وضع عدم الاتصال — آخر تحديث محفوظ محلياً' : 'Offline — showing cached leaderboard'}</div>`
      : '';

    const medals = ['🥇', '🥈', '🥉'];

    return `
      <div class="space-y-3">
        ${switcherHtml}
        ${offlineNotice}

        <!-- Group Header & Shared Weekly Goal -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">👥 ${escapeHtml(meta.name)}</h3>
                ${studyingCount > 0 ? `<span class="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">🟢 ${studyingCount}</span>` : ''}
              </div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400" dir="ltr">${escapeHtml(meta.code || '')}</span>
                <button id="grp-share-invite" type="button" class="text-[10px] px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold">
                  ${ar ? '📋 نسخ الدعوة' : '📋 Copy Invite'}
                </button>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button id="grp-profile-btn" type="button" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs" title="${ar ? 'الاسم والخصوصية' : 'Profile & Privacy'}">👤</button>
              <button id="grp-manage-btn" type="button" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs" title="${ar ? 'إعدادات المجموعة' : 'Group Settings'}">⚙️</button>
            </div>
          </div>

          <!-- Shared Weekly Goal -->
          <div>
            <div class="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              <span>${ar ? '🎯 هدف المجموعة الأسبوعي' : '🎯 Group Weekly Goal'}</span>
              <span class="font-bold text-slate-700 dark:text-slate-200">${window.AppUI.formatHours(totalWeekHours)} / ${goalHours}${ar ? 'س' : 'h'} (${goalPct}%)</span>
            </div>
            <div class="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all" style="width:${goalPct}%"></div>
            </div>
          </div>
        </div>

        <!-- Live Study Room Grid -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-2.5">
            <h4 class="text-xs font-bold text-slate-700 dark:text-slate-200">${ar ? 'غرفة الدراسة الحية' : 'Live Study Room'} (${normalized.length})</h4>
            <span class="text-[10px] text-slate-400">${studyingCount > 0 ? (ar ? `${studyingCount} يدرسون الآن` : `${studyingCount} studying now`) : (ar ? 'لا أحد يدرس حالياً' : 'Nobody studying now')}</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            ${roomOrder.map(m => {
              const isMe = m.uid === user.uid;
              const statusDot = m.activeNow ? '🟢' : (m.pausedNow ? '⏸️' : '⚪');
              const clockTxt = m.activeNow
                ? formatClockHMS(getMemberLiveElapsedSec(m))
                : (m.pausedNow ? (ar ? 'استراحة' : 'Paused') : formatMinsShort(m.dayMins));
              return `
                <div class="p-2.5 rounded-xl border text-center space-y-1 ${m.activeNow ? 'border-emerald-400/70 bg-emerald-50/50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'}">
                  <div class="text-xs leading-none">${statusDot}</div>
                  <div class="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.nickname || 'Student')}${isMe ? (ar ? ' (أنت)' : ' (You)') : ''}</div>
                  <div class="text-xs font-mono font-extrabold ${m.activeNow ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}" dir="ltr" ${m.activeNow ? `data-live-member-clock="${escapeHtml(m.uid)}"` : ''}>${clockTxt}</div>
                  ${m.activeNow && m.currentLabel ? `<div class="text-[9px] text-indigo-600 dark:text-indigo-300 truncate">${escapeHtml(m.currentLabel)}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Leaderboard Card -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-xs font-bold text-slate-700 dark:text-slate-200">🏅 ${ar ? 'لوحة المتصدرين' : 'Leaderboard'}</h4>
            <div class="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 text-[10px]">
              ${[
                { id: 'today', ar: 'اليوم', en: 'Today' },
                { id: 'week', ar: 'الأسبوع', en: 'Week' },
                { id: 'total', ar: 'الإجمالي', en: 'Total' }
              ].map(p => `
                <button type="button" data-lb-period="${p.id}" class="px-2 py-1 rounded-md font-bold transition ${leaderboardPeriod === p.id ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
                  ${ar ? p.ar : p.en}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="divide-y divide-slate-100 dark:divide-slate-700/70">
            ${ranked.length ? ranked.map((m, idx) => {
              const isMe = m.uid === user.uid;
              const valMins = leaderboardPeriod === 'today' ? m.dayMins : (leaderboardPeriod === 'week' ? m.wkMins : m.totMins);
              const rankBadge = idx < 3 ? medals[idx] : `<span class="text-[11px] font-bold text-slate-400">#${idx + 1}</span>`;
              return `
                <div class="py-2.5 flex items-center justify-between gap-2 ${isMe ? 'bg-indigo-50/50 dark:bg-indigo-900/20 -mx-2 px-2 rounded-xl' : ''}">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-6 text-center shrink-0">${rankBadge}</div>
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        ${escapeHtml(m.nickname || 'Student')} ${isMe ? `<span class="text-[10px] text-indigo-600 dark:text-indigo-400">${ar ? '(أنت)' : '(You)'}</span>` : ''}
                      </div>
                      <div class="text-[10px] text-slate-400 flex items-center gap-2">
                        ${m.streak > 0 ? `<span>🔥 ${m.streak}${ar ? 'ي' : 'd'}</span>` : ''}
                        ${leaderboardPeriod === 'today' && m.dayBooks > 0 ? `<span>📚 ${m.dayBooks}</span>` : ''}
                        ${m.activeNow ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold">● ${ar ? 'يدرس الآن' : 'Studying'}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="text-xs font-extrabold text-indigo-600 dark:text-indigo-400 shrink-0">${formatMinsShort(valMins)}</div>
                </div>
              `;
            }).join('') : `<div class="py-4 text-center text-xs text-slate-400">${isLoadingGroup ? (ar ? 'جاري تحميل البيانات...' : 'Loading...') : (ar ? 'لا يوجد أعضاء بعد' : 'No members yet')}</div>`}
          </div>
        </div>

        ${joinedIds.length < MAX_GROUPS ? `
          <div class="grid grid-cols-2 gap-2">
            <button id="grp-open-create" type="button" class="py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
              ${ar ? '➕ مجموعة جديدة' : '➕ New Group'}
            </button>
            <button id="grp-open-join" type="button" class="py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
              ${ar ? '🔗 انضمام برمز' : '🔗 Join Code'}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function bindEvents(rerender) {
    lastRerenderFn = rerender;
    const ar = isAr();

    const signInBtn = document.getElementById('grp-signin-btn');
    if (signInBtn && window.GoogleSync) {
      signInBtn.onclick = async () => {
        const res = await window.GoogleSync.signIn();
        if (res && res.ok && !res.redirecting && rerender) rerender();
      };
    }

    const createBtn = document.getElementById('grp-open-create');
    if (createBtn) createBtn.onclick = () => openCreateModal(rerender);

    const joinBtn = document.getElementById('grp-open-join');
    if (joinBtn) joinBtn.onclick = () => openJoinModal(rerender);

    const profileBtn = document.getElementById('grp-profile-btn');
    if (profileBtn) profileBtn.onclick = () => openProfileModal(rerender);

    const manageBtn = document.getElementById('grp-manage-btn');
    if (manageBtn) {
      manageBtn.onclick = () => openManageGroupModal(getActiveGroupId(), rerender);
    }

    const shareBtn = document.getElementById('grp-share-invite');
    if (shareBtn) {
      shareBtn.onclick = async () => {
        const gid = getActiveGroupId();
        const meta = groupMetaMap[gid];
        if (!meta || !meta.code) return;
        const inviteUrl = buildInviteUrl(meta.code);
        const text = ar
          ? `انضم لمجموعة الدراسة "${meta.name}"\nالرمز: ${meta.code}\nالرابط: ${inviteUrl}`
          : `Join my Study Group "${meta.name}"\nCode: ${meta.code}\nLink: ${inviteUrl}`;
        try {
          if (navigator.share) {
            await navigator.share({ title: meta.name, text, url: inviteUrl });
            return;
          }
          await navigator.clipboard.writeText(text);
        } catch (e) {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          } catch (e2) {}
        }
        window.AppUI.showToast(ar ? 'تم نسخ رابط ورمز الدعوة 📋' : 'Invite link & code copied 📋', 'success');
      };
    }

    document.querySelectorAll('[data-switch-group]').forEach(btn => {
      btn.onclick = () => {
        const nextId = btn.getAttribute('data-switch-group');
        if (nextId && nextId !== getActiveGroupId()) {
          setActiveGroupId(nextId);
          detach();
          if (rerender) rerender();
        }
      };
    });

    document.querySelectorAll('[data-lb-period]').forEach(btn => {
      btn.onclick = () => {
        const nextP = btn.getAttribute('data-lb-period');
        if (nextP && nextP !== leaderboardPeriod) {
          leaderboardPeriod = nextP;
          if (rerender) rerender();
        }
      };
    });

    // Attach live Firestore listener only while viewing the group tab
    attachLiveListener(rerender);
    consumePendingJoinCode(rerender);
  }

  function onAuthReady() {
    syncMyPresence(false);
    if (lastRerenderFn && window.AppState && window.AppState.getActiveTab() === 'challenge') {
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
