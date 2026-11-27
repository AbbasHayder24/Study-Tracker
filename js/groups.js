/**
 * groups.js — Study Hall (القاعة) v72
 * Features:
 * - Hall Vibe themes (Cozy Library, Rainy Café, Exam Camp, Zen Garden)
 * - Daily Leader's Pinned Motto 👑 (stored in leader's own member doc — zero Firestore rule changes)
 * - Co-Study Glow ⚡ when 2+ members study live together
 * - Live Study Desks with live ticking clocks, Weekly Rank Tiers (🌱🥉🥈🥇💎) & each member's Deficit
 * - Shared Hall Bookshelf 📚 showing today's completed books from all members together
 * - Weekly Fun Awards (🌅 Early Bird, 🦉 Night Owl, 🏋️ Iron Focus, 🔥 Streak Master)
 * - Today / Week Leaderboard with Deficit & Tier badges
 * - Shareable Hall Recap Card 📤 (1-tap copy for Telegram / WhatsApp)
 */
window.GroupsModule = (function () {
  const CACHE_KEY = 'study_tracker_groups_cache_v1';
  const PENDING_JOIN_KEY = 'study_tracker_pending_join_code';
  const MAX_GROUPS = 3;
  const MAX_MEMBERS_PER_GROUP = 30;
  const MAX_GHOST_TIMER_MS = 6 * 3600 * 1000;
  const MAX_DAILY_MINUTES = 960;
  const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#e11d48', '#7c3aed', '#0d9488', '#d97706'];

  const HALL_VIBES = {
    library: { id: 'library', icon: '🕯️', ar: 'مكتبة ليلية دافئة', en: 'Cozy Library', cls: 'hall-vibe-library' },
    cafe:    { id: 'cafe',    icon: '☕', ar: 'مقهى هادئ',         en: 'Rainy Café',   cls: 'hall-vibe-cafe' },
    exam:    { id: 'exam',    icon: '⚡', ar: 'معسكر امتحانات',    en: 'Exam Camp',    cls: 'hall-vibe-exam' },
    garden:  { id: 'garden',  icon: '🌿', ar: 'حديقة هادئة',       en: 'Zen Garden',   cls: 'hall-vibe-garden' }
  };

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
    if (!data.settings.hallVibes || typeof data.settings.hallVibes !== 'object') data.settings.hallVibes = {};
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

  function getGroupVibe(gid, meta) {
    const st = getSettings();
    const vid = (st.hallVibes && st.hallVibes[gid]) || (meta && meta.vibe) || 'library';
    return HALL_VIBES[vid] || HALL_VIBES.library;
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

  function getWeeklyTier(weekMins) {
    const hrs = (Number(weekMins) || 0) / 60;
    if (hrs >= 40) return { icon: '💎', ar: 'ماسي', en: 'Diamond', cls: 'tier-diamond' };
    if (hrs >= 25) return { icon: '🥇', ar: 'ذهبي', en: 'Gold', cls: 'tier-gold' };
    if (hrs >= 15) return { icon: '🥈', ar: 'فضي', en: 'Silver', cls: 'tier-silver' };
    if (hrs >= 5)  return { icon: '🥉', ar: 'برونزي', en: 'Bronze', cls: 'tier-bronze' };
    return { icon: '🌱', ar: 'مبتدئ', en: 'Starter', cls: 'tier-starter' };
  }

  function formatDeficitBadge(deficitHrs) {
    const val = Math.max(0, Math.round((Number(deficitHrs) || 0) * 10) / 10);
    const ar = isAr();
    if (val <= 0) {
      return `<span class="hall-deficit-ok">${ar ? '✓ 0 عجز' : '✓ 0 deficit'}</span>`;
    }
    return `<span class="hall-deficit-due">${ar ? `عجز ${val}س` : `-${val}h def`}</span>`;
  }

  function extractBookStartHour(b) {
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

  function computeMyStatsPayload() {
    const data = window.AppState.getData();
    const user = window.GoogleSync && window.GoogleSync.getUser();
    const st = getSettings();
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);
    const todayTargetHrs = window.LedgerEngine ? window.LedgerEngine.getDailyTarget(todayISO) : 5.5;
    const dailyTargetMinutes = Math.max(30, Math.round(todayTargetHrs * 60));

    let deficitHours = 0;
    try {
      if (window.LedgerEngine && window.LedgerEngine.computeLedger) {
        const led = window.LedgerEngine.computeLedger();
        deficitHours = Math.max(0, Math.round((Number(led && led.carriedDeficit) || 0) * 100) / 100);
      }
    } catch (e) {}

    const verifiedBooks = (data.books || []).filter(isVerifiedBook);
    let todayMinutes = 0;
    let todayBooks = 0;
    let weekMinutes = 0;
    let totalMinutes = 0;
    let weekMorningMins = 0;
    let weekNightMins = 0;
    let weekLongestSession = 0;
    const todayShelfBooks = [];
    const studyDaysSet = new Set();

    for (const b of verifiedBooks) {
      const m = Math.round(Number(b.minutes) || 0);
      totalMinutes += m;
      if (b.date) {
        studyDaysSet.add(b.date);
        if (b.date === todayISO) {
          todayMinutes += m;
          todayBooks++;
          if (todayShelfBooks.length < 12) {
            const subj = b.subjectId && window.AppUI ? window.AppUI.getSubjectById(b.subjectId) : null;
            const tag = b.tagId && window.AppUI ? window.AppUI.getTagById(b.tagId) : null;
            const color = b.subjectColor || (subj && subj.color) || (tag && tag.color) || '#4f46e5';
            const label = (subj && subj.name) || (tag && String(tag.name).replace(/^[^\p{L}\p{N}]+/u, '').trim()) || '';
            todayShelfBooks.push({
              m: Math.min(360, m),
              c: String(color).slice(0, 16),
              s: (st.groupShowSubject !== false ? String(label).slice(0, 14) : '')
            });
          }
        }
        if (getWeekKey(b.date) === weekKey) {
          weekMinutes += m;
          if (m > weekLongestSession) weekLongestSession = m;
          const hr = extractBookStartHour(b);
          if (hr >= 4 && hr < 10) weekMorningMins += m;
          else if (hr >= 21 || (hr >= 0 && hr < 4)) weekNightMins += m;
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
    const prof = (st.profile && typeof st.profile === 'object') ? st.profile : {};
    const nickname = (prof.name && String(prof.name).trim()) || (st.groupNickname && String(st.groupNickname).trim()) || defaultName;
    const avatar = prof.avatar || '';
    const profileColor = prof.color || '';
    const major = (prof.major && String(prof.major).trim()).slice(0, 44);
    const bio = (prof.bio && String(prof.bio).trim()).slice(0, 90);
    const leaderMotto = (st.leaderMottoDate === todayISO && st.leaderMotto) ? String(st.leaderMotto).trim().slice(0, 80) : '';

    return {
      uid: user ? user.uid : '',
      nickname: nickname.slice(0, 32),
      avatar,
      profileColor,
      major,
      bio,
      todayISO,
      todayMinutes: Math.min(MAX_DAILY_MINUTES, Math.round(todayMinutes)),
      dailyTargetMinutes,
      todayBooks,
      todayShelfBooks,
      deficitHours,
      weekKey,
      weekMinutes: Math.min(MAX_DAILY_MINUTES * 7, Math.round(weekMinutes)),
      weekMorningMins: Math.round(weekMorningMins),
      weekNightMins: Math.round(weekNightMins),
      weekLongestSession: Math.round(weekLongestSession),
      totalMinutes: Math.round(totalMinutes),
      streak,
      leaderMotto,
      leaderMottoDate: leaderMotto ? todayISO : '',
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
      p.nickname, p.avatar, p.profileColor, p.major, p.bio, p.todayISO, p.todayMinutes, p.todayBooks, p.todayShelfBooks, p.deficitHours,
      p.weekKey, p.weekMinutes, p.weekMorningMins, p.weekNightMins, p.weekLongestSession,
      p.totalMinutes, p.streak, p.leaderMotto, p.leaderMottoDate,
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
      const meta = { name: cleanName, code, ownerUid: ready.user.uid, vibe: 'library', createdAt: now, updatedAt: now };
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

  function copyTextToClipboard(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        window.AppUI.showToast(okMsg, 'success');
      }).catch(() => {
        window.AppUI.showToast(okMsg, 'info');
      });
    } else {
      window.AppUI.showToast(okMsg, 'info');
    }
  }

  function copyInviteLink(code) {
    const ar = isAr();
    const url = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(code)}`;
    copyTextToClipboard(url, ar ? `تم نسخ رابط الدعوة (${code}) 🔗` : `Invite link copied (${code}) 🔗`);
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

  function openMottoModal(rerender) {
    const ar = isAr();
    const st = getSettings();
    const todayISO = window.AppState.getLocalTodayISO();
    const curMotto = (st.leaderMottoDate === todayISO && st.leaderMotto) ? st.leaderMotto : '';
    window.AppUI.openModal({
      title: ar ? '👑 رسالة المتصدر اليومي' : '👑 Daily Leader Motto',
      bodyHtml: `
        <div class="space-y-3">
          <p class="text-xs text-slate-500 dark:text-slate-400">${ar ? 'لأنك متصدر القاعة اليوم، اكتب عبارة تحفيزية قصيرة تظهر للجميع في الأعلى:' : 'As today\'s #1 leader, pin a short motivational line for the whole hall:'}</p>
          <input id="hall-motto-input" type="text" maxlength="80" value="${escapeHtml(curMotto)}" placeholder="${ar ? 'مثال: اليوم نكمل هدفنا بدون أعذار! 🔥' : 'e.g. No excuses today — let\'s crush our goals! 🔥'}" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"/>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إلغاء' : 'Cancel'}</button>
        <button id="hall-motto-save" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? 'تثبيت الرسالة' : 'Pin Motto'}</button>
      `
    });
    const saveBtn = document.getElementById('hall-motto-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const val = (document.getElementById('hall-motto-input').value || '').trim().slice(0, 80);
        st.leaderMotto = val;
        st.leaderMottoDate = val ? todayISO : '';
        window.AppState.save(true);
        syncMyPresence(true);
        window.AppUI.closeModal();
        window.AppUI.showToast(ar ? 'تم تثبيت رسالة المتصدر 👑' : 'Leader motto pinned 👑', 'success');
        if (rerender) rerender();
      };
    }
  }

  function openShareRecapModal(meta, members, sharedBooksCount) {
    const ar = isAr();
    const totalTodayMins = members.reduce((s, m) => s + m._todayMins, 0);
    const sorted = [...members].sort((a, b) => b._todayMins - a._todayMins);
    const top3 = sorted.slice(0, 3);
    const dateStr = window.AppUI.formatDate(window.AppState.getLocalTodayISO());

    const lines = [
      `🏛️ ${meta.name || meta.id} — ${dateStr}`,
      ar
        ? `⏱️ مجموع القاعة اليوم: ${formatMinsShort(totalTodayMins)} (${sharedBooksCount} كتاب)`
        : `⏱️ Hall Total Today: ${formatMinsShort(totalTodayMins)} (${sharedBooksCount} books)`,
      ''
    ];
    top3.forEach((m, i) => {
      const med = i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉');
      const defTxt = m._deficit > 0 ? (ar ? ` • عجز ${m._deficit}س` : ` • -${m._deficit}h def`) : (ar ? ' • 0 عجز' : ' • 0 def');
      lines.push(`${med} ${m.nickname}: ${formatMinsShort(m._todayMins)}${defTxt}`);
    });
    const shareText = lines.join('\n');

    window.AppUI.openModal({
      title: ar ? '📤 ملخص القاعة اليوم' : '📤 Hall Daily Recap',
      bodyHtml: `
        <div class="space-y-3">
          <div class="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-900/30 border border-indigo-200/60 dark:border-indigo-800/50 space-y-2.5">
            <div class="flex items-center justify-between">
              <div class="text-sm font-extrabold text-slate-800 dark:text-slate-100">🏛️ ${escapeHtml(meta.name || meta.id)}</div>
              <span class="text-[10px] font-bold text-slate-400">${escapeHtml(dateStr)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-center">
              <div class="p-2 rounded-xl bg-white/80 dark:bg-slate-800/80">
                <div class="text-[10px] text-slate-400">${ar ? 'مجموع القاعة' : 'Team Total'}</div>
                <div class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">${formatMinsShort(totalTodayMins)}</div>
              </div>
              <div class="p-2 rounded-xl bg-white/80 dark:bg-slate-800/80">
                <div class="text-[10px] text-slate-400">${ar ? 'الكتب المنجزة' : 'Books Done'}</div>
                <div class="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">${sharedBooksCount} 📚</div>
              </div>
            </div>
            <div class="space-y-1 pt-1">
              ${top3.map((m, i) => `
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-slate-700 dark:text-slate-200">${i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉')} ${escapeHtml(m.nickname)}</span>
                  <span class="font-extrabold tabular-nums text-slate-600 dark:text-slate-300">${formatMinsShort(m._todayMins)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" onclick="window.AppUI.closeModal()" class="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إغلاق' : 'Close'}</button>
        <button id="hall-copy-recap" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">${ar ? '📋 نسخ للمشاركة' : '📋 Copy to Share'}</button>
      `
    });
    const cBtn = document.getElementById('hall-copy-recap');
    if (cBtn) {
      cBtn.onclick = () => {
        copyTextToClipboard(shareText, ar ? 'تم نسخ ملخص القاعة للمشاركة 📋' : 'Hall recap copied 📋');
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
    const curVibe = getGroupVibe(gid, meta).id;

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
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">${ar ? 'جوّ القاعة' : 'Hall Vibe'}</label>
            <div class="grid grid-cols-2 gap-1.5">
              ${Object.values(HALL_VIBES).map(v => `
                <button type="button" data-pick-vibe="${v.id}" class="py-2 px-2.5 rounded-xl text-[11px] font-bold border text-start flex items-center gap-1.5 ${curVibe === v.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}">
                  <span>${v.icon}</span><span class="truncate">${ar ? v.ar : v.en}</span>
                </button>
              `).join('')}
            </div>
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

    let pickedVibe = curVibe;
    document.querySelectorAll('[data-pick-vibe]').forEach(vb => {
      vb.onclick = () => {
        pickedVibe = vb.getAttribute('data-pick-vibe');
        document.querySelectorAll('[data-pick-vibe]').forEach(other => {
          const act = other.getAttribute('data-pick-vibe') === pickedVibe;
          other.className = `py-2 px-2.5 rounded-xl text-[11px] font-bold border text-start flex items-center gap-1.5 ${act ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}`;
        });
      };
    });

    const copyBtn = document.getElementById('hall-modal-copy');
    if (copyBtn) copyBtn.onclick = () => copyInviteLink(gid);

    const saveBtn = document.getElementById('hall-set-save');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const nick = (document.getElementById('hall-set-nick').value || '').trim().slice(0, 32);
        const show = !!document.getElementById('hall-set-show-subj').checked;
        st.groupNickname = nick;
        st.groupShowSubject = show;
        st.hallVibes[gid] = pickedVibe;
        window.AppState.save(true);
        syncMyPresence(true);
        if (isOwner) {
          try {
            const ready = await window.GoogleSync.ensureReady();
            if (ready && ready.db) {
              await ready.db.collection('groups').doc(gid).update({ vibe: pickedVibe }).catch(() => {});
            }
          } catch (e) {}
        }
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
      delBtn.onclick = () => {
        window.AppUI.confirmAction({
          title: ar ? 'حذف القاعة نهائياً' : 'Delete Study Hall',
          message: ar ? 'سيتم حذف هذه القاعة نهائياً لجميع الأعضاء. هل تريد المتابعة؟' : 'This hall will be permanently deleted for all members. Continue?',
          confirmText: ar ? 'حذف' : 'Delete',
          onConfirm: async () => {
            await deleteGroup(gid);
            if (rerender) rerender();
          }
        });
      };
    }
  }

  function computeWeeklyAwards(members) {
    const ar = isAr();
    const awards = [];
    const pickTop = (getter, minVal) => {
      let best = null;
      let bestVal = minVal;
      for (const m of members) {
        const v = getter(m);
        if (v > bestVal) { bestVal = v; best = m; }
      }
      return best ? { member: best, val: bestVal } : null;
    };

    const early = pickTop(m => m._weekMorningMins, 0);
    if (early) awards.push({ icon: '🌅', title: ar ? 'طير الفجر' : 'Early Bird', name: early.member.nickname, stat: formatMinsShort(early.val) });

    const night = pickTop(m => m._weekNightMins, 0);
    if (night) awards.push({ icon: '🦉', title: ar ? 'بومة الليل' : 'Night Owl', name: night.member.nickname, stat: formatMinsShort(night.val) });

    const longest = pickTop(m => m._weekLongestSession, 0);
    if (longest) awards.push({ icon: '🏋️', title: ar ? 'نفس طويل' : 'Iron Focus', name: longest.member.nickname, stat: formatMinsShort(longest.val) });

    const streak = pickTop(m => Number(m.streak) || 0, 0);
    if (streak) awards.push({ icon: '🔥', title: ar ? 'الأكثر التزاماً' : 'Streak Master', name: streak.member.nickname, stat: ar ? `${streak.val} يوم` : `${streak.val}d` });

    return awards;
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
            ${ar ? 'ادرس مع أصدقائك بشكل حي وشاهد من يركز الآن ورف الكتب المشترك وترتيب الساعات.' : 'Study live with friends, share a daily bookshelf, and compare hours & deficits.'}
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
    const vibe = getGroupVibe(gid, meta);
    const rawMembers = Array.isArray(groupMembersMap[gid]) ? groupMembersMap[gid] : [];
    const todayISO = window.AppState.getLocalTodayISO();
    const weekKey = getWeekKey(todayISO);

    const members = rawMembers.map(m => {
      const studying = isMemberActivelyStudying(m);
      const paused = !!(m.isStudying && m.isPaused);
      const liveExtraMin = studying ? Math.floor(getMemberLiveElapsedSec(m) / 60) : 0;
      const baseToday = m.todayISO === todayISO ? (Number(m.todayMinutes) || 0) : 0;
      const baseWeek = m.weekKey === weekKey ? (Number(m.weekMinutes) || 0) : 0;
      const todayBooksArr = (m.todayISO === todayISO && Array.isArray(m.todayShelfBooks)) ? m.todayShelfBooks : [];
      return {
        ...m,
        _studying: studying,
        _paused: paused,
        _liveSec: studying ? getMemberLiveElapsedSec(m) : 0,
        _todayMins: Math.min(MAX_DAILY_MINUTES, baseToday + liveExtraMin),
        _weekMins: Math.min(MAX_DAILY_MINUTES * 7, baseWeek + liveExtraMin),
        _weekMorningMins: m.weekKey === weekKey ? (Number(m.weekMorningMins) || 0) : 0,
        _weekNightMins: m.weekKey === weekKey ? (Number(m.weekNightMins) || 0) : 0,
        _weekLongestSession: m.weekKey === weekKey ? (Number(m.weekLongestSession) || 0) : 0,
        _deficit: Math.max(0, Math.round((Number(m.deficitHours) || 0) * 10) / 10),
        _todayShelfBooks: todayBooksArr,
        _tier: getWeeklyTier(Math.min(MAX_DAILY_MINUTES * 7, baseWeek + liveExtraMin))
      };
    });

    const liveCount = members.filter(m => m._studying).length;
    const isCoStudying = liveCount >= 2;

    const todaySorted = [...members].sort((a, b) => b._todayMins - a._todayMins);
    const todayLeader = todaySorted.length && todaySorted[0]._todayMins > 0 ? todaySorted[0] : null;
    const amTodayLeader = !!(todayLeader && user && todayLeader.uid === user.uid);
    const pinnedMotto = (todayLeader && todayLeader.leaderMottoDate === todayISO && todayLeader.leaderMotto) ? todayLeader.leaderMotto : '';

    const deskSorted = [...members].sort((a, b) => {
      const rankA = a._studying ? 2 : (a._paused ? 1 : 0);
      const rankB = b._studying ? 2 : (b._paused ? 1 : 0);
      if (rankB !== rankA) return rankB - rankA;
      return b._todayMins - a._todayMins;
    });

    const lbKey = leaderboardPeriod === 'week' ? '_weekMins' : '_todayMins';
    const lbSorted = [...members].sort((a, b) => b[lbKey] - a[lbKey]);
    const topMins = Math.max(1, lbSorted.length ? lbSorted[0][lbKey] : 1);

    // #1 Shared Hall Bookshelf (combine today's books from all members)
    const sharedBooks = [];
    members.forEach(m => {
      (m._todayShelfBooks || []).forEach(b => {
        sharedBooks.push({
          m: Number(b.m) || 25,
          c: b.c || avatarColorFor(m.nickname || m.uid),
          s: b.s || '',
          owner: m.nickname || 'Student',
          init: avatarInitial(m.nickname)
        });
      });
    });

    // #2 Weekly Fun Awards
    const awards = computeWeeklyAwards(members);

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

        <!-- #7 Hall Vibe Hero Card + #6 Leader Motto -->
        <div class="hall-vibe-card ${vibe.cls}">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-lg leading-none">${vibe.icon}</span>
                <h2 class="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(meta.name || gid)}</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${liveCount > 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-white/70 dark:bg-slate-800/70 text-slate-500 dark:text-slate-300'}">
                  ${liveCount > 0 ? (ar ? `● ${liveCount} يدرسون` : `● ${liveCount} live`) : (ar ? `${members.length} أعضاء` : `${members.length} members`)}
                </span>
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">${ar ? vibe.ar : vibe.en} • ${ar ? 'الرمز:' : 'Code:'} <span class="font-bold tracking-wider">${escapeHtml(gid)}</span></div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button id="hall-share-recap" type="button" class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm" title="${ar ? 'ملخص القاعة للمشاركة' : 'Share Hall Recap'}">📤</button>
              <button id="hall-copy-link" type="button" class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-800/80 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm" title="${ar ? 'نسخ رابط الدعوة' : 'Copy invite link'}">🔗</button>
              ${groupIds.length < MAX_GROUPS ? `<button id="hall-add-more" type="button" class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm font-bold" title="${ar ? 'إنشاء أو انضمام' : 'Create or join'}">+</button>` : ''}
              <button id="hall-settings-btn" type="button" class="w-8 h-8 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm" title="${ar ? 'إعدادات القاعة' : 'Hall settings'}">⚙️</button>
            </div>
          </div>

          ${(pinnedMotto || amTodayLeader) ? `
            <div class="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-2">
              <div class="text-xs text-slate-700 dark:text-slate-200 min-w-0 truncate">
                <span class="font-bold">👑 ${escapeHtml(todayLeader ? todayLeader.nickname : '')}:</span>
                <span class="${pinnedMotto ? '' : 'text-slate-400 italic'}">
                  ${pinnedMotto ? escapeHtml(pinnedMotto) : (ar ? 'اكتب رسالة تحفيزية للقاعة اليوم...' : 'Pin a motivational motto for today...')}
                </span>
              </div>
              ${amTodayLeader ? `<button id="hall-edit-motto" type="button" class="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-800/80 text-[11px] font-bold text-indigo-600 dark:text-indigo-300 shrink-0">✏️</button>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- #4 Co-Study Glow Banner -->
        ${isCoStudying ? `
          <div class="hall-costudy-banner">
            <span>⚡</span>
            <span>${ar ? `تركيز جماعي مفعّل — ${liveCount} يدرسون معاً الآن!` : `Co-Study Glow Active — ${liveCount} studying together now!`}</span>
          </div>
        ` : ''}

        <!-- Live Study Desks Grid (with #4 Co-Study Glow, #5 Rank Tier, and Deficit) -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '📚 مقاعد الدراسة الحية' : '📚 Live Study Desks'}</h3>
            ${!amStudying ? `<button id="hall-start-focus" type="button" class="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-bold">${ar ? '▶ ابدأ التركيز' : '▶ Start Focus'}</button>` : ''}
          </div>
          ${isLoadingGroup && !deskSorted.length ? `
            <div class="py-6 text-center text-xs text-slate-400">...</div>
          ` : `
            <div class="grid grid-cols-2 gap-2.5">
              ${deskSorted.map(m => {
                const isMe = user && m.uid === user.uid;
                const col = avatarColorFor(m.nickname || m.uid);
                const stateCls = m._studying
                  ? (isCoStudying ? 'hall-desk-live hall-desk-costudy' : 'hall-desk-live')
                  : (m._paused ? 'hall-desk-paused' : 'hall-desk-idle');
                const clockTxt = m._studying
                  ? formatClockHMS(m._liveSec)
                  : (m._paused ? (ar ? '⏸ متوقف' : '⏸ Paused') : formatMinsShort(m._todayMins));
                return `
                  <div class="hall-desk-card ${stateCls} cursor-pointer" data-open-member="${escapeHtml(m.uid)}">
                    <div class="flex items-center gap-2 min-w-0">
                      <div class="hall-avatar-ring ${m._studying ? 'is-live' : ''}">
                        <div class="hall-avatar" style="background:${escapeHtml(m.profileColor || col)}">${escapeHtml(m.avatar || avatarInitial(m.nickname))}</div>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1 min-w-0">
                          <span class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.nickname || 'Student')}</span>
                          <span class="text-[11px] shrink-0" title="${ar ? m._tier.ar : m._tier.en}">${m._tier.icon}</span>
                        </div>
                        <div class="text-[10px] truncate ${m._studying ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400'}">
                          ${m._studying
                            ? (m.currentLabel ? escapeHtml(m.currentLabel) : (ar ? 'يدرس الآن' : 'Studying now'))
                            : (m._paused ? (ar ? 'استراحة قصيرة' : 'Short pause') : (isMe ? (ar ? 'أنت • اليوم' : 'You • Today') : (ar ? 'إجمالي اليوم' : 'Today total')))}
                        </div>
                      </div>
                    </div>
                    <div class="mt-2.5 flex items-center justify-between gap-1">
                      <span ${m._studying ? `data-live-member-clock="${escapeHtml(m.uid)}"` : ''} class="text-sm font-extrabold tabular-nums ${m._studying ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}">
                        ${clockTxt}
                      </span>
                      ${formatDeficitBadge(m._deficit)}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- #1 Shared Hall Bookshelf (Today's Collective Books) -->
        <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '🪵 رف كتب القاعة اليوم' : '🪵 Shared Hall Bookshelf'}</h3>
            <span class="text-[11px] font-bold text-slate-400">${sharedBooks.length} ${ar ? 'كتاب' : 'books'}</span>
          </div>
          ${sharedBooks.length ? `
            <div class="hall-shared-shelf-wrap">
              <div class="flex items-end gap-1.5 px-2 pt-2 overflow-x-auto no-scrollbar" style="min-height:74px">
                ${sharedBooks.slice(0, 28).map(b => {
                  const hPx = Math.max(44, Math.min(72, 42 + Math.round(b.m / 3)));
                  const wPx = b.m >= 50 ? 28 : 22;
                  const tip = `${b.owner} • ${b.m}${ar ? 'د' : 'm'}${b.s ? ' • ' + b.s : ''}`;
                  return `
                    <div class="hall-mini-book shrink-0" title="${escapeHtml(tip)}" style="width:${wPx}px;height:${hPx}px;background:${escapeHtml(b.c)}">
                      <span class="hall-mini-book-init">${escapeHtml(b.init)}</span>
                      <span class="hall-mini-book-min">${b.m}</span>
                    </div>
                  `;
                }).join('')}
              </div>
              <div class="hall-wood-plank"></div>
            </div>
          ` : `
            <div class="py-4 text-center text-[11px] text-slate-400">
              ${ar ? 'أول كتاب يُنجز اليوم سيظهر هنا على رف القاعة 📚' : 'The first completed session today will appear on the shared shelf 📚'}
            </div>
          `}
        </div>

        <!-- #2 Weekly Fun Awards -->
        ${awards.length ? `
          <div class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-2.5">
            <h3 class="text-xs font-extrabold text-slate-700 dark:text-slate-200">${ar ? '🏅 ألقاب الأسبوع' : '🏅 Weekly Fun Awards'}</h3>
            <div class="grid grid-cols-2 gap-2">
              ${awards.map(aw => `
                <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/70 dark:border-slate-700/70 flex items-center gap-2 min-w-0">
                  <span class="text-lg shrink-0">${aw.icon}</span>
                  <div class="min-w-0">
                    <div class="text-[10px] font-bold text-slate-400 truncate">${escapeHtml(aw.title)}</div>
                    <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(aw.name)}</div>
                    <div class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">${escapeHtml(aw.stat)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Leaderboard (Today / Week) with #5 Tier & Deficit -->
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
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="w-6 text-center font-extrabold text-[11px] text-slate-500 shrink-0">${medal}</span>
                      <span class="font-bold truncate ${isMe ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-100'}">${escapeHtml(m.nickname || 'Student')}</span>
                      <span class="text-[11px] shrink-0" title="${ar ? m._tier.ar : m._tier.en}">${m._tier.icon}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      ${formatDeficitBadge(m._deficit)}
                      <span class="font-extrabold tabular-nums text-slate-700 dark:text-slate-200">${formatMinsShort(mins)}</span>
                    </div>
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

    const mottoBtn = document.getElementById('hall-edit-motto');
    if (mottoBtn) mottoBtn.onclick = () => openMottoModal(rerender);

    const shareBtn = document.getElementById('hall-share-recap');
    if (shareBtn && gid) {
      shareBtn.onclick = () => {
        const meta = groupMetaMap[gid] || { id: gid, name: gid };
        const rawMembers = Array.isArray(groupMembersMap[gid]) ? groupMembersMap[gid] : [];
        const todayISO = window.AppState.getLocalTodayISO();
        const mems = rawMembers.map(m => {
          const studying = isMemberActivelyStudying(m);
          const extra = studying ? Math.floor(getMemberLiveElapsedSec(m) / 60) : 0;
          const base = m.todayISO === todayISO ? (Number(m.todayMinutes) || 0) : 0;
          return {
            ...m,
            _todayMins: Math.min(MAX_DAILY_MINUTES, base + extra),
            _deficit: Math.max(0, Math.round((Number(m.deficitHours) || 0) * 10) / 10),
            _booksCount: (m.todayISO === todayISO && Array.isArray(m.todayShelfBooks)) ? m.todayShelfBooks.length : (m.todayISO === todayISO ? (Number(m.todayBooks) || 0) : 0)
          };
        });
        const totalBooks = mems.reduce((s, m) => s + m._booksCount, 0);
        openShareRecapModal(meta, mems, totalBooks);
      };
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


    document.querySelectorAll('[data-open-member]').forEach(card => {
      card.onclick = () => {
        const uid = card.getAttribute('data-open-member');
        const list = Array.isArray(groupMembersMap[gid]) ? groupMembersMap[gid] : [];
        const m = list.find(x => x.uid === uid);
        if (!m) return;
        const todayISO = window.AppState.getLocalTodayISO();
        const weekKey = getWeekKey(todayISO);
        const studying = isMemberActivelyStudying(m);
        const liveExtra = studying ? Math.floor(getMemberLiveElapsedSec(m) / 60) : 0;
        const tMins = (m.todayISO === todayISO ? (Number(m.todayMinutes) || 0) : 0) + liveExtra;
        const wMins = (m.weekKey === weekKey ? (Number(m.weekMinutes) || 0) : 0) + liveExtra;
        const totHrs = Math.round(((Number(m.totalMinutes) || 0) / 60) * 10) / 10;
        const tier = getWeeklyTier(wMins);
        const def = Math.max(0, Math.round((Number(m.deficitHours) || 0) * 10) / 10);
        const col = m.profileColor || avatarColorFor(m.nickname || m.uid);
        window.AppUI.openModal({
          title: `${m.avatar || '👤'} ${m.nickname || 'Student'}`,
          bodyHtml: `
            <div class="space-y-3.5">
              <div class="flex items-center gap-3">
                <div class="profile-hero-avatar" style="background:${escapeHtml(col)}">${escapeHtml(m.avatar || avatarInitial(m.nickname))}</div>
                <div class="min-w-0">
                  <div class="text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.nickname || 'Student')}</div>
                  ${m.major ? `<div class="text-xs font-bold text-slate-500 dark:text-slate-300 truncate">${escapeHtml(m.major)}</div>` : ''}
                  <div class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">${tier.icon} ${ar ? tier.ar : tier.en} • 🔥 ${Number(m.streak) || 0} ${ar ? 'يوم' : 'd'}</div>
                </div>
              </div>
              ${m.bio ? `<p class="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-xl">“${escapeHtml(m.bio)}”</p>` : ''}
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                  <div class="text-[10px] text-slate-400">${ar ? 'اليوم' : 'Today'}</div>
                  <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">${formatMinsShort(tMins)}</div>
                </div>
                <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                  <div class="text-[10px] text-slate-400">${ar ? 'الأسبوع' : 'Week'}</div>
                  <div class="text-xs font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">${formatMinsShort(wMins)}</div>
                </div>
                <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                  <div class="text-[10px] text-slate-400">${ar ? 'الإجمالي' : 'Total'}</div>
                  <div class="text-xs font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">${totHrs}${ar ? 'س' : 'h'}</div>
                </div>
              </div>
              <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-xs">
                <span class="font-bold text-slate-500">${ar ? 'العجز الحالي (Deficit)' : 'Current Deficit'}</span>
                ${formatDeficitBadge(def)}
              </div>
            </div>
          `,
          footerHtml: `<button type="button" onclick="window.AppUI.closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold">${ar ? 'إغلاق' : 'Close'}</button>`
        });
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