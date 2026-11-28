/**
 * config.js — Central configuration and constants for Academic Study Tracker (6-Month Challenge)
 */
window.APP_CONFIG = {
  APP_NAME: 'Study Tracker',
  APP_VERSION: '3.2.0',
  STORAGE_KEY: 'study_tracker_6m_en_v1',
  THEME_KEY: 'study_tracker_theme',
  LANG_KEY: 'study_tracker_lang',
  
  
  // 6-Month Challenge Rules (26 Weeks / 182 Days / 1,066 Hours)
  CHALLENGE: {
    TOTAL_DAYS: 182,
    TOTAL_WEEKS: 26,
    TOTAL_MONTHS: 6,
    WEEKLY_TARGET_HOURS: 41,
    TOTAL_TARGET_HOURS: 1066,
    WEEKLY_FLEX_HOURS: 7,
    DAILY_GRACE_HOURS: 0.5,
    PENALTY_THRESHOLD_HOURS: 14,
    // Daily target hours by weekday (0 = Sun ... 6 = Sat)
    DAILY_TARGETS: {
      6: 8.0, // Saturday
      0: 5.5, // Sunday
      1: 5.5, // Monday
      2: 5.5, // Tuesday
      3: 5.5, // Wednesday
      4: 4.0, // Thursday
      5: 7.0 // Friday
    },
    DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    DAY_NAMES_AR: ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
  },
  
  // Default focus tags (only 'study' automatically adds hours to the 6-month challenge)
  DEFAULT_TAGS: [
    { id: 'study', name: '🏆 6M Challenge (Study)', color: '#6366f1', countsForChallenge: true },
    { id: 'anki', name: '🧠 Anki Review', color: '#0ea5e9', countsForChallenge: false },
    { id: 'reading', name: '📖 Reading', color: '#10b981', countsForChallenge: false },
    { id: 'research', name: '🔬 Research', color: '#f59e0b', countsForChallenge: false },
    { id: 'skill', name: '💻 Skills', color: '#ec4899', countsForChallenge: false }
  ],
  
  // Default study subjects
  DEFAULT_SUBJECTS: [
    { id: 'subj_anat', name: 'Anatomy', color: '#6366f1' },
    { id: 'subj_phys', name: 'Physiology', color: '#0ea5e9' },
    { id: 'subj_path', name: 'Pathology', color: '#f43f5e' },
    { id: 'subj_pharm', name: 'Pharmacology', color: '#10b981' },
    { id: 'subj_usmle', name: 'USMLE Prep', color: '#f59e0b' }
  ],
  
  // 4 visual book levels + incomplete session
  BOOK_LEVELS: [
    { id: 'incomplete', minMinutes: 0, maxMinutes: 4.99, label: 'Incomplete', labelAr: 'غير مكتمل', width: 18, height: 64, tilted: true },
    { id: 'booklet', minMinutes: 5, maxMinutes: 24.99, label: 'Booklet', labelAr: 'كتيّب', width: 20, height: 76, tilted: false },
    { id: 'book', minMinutes: 25, maxMinutes: 49.99, label: 'Book', labelAr: 'كتاب', width: 26, height: 92, tilted: false },
    { id: 'reference', minMinutes: 50, maxMinutes: 74.99, label: 'Reference', labelAr: 'مرجع', width: 32, height: 106, tilted: false },
    { id: 'encyclopedia', minMinutes: 75, maxMinutes: Infinity, label: 'Golden Encyclopedia', labelAr: 'موسوعة ذهبية', width: 38, height: 118, tilted: false, gold: true }
  ],
  
  PRIORITIES: {
    high: { label: 'High', labelAr: 'عالية', badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
    medium: { label: 'Medium', labelAr: 'متوسطة', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    low: { label: 'Normal', labelAr: 'عادية', badgeClass: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
  }
};