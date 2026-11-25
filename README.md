# Academic Study Tracker — 6-Month Challenge (182 Days / 1,066 Hours)

An offline-first interactive web app built with **HTML + Local CSS + Vanilla JavaScript**, split into **16 modular files**. Runs 100% locally in the browser via `localStorage` with instant dark mode, inline SVG bookshelf, and Telegram Mini App support.

## Project Structure (16 Files)
1. `index.html` — Entry page with instant dark mode and zero blocking external requests.
2. `css/styles.css` — Precompiled local utility CSS for instant startup.
3. `README.md` — Project documentation.
4. `js/config.js` — Central configuration (`APP_CONFIG`).
5. `js/state.js` — State management, local date helper (`getLocalTodayISO`), and `localStorage` persistence.
6. `js/ledger.js` — 182-day / 26-week challenge calculation engine with `ledgerDirty` caching, 7h weekly flex, hour bank, and 14h deficit penalty alert.
7. `js/ui.js` — Toasts, modals, and `ⓘ` info tooltips.
8. `js/bookshelf.js` — Inline SVG bookshelf (4 book tiers, vertical tag labels on spines, edit/multi-delete).
9. `js/focus.js` — Pomodoro timer (5–90m + 0m quick test) and Stopwatch (5m minimum).
10. `js/tasks.js` — Study task manager with subjects, priorities, and bookshelf quick suggestions.
11. `js/habits.js` — Daily habit tracker with streaks, weekly compliance, and 7-day strip.
12. `js/stats.js` — Monthly (6m), weekly (26w), and tag distribution SVG charts.
13. `js/reviews.js` — Monthly (1–6), Quarterly (Q1–Q2), and Final Challenge reviews.
14. `js/challenge.js` — Challenge dashboard and 182-day log.
15. `js/settings.js` — Start date, subjects, custom tags, demo data, and JSON backup/restore.
16. `js/app.js` — Main controller, 6-tab navigation, and background Telegram Mini App loader.
