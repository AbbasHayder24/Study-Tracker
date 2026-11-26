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
    const { w, h, tagColor, subjColor, isGold, isIncomplete, shortTag, minUnit, lvl } = opts;
    const baseBg = isGold
      ? 'linear-gradient(90deg, #fef08a 0%, #f59e0b 32%, #d97706 76%, #92400e 100%)'
      : `linear-gradient(90deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.06) 24%, rgba(0,0,0,0.06) 72%, rgba(0,0,0,0.34) 100%), ${window.AppUI.escapeHtml(tagColor)}`;
    const borderCss = isSelected ? '2px solid #f43f5e' : (isGold ? '1px solid #92400e' : '1px solid rgba(15,23,42,0.32)');
    const showRibbon = !isIncomplete && (lvl.id === 'encyclopedia' || lvl.id === 'reference');
    const safeSubj = subjColor ? window.AppUI.escapeHtml(subjColor) : '';
    const textColor = isGold ? '#451a03' : '#ffffff';

    return `
      <div class="css-book-wrap" style="width:${w + 6}px;height:128px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;pointer-events:none;${isIncomplete ? 'opacity:0.48;transform:rotate(-8deg);transform-origin:bottom center;' : ''}">
        <div style="width:${w - 4}px;height:5px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#fffbeb,#e7dcc2);border:0.6px solid rgba(120,53,15,0.28);border-bottom:0;margin-bottom:-1px"></div>
        <div style="position:relative;width:${w}px;height:${h}px;border-radius:3px;background:${baseBg};border:${borderCss};box-shadow:1px 2px 4px rgba(15,23,42,0.16);display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:visible">
          ${safeSubj ? `<div style="position:absolute;top:0;left:0;right:0;height:12px;background:${safeSubj};border-radius:2px 2px 0 0;opacity:0.92"></div><div style="position:absolute;bottom:0;left:0;right:0;height:15px;background:${safeSubj};border-radius:0 0 2px 2px;opacity:0.92"></div>` : ''}
          <div style="position:relative;z-index:1;width:100%;height:2px;margin-top:11px;background:rgba(255,255,255,0.55);border-bottom:1px solid rgba(0,0,0,0.22)"></div>
          <span style="position:relative;z-index:1;writing-mode:vertical-rl;transform:rotate(180deg);font-size:8px;font-weight:700;color:${textColor};line-height:1;white-space:nowrap;overflow:hidden;max-height:${Math.max(24, h - 34)}px">${window.AppUI.escapeHtml(shortTag)}</span>
          <div style="position:relative;z-index:1;width:100%;text-align:center;border-top:1px solid rgba(255,255,255,0.5);padding:1px 0 2px;font-size:7.5px;font-weight:800;color:#ffffff;line-height:1">${Math.round(book.minutes)}${window.AppUI.escapeHtml(minUnit)}</div>
          ${showRibbon ? `<div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);width:6px;height:8px;background:${isGold ? '#dc2626' : '#f59e0b'};clip-path:polygon(0 0,100% 0,100% 100%,50% 68%,0 100%)"></div>` : ''}
        </div>
      </div>
    `;
  }

  function renderMinimalBookSVG(book, isSelected, opts) {
    const { w, h, tagColor, subjColor, isGold, isIncomplete, shortTag, minUnit } = opts;
    const baseBg = isGold
      ? 'linear-gradient(180deg, #fde047 0%, #f59e0b 55%, #b45309 100%)'
      : `linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.22) 100%), ${window.AppUI.escapeHtml(tagColor)}`;
    const borderCss = isSelected ? '2px solid #f43f5e' : '1px solid rgba(255,255,255,0.2)';
    const safeSubj = subjColor ? window.AppUI.escapeHtml(subjColor) : '';
    const textColor = isGold ? '#451a03' : '#ffffff';

    return `
      <div class="css-book-wrap" style="width:${w + 6}px;height:128px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;pointer-events:none;${isIncomplete ? 'opacity:0.46;transform:rotate(-8deg);transform-origin:bottom center;' : ''}">
        <div style="position:relative;width:${w}px;height:${h}px;border-radius:4.5px;background:${baseBg};border:${borderCss};box-shadow:0 2px 4px rgba(15,23,42,0.14);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:4px 0 3px;overflow:hidden">
          ${safeSubj ? `<div style="position:absolute;top:0;left:0;width:100%;height:18px;background:${safeSubj};clip-path:polygon(0 0,100% 0,0 100%);opacity:0.95"></div>` : ''}
          <div style="height:4px"></div>
          <span style="position:relative;z-index:1;writing-mode:vertical-rl;transform:rotate(180deg);font-size:7.5px;font-weight:700;color:${textColor};padding:4px 2px;border-radius:9999px;background:rgba(255,255,255,0.20);line-height:1;white-space:nowrap;max-height:${Math.max(26, h - 30)}px;overflow:hidden">${window.AppUI.escapeHtml(shortTag)}</span>
          <span style="position:relative;z-index:1;font-size:7.5px;font-weight:800;color:#ffffff;line-height:1">${Math.round(book.minutes)}${window.AppUI.escapeHtml(minUnit)}</span>
        </div>
      </div>
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