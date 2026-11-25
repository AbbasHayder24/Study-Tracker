/**
 * bookshelf.js — Interactive inline SVG bookshelf supporting two switchable styles:
 * 1. Classic 3D (flush on wood-grain shelf, curved spine lighting, creamy top page block, embossed ribs, draping silk ribbon)
 * 2. Modern Minimal (flush on light-oak shelf, matte gradient, diagonal Subject accent stripe, frosted pill label)
 * Both styles support two-tone Tag + Subject colors, clean emoji-stripped spine labels, and Select All / Delete.
 */
window.BookshelfModule = (function () {
  let shelfPeriod = 'day'; // 'day' | 'week' | 'month' | 'year'
  let visibleShelvesCount = 3;
  let cachedShelfKey = '';
  let cachedShelfHtml = '';
  let recentBookId = '';
  let recentBookTimer = null;

  function markNewlyAddedBook(bookId) {
    recentBookId = bookId || '';
    cachedShelfKey = '';
    if (recentBookTimer) clearTimeout(recentBookTimer);
    recentBookTimer = setTimeout(() => {
      recentBookId = '';
      cachedShelfKey = '';
    }, 3500);
  }

  function getBookTimestamps(book) {
    if (!book) return { startMs: null, endMs: null };
    let startMs = book.startedAt ? Number(book.startedAt) : null;
    let endMs = book.endedAt ? Number(book.endedAt) : null;
    const durMs = Math.max(60000, (Number(book.durationSec) || ((Number(book.minutes) || 0) * 60)) * 1000);
    if (!endMs && book.createdAt && String(book.createdAt).includes('T')) {
      const parsed = Date.parse(book.createdAt);
      if (!Number.isNaN(parsed)) endMs = parsed;
    }
    if (!startMs && endMs) startMs = endMs - durMs;
    if (!endMs && startMs) endMs = startMs + durMs;
    return { startMs, endMs };
  }

  function formatShortTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    try {
      const isAr = !!(window.I18n && window.I18n.isRTL());
      return d.toLocaleTimeString(isAr ? 'ar-IQ' : [], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }

  function toTimeInputVal(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatBookTimeRange(book) {
    const { startMs, endMs } = getBookTimestamps(book);
    if (!startMs || !endMs) return '';
    return `${formatShortTime(startMs)} – ${formatShortTime(endMs)}`;
  }

  function filterBooksByPeriod(allBooks, period) {
    const todayISO = window.AppState.getLocalTodayISO();
    if (period === 'day') {
      return allBooks.filter(b => b.date === todayISO);
    }
    if (period === 'week') {
      const parts = todayISO.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() - 6);
      const startISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return allBooks.filter(b => b.date && b.date >= startISO && b.date <= todayISO);
    }
    if (period === 'month') {
      const ym = todayISO.slice(0, 7);
      return allBooks.filter(b => b.date && String(b.date).startsWith(ym));
    }
    if (period === 'year') {
      const yr = todayISO.slice(0, 4);
      return allBooks.filter(b => b.date && String(b.date).startsWith(yr));
    }
    return allBooks;
  }
  const C = window.APP_CONFIG;
  let multiSelectMode = false;
  let selectedIds = new Set();

  function t(key, vars) {
    return window.I18n ? window.I18n.t(key, vars) : key;
  }

  function getShelfStyle() {
    const data = window.AppState ? window.AppState.getData() : null;
    const st = data && data.settings && data.settings.shelfStyle;
    return st === 'minimal' ? 'minimal' : 'classic3d';
  }

  function getBookLevel(minutes, completed) {
    if (!completed || minutes < 5) {
      return C.BOOK_LEVELS[0];
    }
    for (let i = 1; i < C.BOOK_LEVELS.length; i++) {
      const lvl = C.BOOK_LEVELS[i];
      if (minutes >= lvl.minMinutes && minutes <= lvl.maxMinutes) {
        return lvl;
      }
    }
    return C.BOOK_LEVELS[C.BOOK_LEVELS.length - 1];
  }

  function getLevelLabel(lvl) {
    return (window.I18n && window.I18n.isRTL() && lvl.labelAr) ? lvl.labelAr : lvl.label;
  }

  function formatSpineLabel(rawName) {
    if (!rawName) return '';
    // Strip leading emojis/symbols so the spine displays clean readable words
    let clean = String(rawName).replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(rawName).trim();
    if (/^6M Challenge/i.test(clean)) clean = 'Study';
    return clean.length > 9 ? clean.slice(0, 8) + '…' : clean;
  }

  function resolveBookSubject(book) {
    if (book.subjectId) {
      const direct = window.AppUI.getSubjectById(book.subjectId);
      if (direct) return direct;
    }
    if (book.taskId) {
      const task = window.AppState.getData().tasks.find(tk => tk.id === book.taskId);
      if (task && task.subjectId) {
        return window.AppUI.getSubjectById(task.subjectId);
      }
    }
    return null;
  }

  function renderClassic3DBookSVG(book, isSelected, opts) {
    const { w, h, svgW, svgH, yTop, tagColor, subjColor, isGold, isIncomplete, safeId, shortTag, cx, cy, minUnit, lvl } = opts;
    const clipId = `c3d_clip_${safeId}`;
    const gradId = `c3d_gold_${safeId}`;
    const shadeId = `c3d_shade_${safeId}`;
    const pageGradId = `c3d_page_${safeId}`;

    const spineFill = isGold ? `url(#${gradId})` : tagColor;
    const opacity = isIncomplete ? '0.48' : '1';
    const transform = isIncomplete ? `rotate(-9 ${svgW / 2} ${svgH})` : '';
    const strokeCol = isSelected ? '#f43f5e' : (isGold ? '#92400e' : 'rgba(15,23,42,0.34)');
    const strokeW = isSelected ? '2.5' : '1';
    const showRibbon = !isIncomplete && (lvl.id === 'encyclopedia' || lvl.id === 'reference');

    const twoToneBands = subjColor ? `
      <g clip-path="url(#${clipId})">
        <rect x="6" y="${yTop}" width="${w}" height="12" fill="${window.AppUI.escapeHtml(subjColor)}"/>
        <rect x="6" y="${yTop + h - 15}" width="${w}" height="15" fill="${window.AppUI.escapeHtml(subjColor)}"/>
      </g>
    ` : '';

    // Silk ribbon drapes cleanly over the front edge of the wooden shelf
    const ribbonHtml = showRibbon ? `
      <polygon points="${cx - 3},${yTop + h - 1} ${cx + 3},${yTop + h - 1} ${cx + 3},${yTop + h + 8} ${cx},${yTop + h + 5.2} ${cx - 3},${yTop + h + 8}"
        fill="${isGold ? '#dc2626' : '#f59e0b'}" stroke="rgba(0,0,0,0.28)" stroke-width="0.5"/>
    ` : '';

    return `
      <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="pointer-events:none;overflow:visible;" class="shrink-0 drop-shadow-sm transition-transform duration-200 group-hover:-translate-y-1">
        <defs>
          <clipPath id="${clipId}">
            <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="3"/>
          </clipPath>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="30%" stop-color="#f59e0b"/>
            <stop offset="75%" stop-color="#d97706"/>
            <stop offset="100%" stop-color="#92400e"/>
          </linearGradient>
          <linearGradient id="${shadeId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
            <stop offset="22%" stop-color="#ffffff" stop-opacity="0.08"/>
            <stop offset="70%" stop-color="#000000" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.36"/>
          </linearGradient>
          <linearGradient id="${pageGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fffbeb"/>
            <stop offset="100%" stop-color="#e7dcc2"/>
          </linearGradient>
        </defs>
        <g opacity="${opacity}" transform="${transform}">
          <!-- Creamy 3D top page block peeking above spine -->
          <path d="M ${7.2} ${yTop + 2} L ${8.5} ${yTop - 4.5} Q ${cx} ${yTop - 6.5} ${6 + w - 2.5} ${yTop - 4.5} L ${6 + w - 1.2} ${yTop + 2} Z"
            fill="url(#${pageGradId})" stroke="rgba(120,53,15,0.28)" stroke-width="0.6"/>
          <!-- Main spine resting flush on shelf -->
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="3" fill="${spineFill}"/>
          ${twoToneBands}
          <!-- 3D cylindrical lighting overlay -->
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="3" fill="url(#${shadeId})"/>
          <!-- Embossed binding ribs -->
          <line x1="7.5" y1="${yTop + 12}" x2="${6 + w - 1.5}" y2="${yTop + 12}" stroke="rgba(255,255,255,0.62)" stroke-width="1.2"/>
          <line x1="7.5" y1="${yTop + 13.3}" x2="${6 + w - 1.5}" y2="${yTop + 13.3}" stroke="rgba(0,0,0,0.28)" stroke-width="0.9"/>
          <line x1="7.5" y1="${yTop + h - 15}" x2="${6 + w - 1.5}" y2="${yTop + h - 15}" stroke="rgba(255,255,255,0.62)" stroke-width="1.2"/>
          <line x1="7.5" y1="${yTop + h - 13.7}" x2="${6 + w - 1.5}" y2="${yTop + h - 13.7}" stroke="rgba(0,0,0,0.28)" stroke-width="0.9"/>
          <!-- Spine border -->
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="3" fill="none" stroke="${strokeCol}" stroke-width="${strokeW}"/>
          <!-- Labels -->
          <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" unicode-bidi="plaintext"
            transform="rotate(-90 ${cx} ${cy})" font-size="7.8" font-weight="700"
            fill="${isGold ? '#451a03' : '#ffffff'}" opacity="0.96">${window.AppUI.escapeHtml(shortTag)}</text>
          <text x="${cx}" y="${yTop + h - 4.5}" text-anchor="middle" font-size="7.8" font-weight="700"
            fill="#ffffff">${Math.round(book.minutes)}${window.AppUI.escapeHtml(minUnit)}</text>
          ${ribbonHtml}
        </g>
      </svg>
    `;
  }

  function renderMinimalBookSVG(book, isSelected, opts) {
    const { w, h, svgW, svgH, yTop, tagColor, subjColor, isGold, isIncomplete, safeId, shortTag, cx, cy, minUnit } = opts;
    const clipId = `min_clip_${safeId}`;
    const gradId = `min_gold_${safeId}`;
    const vShadeId = `min_vshade_${safeId}`;

    const spineFill = isGold ? `url(#${gradId})` : tagColor;
    const opacity = isIncomplete ? '0.46' : '1';
    const transform = isIncomplete ? `rotate(-9 ${svgW / 2} ${svgH})` : '';
    const strokeCol = isSelected ? '#f43f5e' : 'rgba(255,255,255,0.18)';
    const strokeW = isSelected ? '2.5' : '0.8';

    // Diagonal Subject corner + sleek parallel accent stripe
    const diagH = Math.min(24, Math.round(h * 0.26));
    const diagonalAccent = subjColor ? `
      <g clip-path="url(#${clipId})">
        <polygon points="6,${yTop} ${6 + w},${yTop} 6,${yTop + diagH}" fill="${window.AppUI.escapeHtml(subjColor)}" opacity="0.96"/>
        <line x1="6" y1="${yTop + diagH + 4.5}" x2="${6 + w}" y2="${yTop + 4.5}" stroke="${window.AppUI.escapeHtml(subjColor)}" stroke-width="2.2" opacity="0.9"/>
      </g>
    ` : '';

    // Generous frosted pill sized cleanly around the vertical tag label
    const pillW = Math.max(11, Math.min(15, Math.round(w * 0.50)));
    const pillH = Math.max(30, Math.min(54, h - 30));
    const pillX = cx - pillW / 2;
    const pillY = cy - pillH / 2;

    return `
      <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="pointer-events:none;overflow:visible;" class="shrink-0 drop-shadow-sm transition-transform duration-200 group-hover:-translate-y-1">
        <defs>
          <clipPath id="${clipId}">
            <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="4.5"/>
          </clipPath>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fde047"/>
            <stop offset="55%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
          <linearGradient id="${vShadeId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
            <stop offset="50%" stop-color="#ffffff" stop-opacity="0"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.24"/>
          </linearGradient>
        </defs>
        <g opacity="${opacity}" transform="${transform}">
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="4.5" fill="${spineFill}"/>
          ${diagonalAccent}
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="4.5" fill="url(#${vShadeId})"/>
          <!-- Frosted pill label backdrop -->
          <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillW / 2}"
            fill="rgba(255,255,255,0.20)" stroke="rgba(255,255,255,0.26)" stroke-width="0.6"/>
          <!-- Crisp border -->
          <rect x="6" y="${yTop}" width="${w}" height="${h}" rx="4.5" fill="none" stroke="${strokeCol}" stroke-width="${strokeW}"/>
          <!-- Labels -->
          <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" unicode-bidi="plaintext"
            transform="rotate(-90 ${cx} ${cy})" font-size="7.2" font-weight="700"
            fill="${isGold ? '#451a03' : '#ffffff'}" opacity="0.96">${window.AppUI.escapeHtml(shortTag)}</text>
          <text x="${cx}" y="${yTop + h - 5}" text-anchor="middle" font-size="7.8" font-weight="700"
            fill="#ffffff" opacity="0.96">${Math.round(book.minutes)}${window.AppUI.escapeHtml(minUnit)}</text>
        </g>
      </svg>
    `;
  }

  function renderBookSVG(book, isSelected) {
    const tag = window.AppUI.getTagById(book.tagId);
    const subj = resolveBookSubject(book);
    const lvl = getBookLevel(book.minutes, book.completed);
    const w = lvl.width;
    const h = lvl.height;
    const svgW = w + 12;
    const svgH = 128;
    // Flush on the shelf (yTop + h === svgH) so books never float above the board
    const yTop = svgH - h;
    const tagColor = tag ? tag.color : '#6366f1';
    const subjColor = book.subjectColor || (subj ? subj.color : null);
    const isGold = !!lvl.gold;
    const isIncomplete = lvl.id === 'incomplete';
    const safeId = String(book.id || 'bk').replace(/[^a-zA-Z0-9_-]/g, '');
    const shortTag = formatSpineLabel(tag ? tag.name : '');
    const cx = 6 + w / 2;
    const cy = yTop + h / 2 - 2;
    const minUnit = t('minShort');

    const opts = { w, h, svgW, svgH, yTop, tagColor, subjColor, isGold, isIncomplete, safeId, shortTag, cx, cy, minUnit, lvl };
    return getShelfStyle() === 'minimal'
      ? renderMinimalBookSVG(book, isSelected, opts)
      : renderClassic3DBookSVG(book, isSelected, opts);
  }

  function renderShelfBoardSVG(idx) {
    const style = getShelfStyle();
    if (style === 'minimal') {
      return `
        <svg class="w-full h-4 block relative z-0" preserveAspectRatio="none" viewBox="0 0 400 16">
          <defs>
            <linearGradient id="oakTop_${idx}" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#ebd0ae"/>
              <stop offset="55%" stop-color="#cfa06e"/>
              <stop offset="100%" stop-color="#a57343"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="400" height="10" rx="3" fill="url(#oakTop_${idx})"/>
          <line x1="2" y1="1" x2="398" y2="1" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
          <rect x="4" y="10" width="392" height="5" rx="2" fill="rgba(0,0,0,0.18)"/>
        </svg>
      `;
    }
    return `
      <svg class="w-full h-4 block relative z-0" preserveAspectRatio="none" viewBox="0 0 400 16">
        <defs>
          <linearGradient id="woodTop_${idx}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#b45309"/>
            <stop offset="50%" stop-color="#92400e"/>
            <stop offset="100%" stop-color="#6c2e0a"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="400" height="11" rx="2.5" fill="url(#woodTop_${idx})"/>
        <line x1="3" y1="1.2" x2="397" y2="1.2" stroke="rgba(254,243,199,0.35)" stroke-width="1"/>
        <line x1="24" y1="5" x2="165" y2="5" stroke="rgba(69,26,3,0.28)" stroke-width="0.9"/>
        <line x1="210" y1="7.5" x2="368" y2="7.5" stroke="rgba(69,26,3,0.28)" stroke-width="0.9"/>
        <rect x="4" y="11" width="392" height="5" rx="2" fill="rgba(0,0,0,0.28)"/>
      </svg>
    `;
  }

  function renderSection() {
    const data = window.AppState.getData();
    const style = getShelfStyle();
    const langKey = (window.I18n && window.I18n.isRTL()) ? 'ar' : 'en';
    const darkKey = window.AppState.getIsDark() ? 'd' : 'l';
    const selKey = multiSelectMode ? ('m:' + [...selectedIds].sort().join(',')) : 'n';
    const todayISO = window.AppState.getLocalTodayISO();
    const booksSig = `${data.books.length}|${data.updatedAt || 0}|${style}|${langKey}|${darkKey}|${selKey}|${visibleShelvesCount}|${shelfPeriod}|${todayISO}|${recentBookId}`;
    if (booksSig === cachedShelfKey && cachedShelfHtml) {
      return cachedShelfHtml;
    }

    const filteredBooks = filterBooksByPeriod(data.books || [], shelfPeriod);
    const books = [...filteredBooks].sort((a, b) => (String(b.date || '') + String(b.createdAt || '')).localeCompare(String(a.date || '') + String(a.createdAt || '')));

    const completedCount = books.filter(b => b.completed).length;
    const totalMinutes = books.reduce((s, b) => s + (b.completed ? b.minutes : 0), 0);

    const shelfSize = 8;
    const shelves = [];
    for (let i = 0; i < books.length; i += shelfSize) {
      shelves.push(books.slice(i, i + shelfSize));
    }

    const visibleShelves = shelves.slice(0, visibleShelvesCount);
    const hiddenShelvesCount = Math.max(0, shelves.length - visibleShelves.length);
    const isArShelf = !!(window.I18n && window.I18n.isRTL());
    const loadMoreBtnHtml = hiddenShelvesCount > 0
      ? `<div class="text-center pt-1"><button id="shelf-load-more" type="button" class="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-200 hover:opacity-85">${isArShelf ? `عرض المزيد (${hiddenShelvesCount} رفوف إضافية)` : `Show More (${hiddenShelvesCount} more shelves)`}</button></div>`
      : '';
    const shelvesHtml = visibleShelves.length
      ? visibleShelves.map((shelfBooks, sIdx) => `
          <div class="mb-4">
            <div class="relative z-10 flex items-end gap-1.5 px-3 pt-2 overflow-x-auto no-scrollbar min-h-[136px]">
              ${shelfBooks.map(book => {
                const tag = window.AppUI.getTagById(book.tagId);
                const subj = resolveBookSubject(book);
                const lvl = getBookLevel(book.minutes, book.completed);
                const isSel = selectedIds.has(book.id);
                const tipParts = [getLevelLabel(lvl), `${Math.round(book.minutes)}${t('minShort')}`];
                const tRange = formatBookTimeRange(book);
                if (tRange) tipParts.push(tRange);
                if (tag) tipParts.push(tag.name);
                if (subj) tipParts.push(subj.name);
                const isNew = book.id === recentBookId;
                const animCls = isNew ? (lvl.gold ? 'book-slide-in book-gold-shimmer' : 'book-slide-in') : '';
                return `
                  <button type="button"
                    data-book-id="${window.AppUI.escapeHtml(book.id)}"
                    style="touch-action:manipulation;"
                    title="${window.AppUI.escapeHtml(tipParts.join(' • '))}"
                    class="book-item ${animCls} group relative flex flex-col items-center focus:outline-none cursor-pointer">
                    ${renderBookSVG(book, isSel)}
                  </button>
                `;
              }).join('')}
            </div>
            ${renderShelfBoardSVG(sIdx)}
          </div>
        `).join('')
      : `
        <div class="text-center py-8 px-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <p class="text-sm text-slate-500 dark:text-slate-400">${t('noBooksYet')}</p>
        </div>
      `;

    const outHtml = `
      <div id="bookshelf-card" class="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div class="flex items-center gap-1.5">
              <h3 class="text-base font-bold text-slate-800 dark:text-slate-100">${t('bookshelfTitle', { n: completedCount })}</h3>
              ${window.AppUI.infoButtonHtml('info-shelf-btn')}
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">${t('hrsCompleted', { h: window.AppUI.formatHours(totalMinutes / 60) })}</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button id="shelf-style-toggle" type="button" title="${window.AppUI.escapeHtml(t('shelfStyleToggleTitle'))}" class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              ${style === 'minimal' ? t('shelfStyleMinimal') : t('shelfStyleClassic')}
            </button>
            ${multiSelectMode && books.length > 0 ? `
              <button id="shelf-select-all" type="button" class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                ${selectedIds.size === books.length ? t('none') : t('all')}
              </button>
            ` : ''}
            ${multiSelectMode && selectedIds.size > 0 ? `
              <button id="shelf-delete-selected" type="button" class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-700">
                ${t('deleteSelectedCount', { n: selectedIds.size })}
              </button>
            ` : ''}
            ${books.length > 0 ? `
              <button id="shelf-toggle-select" type="button" class="px-2.5 py-1.5 rounded-lg text-xs font-medium ${multiSelectMode ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}">
                ${multiSelectMode ? t('cancel') : t('select')}
              </button>
            ` : ''}
          </div>
        </div>

        <div class="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl mb-3 gap-1">
          ${[
            { id: 'day', ar: 'اليوم', en: 'Day' },
            { id: 'week', ar: 'الأسبوع', en: 'Week' },
            { id: 'month', ar: 'الشهر', en: 'Month' },
            { id: 'year', ar: 'السنة', en: 'Year' }
          ].map(p => `
            <button type="button" data-shelf-period="${p.id}"
              class="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition ${shelfPeriod === p.id ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}">
              ${isArShelf ? p.ar : p.en}
            </button>
          `).join('')}
        </div>

        <div id="bookshelf-shelves-wrap">${shelvesHtml}${loadMoreBtnHtml}</div>
      </div>
    `;
    cachedShelfKey = booksSig;
    cachedShelfHtml = outHtml;
    return outHtml;
  }

  function bindEvents(onChanged) {
    document.querySelectorAll('[data-shelf-period]').forEach(btn => {
      btn.onclick = () => {
        const nextPeriod = btn.getAttribute('data-shelf-period');
        if (nextPeriod && nextPeriod !== shelfPeriod) {
          shelfPeriod = nextPeriod;
          visibleShelvesCount = 3;
          cachedShelfKey = '';
          selectedIds.clear();
          multiSelectMode = false;
          if (onChanged) onChanged();
        }
      };
    });

    const moreBtn = document.getElementById('shelf-load-more');
    if (moreBtn) {
      moreBtn.onclick = () => {
        visibleShelvesCount += 3;
        cachedShelfKey = '';
        if (onChanged) onChanged();
      };
    }

    const infoBtn = document.getElementById('info-shelf-btn');
    if (infoBtn) {
      infoBtn.onclick = () => {
        window.AppUI.showInfo(t('shelfInfoTitle'), t('shelfInfoBody'));
      };
    }

    const styleBtn = document.getElementById('shelf-style-toggle');
    if (styleBtn) {
      styleBtn.onclick = () => {
        const data = window.AppState.getData();
        if (!data.settings) data.settings = {};
        data.settings.shelfStyle = getShelfStyle() === 'minimal' ? 'classic3d' : 'minimal';
        window.AppState.save();
        if (onChanged) onChanged();
      };
    }

    const toggleBtn = document.getElementById('shelf-toggle-select');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        multiSelectMode = !multiSelectMode;
        selectedIds.clear();
        if (onChanged) onChanged();
      };
    }

    const selectAllBtn = document.getElementById('shelf-select-all');
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        const visibleBooks = filterBooksByPeriod(window.AppState.getData().books || [], shelfPeriod);
        const allVisibleSelected = visibleBooks.length > 0 && visibleBooks.every(b => selectedIds.has(b.id));
        if (allVisibleSelected) {
          selectedIds.clear();
        } else {
          selectedIds = new Set(visibleBooks.map(b => b.id));
        }
        if (onChanged) onChanged();
      };
    }

    const delSelBtn = document.getElementById('shelf-delete-selected');
    if (delSelBtn) {
      delSelBtn.onclick = () => {
        const count = selectedIds.size;
        window.AppUI.confirmAction({
          title: t('deleteBooksTitle'),
          message: t('deleteBooksMsg', { n: count }),
          confirmText: t('deleteAll'),
          danger: true,
          onConfirm: () => {
            deleteBooks(Array.from(selectedIds));
            selectedIds.clear();
            multiSelectMode = false;
            window.AppUI.showToast(t('deletedBooksToast', { n: count }), 'success');
            if (onChanged) onChanged();
          }
        });
      };
    }

    const wrap = document.getElementById('bookshelf-shelves-wrap');
    if (wrap) {
      wrap.onclick = (e) => {
        const btn = e.target.closest('.book-item');
        if (!btn) return;
        const id = btn.getAttribute('data-book-id');
        if (!id) return;
        if (multiSelectMode) {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          if (onChanged) onChanged();
        } else {
          openEditBookModal(id, onChanged);
        }
      };
    }
  }

  function deleteBooks(ids) {
    const data = window.AppState.getData();
    const idSet = new Set(ids);
    const toRemove = data.books.filter(b => idSet.has(b.id));
    toRemove.forEach(b => {
      const tag = window.AppUI.getTagById(b.tagId);
      if (b.completed && tag && tag.countsForChallenge) {
        window.LedgerEngine.addStudyMinutesToDate(b.date, -b.minutes, true);
      }
    });
    data.books = data.books.filter(b => !idSet.has(b.id));
    window.AppState.markDeleted(ids);
    window.AppState.markLedgerDirty();
    window.AppState.save();
  }

  function openEditBookModal(bookId, onChanged) {
    const data = window.AppState.getData();
    const book = data.books.find(b => b.id === bookId);
    if (!book) return;

    const lvl = getBookLevel(book.minutes, book.completed);
    const pendingTasks = [];
    const currentSubj = resolveBookSubject(book);
    const currentSubjId = book.subjectId || (currentSubj ? currentSubj.id : '');

    const tagsOptions = data.tags.map(tg =>
      `<option value="${window.AppUI.escapeHtml(tg.id)}" ${tg.id === book.tagId ? 'selected' : ''}>${window.AppUI.escapeHtml(tg.name)}</option>`
    ).join('');

    const subjOptions = `<option value="">${window.AppUI.escapeHtml(t('noSubject'))}</option>` + data.subjects.map(s =>
      `<option value="${window.AppUI.escapeHtml(s.id)}" ${s.id === currentSubjId ? 'selected' : ''}>${window.AppUI.escapeHtml(s.name)}</option>`
    ).join('');

    const suggestionsHtml = pendingTasks.length
      ? `
        <div class="mt-2">
          <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            ${pendingTasks.map(tk => `
              <button type="button" class="task-suggest-chip px-2 py-1 rounded-lg text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800"
                data-task-id="${window.AppUI.escapeHtml(tk.id)}"
                data-task-subj="${window.AppUI.escapeHtml(tk.subjectId || '')}"
                data-task-title="${window.AppUI.escapeHtml(tk.title)}">
                ${window.AppUI.escapeHtml(tk.title)}
              </button>
            `).join('')}
          </div>
        </div>
      `
      : '';

    window.AppUI.openModal({
      title: t('editBookTitle', { lvl: getLevelLabel(lvl), m: Math.round(book.minutes) }),
      bodyHtml: `
        <div class="space-y-3">
          ${(() => {
            const { startMs, endMs } = getBookTimestamps(book);
            const ar = !!(window.I18n && window.I18n.isRTL());
            return `
          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('dateLabel')}</label>
            <input id="edit-book-date" type="date" value="${window.AppUI.escapeHtml(book.date)}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"/>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${ar ? 'وقت البداية' : 'Start Time'}</label>
              <input id="edit-book-start" type="time" value="${window.AppUI.escapeHtml(toTimeInputVal(startMs))}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${ar ? 'وقت النهاية' : 'End Time'}</label>
              <input id="edit-book-end" type="time" value="${window.AppUI.escapeHtml(toTimeInputVal(endMs))}" class="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"/>
            </div>
          </div>`;
          })()}
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('tagLabel')}</label>
              <select id="edit-book-tag" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs">
                ${tagsOptions}
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('subjectLabel')}</label>
              <select id="edit-book-subject" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs">
                ${subjOptions}
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">${t('noteLabel')}</label>
            <input id="edit-book-task" type="text" value="${window.AppUI.escapeHtml(book.taskTitle || '')}" placeholder="${window.AppUI.escapeHtml(t('taskNotePlaceholder'))}" class="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"/>
            <input id="edit-book-task-id" type="hidden" value="${window.AppUI.escapeHtml(book.taskId || '')}"/>
            ${suggestionsHtml}
          </div>
        </div>
      `,
      footerHtml: `
        <button id="edit-book-delete" class="px-3 py-2 rounded-xl text-sm font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 hover:bg-rose-200 mr-auto">${t('delete')}</button>
        <button id="edit-book-cancel" class="px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${t('cancel')}</button>
        <button id="edit-book-save" class="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">${t('save')}</button>
      `
    });

    const editBookTaskInput = document.getElementById('edit-book-task');
    if (editBookTaskInput) {
      editBookTaskInput.oninput = () => {
        document.getElementById('edit-book-task-id').value = '';
      };
    }

    document.querySelectorAll('.task-suggest-chip').forEach(chip => {
      chip.onclick = () => {
        document.getElementById('edit-book-task').value = chip.getAttribute('data-task-title');
        document.getElementById('edit-book-task-id').value = chip.getAttribute('data-task-id');
        const tkSubj = chip.getAttribute('data-task-subj');
        if (tkSubj) {
          document.getElementById('edit-book-subject').value = tkSubj;
        }
      };
    });

    document.getElementById('edit-book-cancel').onclick = window.AppUI.closeModal;

    document.getElementById('edit-book-delete').onclick = () => {
      window.AppUI.closeModal();
      deleteBooks([book.id]);
      window.AppUI.showToast(t('bookDeletedToast'), 'success');
      if (onChanged) onChanged();
    };

    document.getElementById('edit-book-save').onclick = () => {
      const newDate = document.getElementById('edit-book-date').value || book.date;
      const newTagId = document.getElementById('edit-book-tag').value;
      const newSubjectId = document.getElementById('edit-book-subject').value;
      const newTaskTitle = document.getElementById('edit-book-task').value.trim();
      const newTaskId = document.getElementById('edit-book-task-id').value;

      const oldTag = window.AppUI.getTagById(book.tagId);
      const newTag = window.AppUI.getTagById(newTagId);

      if (book.completed) {
        if (oldTag && oldTag.countsForChallenge) {
          window.LedgerEngine.addStudyMinutesToDate(book.date, -book.minutes, true);
        }
        if (newTag && newTag.countsForChallenge) {
          window.LedgerEngine.addStudyMinutesToDate(newDate, book.minutes, true);
        }
      }

      book.date = newDate;
      book.tagId = newTagId;
      book.subjectId = newSubjectId;
      delete book.subjectColor;
      book.taskTitle = newTaskTitle;
      book.taskId = newTaskId;
      const sVal = document.getElementById('edit-book-start') ? document.getElementById('edit-book-start').value : '';
      const eVal = document.getElementById('edit-book-end') ? document.getElementById('edit-book-end').value : '';
      if (sVal && newDate) {
        const [y, m, d] = newDate.split('-').map(Number);
        const [sh, sm] = sVal.split(':').map(Number);
        book.startedAt = new Date(y, m - 1, d, sh, sm, 0, 0).getTime();
      }
      if (eVal && newDate) {
        const [y, m, d] = newDate.split('-').map(Number);
        const [eh, em] = eVal.split(':').map(Number);
        let endTs = new Date(y, m - 1, d, eh, em, 0, 0).getTime();
        if (book.startedAt && endTs < book.startedAt) endTs += 86400000;
        book.endedAt = endTs;
      }
      window.AppState.markLedgerDirty();
      window.AppState.save();
      window.AppUI.closeModal();
      window.AppUI.showToast(t('bookUpdatedToast'), 'success');
      if (onChanged) onChanged();
    };
  }

  return {
    getShelfStyle,
    getBookLevel,
    renderBookSVG,
    renderSection,
    bindEvents,
    markNewlyAddedBook,
    formatBookTimeRange
  };
})();
