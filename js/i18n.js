/**
 * i18n.js — Bilingual English / Arabic dictionary with instant RTL/LTR switching
 */
window.I18n = (function () {
  const C = window.APP_CONFIG;
  let currentLang = 'en';
  let langPref = 'auto'; // 'auto' | 'ar' | 'en'

  const DICT = {
    en: {
      appTitle: 'Study Tracker',
      todayShort: 'Today',
      syncNowTitle: 'Sync now',
      toggleThemeTitle: 'Toggle theme',
      toggleLangTitle: 'Switch language',
      syncedLatest: 'Synced latest data ☁️',
      tab_focus: 'Focus',
      tab_hall: 'Hall',
      tab_tasks: 'Tasks',
      tab_habits: 'Habits',
      tab_stats: 'Stats',
      tab_challenge: 'Plan',
      tab_settings: 'Settings',

      // Common
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      deleteAll: 'Delete All',
      edit: 'Edit',
      add: 'Add',
      all: 'All',
      none: 'None',
      select: 'Select',
      gotIt: 'Got it',
      confirm: 'Confirm',
      hrs: 'h',
      minShort: 'm',

      // Focus
      focusSession: '⏱️ Focus Session',
      quickTest: '⚡ 0m Test',
      pomodoro: '⏱️ Pomodoro',
      stopwatch: '♾️ Stopwatch',
      paused: 'Paused',
      quickTestSub: '5s quick test',
      minLabel: '{m} min',
      countingUp: 'Counting up',
      tagLabel: 'Tag',
      subjectLabel: 'Subject',
      taskLabel: 'Task',
      noSubject: '— No subject —',
      noTask: '— No task —',
      startFocus: '▶ Start Focus',
      resume: '▶ Resume',
      pause: '⏸ Pause',
      finish: '⏹ Finish',
      stop: '⏹ Stop',
      focusInfoTitle: '⏱️ Focus Timer Rules',
      focusInfoBody: '<p><strong>Pomodoro:</strong> Pick 5–90 minutes, or tap <strong>⚡ 0m Test</strong> for a 5-second demo (plays a chime when done).</p><p><strong>Stopwatch:</strong> Counts up; under 5 minutes saves as an incomplete book, 5+ minutes completes.</p><p><strong>Subject or Task:</strong> Link your session to a Subject or a Task so your book displays both Tag and Subject colors on the shelf.</p><p><strong>Synced:</strong> Uses cloud timestamps so switching phones keeps the timer in sync.</p>',
      notifCompleteTitle: 'Focus Session Complete! 🏆',
      notifCompleteChallenge: 'Added {m}m book and logged to your 6-Month Challenge.',
      toastCompleteChallenge: 'Added {m}m book & logged to 6M Challenge 🏆',
      notifCompleteShelfTitle: 'Focus Session Complete! 📚',
      notifCompleteShelf: 'Added a {m}m book to your shelf.',
      toastCompleteShelf: 'New book added to your shelf 📚',
      toastIncomplete: 'Incomplete session (<5 min)',

      // Bookshelf
      bookshelfTitle: '📚 Bookshelf ({n})',
      hrsCompleted: '{h} hrs completed',
      noBooksYet: 'No books yet',
      deleteSelectedCount: 'Delete ({n})',
      shelfInfoTitle: '📚 Bookshelf Tiers & Two-Tone Colors',
      shelfInfoBody: '<p>Each book grows by session duration and shows <strong>two colors</strong>: the main spine uses your <strong>Tag</strong> color, and the top &amp; bottom bands use your <strong>Subject</strong> color.</p><p>• <strong>Booklet:</strong> 5 – 24 min</p><p>• <strong>Book:</strong> 25 – 49 min</p><p>• <strong>Reference:</strong> 50 – 74 min</p><p>• <strong>Golden Encyclopedia:</strong> 75+ min</p><p>• <strong>Tilted faded book:</strong> incomplete session (&lt;5 min).</p><p>Tap any book to edit or delete it, or use <strong>Select</strong> for bulk delete.</p>',
      deleteBooksTitle: 'Delete Selected Books',
      deleteBooksMsg: 'Delete {n} selected book(s) from the shelf?',
      deletedBooksToast: 'Deleted {n} book(s)',
      editBookTitle: 'Edit Book ({lvl} — {m}m)',
      dateLabel: 'Date',
      taskNotePlaceholder: 'Pick a task or type a note',
      bookDeletedToast: 'Book deleted',
      bookUpdatedToast: 'Book updated',

      // Tasks
      studyTasks: '✅ Study Tasks',
      doneSummary: 'Done: {done}/{total} ({rate}%)',
      addTaskPlaceholder: 'Add a new study task...',
      highPriority: 'High Priority',
      mediumPriority: 'Medium Priority',
      lowPriority: 'Normal Priority',
      addTaskBtn: '+ Add Task',
      allCount: 'All ({n})',
      pendingCount: 'Pending ({n})',
      completedCount: 'Completed ({n})',
      allSubjects: 'All Subjects',
      noMatchingTasks: 'No matching tasks.',
      taskAddedToast: 'Task added',

      // Habits
      dailyHabits: '🔥 Daily Habits',
      weeklyPct: 'Weekly: {p}%',
      addHabitPlaceholder: 'Add a new daily habit...',
      streakLabel: 'Streak:',
      daysShort: 'd',
      sevenDayLabel: '7-day:',
      noHabitsYet: 'No habits yet.',
      habitAddedToast: 'Habit added',

      // Stats
      dailyAvg: 'Daily Avg',
      bestWeek: 'Best Week',
      tasksDone: 'Tasks Done',
      habitsRate: 'Habits Rate',
      monthlyProgress: '📊 Monthly Progress (6m)',
      weeklyProgress: '📈 Weekly Progress (26w)',
      focusByTag: '🏷️ Focus by Tag',
      booksWord: 'books',
      statsMonthlyInfo: '<p>Compares logged hours (indigo bar) against the monthly target (gray background bar) across all 6 challenge months.</p>',
      statsWeeklyInfo: '<p>The dashed amber line marks the 41h weekly target. Green bars met or exceeded the target; indigo bars are in progress.</p>',

      // Challenge
      summaryTab: 'Summary',
      logTab: '182-Day Log',
      reviewsTab: 'Reviews',
      challengeTitle: '🎯 Study Plan',
      loggedLabel: 'Logged:',
      goalLabel: 'Goal:',
      todayHeader: '📅 Today ({day})',
      dayOfWeek: 'Day {d} / {total} • Week {w}',
      outsideRange: 'Outside challenge range',
      hourBank: 'Hour Bank',
      deficitLabel: 'Deficit',
      flexUsed: 'Flex Used',
      penaltyAlertText: '⚠️ <strong>Penalty Alert{bw}:</strong> Bi-weekly deficit exceeded {lim}h ({h}h).',
      all182Days: 'All 182 Days',
      weekOption: 'Week {w} ({logged} / {target}h)',
      dayBadgeToday: 'Today',
      dayRowMeta: 'Day {d} • {day}',
      weekNum: 'Week {w}',
      upcoming: 'Upcoming',
      graceOk: 'Grace ✓',
      challengeInfoTitle: '🏆 6-Month Challenge Rules',
      challengeInfoBody: '<p><strong>Total Goal:</strong> 1,066 hours across 26 weeks (182 days) at 41 hours/week.</p><p><strong>Daily Targets:</strong> Sat 8h, Sun–Wed 5.5h, Thu 4h, Fri 7h.</p><p><strong>0.5h Daily Grace:</strong> Finishing within 30 min of your daily target does not count as deficit.</p><p><strong>Flex &amp; Bi-Weekly Deficit:</strong> You get 7h weekly flexibility before drawing from your permanent <strong>Hour Bank</strong> or adding to your <strong>2-Week Deficit</strong> (resets every 2 weeks; penalty alert triggers above 14h).</p>',
      editDayTitle: 'Edit {day} ({date})',
      dailyTargetText: 'Daily target:',
      loggedHoursLabel: 'Logged Hours',
      noteLabel: 'Note',
      notePlaceholder: 'Optional note...',
      dayLogUpdated: 'Day log updated',

      // Reviews
      weeksRange: 'Weeks {s}–{e}',
      biWeeklyTitle: 'Bi-Weekly Review #{n} (W{s}–W{e})',
      finalGroup: 'Final Summary',
      finalTitle: '6-Month Challenge Finale (182 Days)',
      noReviewNotes: 'No review notes yet',
      editReviewBtn: '⭐ {r}/5 • Edit',
      writeReviewBtn: 'Write Review',
      consistencyRating: 'Consistency Rating (1–5)',
      keyLessons: 'Key Lessons & Next Steps',
      reviewPlaceholder: 'Write your review notes...',
      reviewSaved: 'Review saved',

      // Settings
      languageTitle: '🌐 Language / اللغة',
      smartAutoSync: '☁️ Smart Auto-Sync',
      syncedAt: 'Synced {t}',
      connected: 'Connected',
      off: 'Off',
      tokenPlaceholder: 'Paste GitHub Token (gist scope)',
      syncNowBtn: '🔄 Sync Now',
      connectSyncBtn: '☁️ Connect & Sync',
      disconnect: 'Disconnect',
      howItWorks: 'How it works',
      notifSoundTitle: '🔔 Notifications & Sound',
      soundOn: '🔊 Sound: ON',
      soundOff: '🔇 Sound: OFF',
      testChime: '🎵 Test Chime',
      notifActive: '✅ Browser Notifications Active',
      enableNotif: '🔔 Enable Browser Notifications',
      pushSectionLabel: 'Background Push (When App Is Closed)',
      pushWorkerPlaceholder: 'https://study-tracker-push.yourname.workers.dev',
      pushEnableBtn: '🚀 Enable Background Push',
      pushActiveBtn: '✅ Background Push Active (Tap to Disable)',
      pushTestBtn: '🧪 Test Push (5s)',
      pushTestScheduled: 'Test push scheduled! Lock your phone — arrives in 5s 🔔',
      pushTestTitle: 'Study Tracker Test 🔔',
      pushTestBody: 'Background notifications are working even while the app is closed!',
      pushEnabledToast: 'Background push enabled! 🚀',
      pushDisabledToast: 'Background push disabled',
      pushIosNeedHomeScreen: 'On iPhone/iPad, open Study Tracker from your Home Screen icon first',
      pushNeedWorkerUrl: 'Enter your Cloudflare Worker URL (https://...) first',
      pushSwFailed: 'Could not register Service Worker',
      pushWorkerUnreachable: 'Could not reach Push Worker URL — check deployment & URL',
      pushWorkerNoKey: 'Worker is missing VAPID_PUBLIC_KEY secret',
      pushNotSubscribed: 'Enable Background Push first before testing',
      startDateTitle: '📅 Challenge Start Date',
      newDayStartsAt: '🌙 New Day Starts At',
      midnightDefault: '12:00 AM (Default)',
      hourAm: '{h}:00 AM',
      subjectsTitle: '📚 Subjects',
      newSubjectPlaceholder: 'New subject name...',
      customTagsTitle: '🏷️ Custom Tags',
      newTagPlaceholder: 'New tag name...',
      coreBadge: 'Core',
      backupTitle: '💾 Backup & Restore (JSON)',
      downloadJson: '⬇ Download JSON',
      copyJson: '📋 Copy JSON',
      pasteJsonPlaceholder: 'Or paste JSON backup here...',
      restoreFromText: 'Restore from Text',
      dataMgmtTitle: '🧪 Data Management',
      loadDemo: 'Load Demo Data',
      resetAll: 'Reset All Data',
      syncInfoTitle: '☁️ Smart Auto-Sync (1-Step Setup)',
      syncInfoBody: '<p><strong>No Gist ID needed:</strong> Paste your GitHub Personal Access Token (with only the <strong>gist</strong> scope) on each device and tap <strong>Connect &amp; Sync</strong>.</p><p><strong>Smart Merge:</strong> Active timer, books, tasks, habits, and daily logs merge automatically across devices.</p><p><strong>Auto-Refresh:</strong> Syncs automatically when returning to the app and every 10s while Focus is open.</p>',
      notifInfoBody: '<p>Plays a soft chime and triggers a browser notification when a Focus session finishes. On iPhone/iPad, browser notifications require adding the site to your Home Screen via Safari.</p>',
      tagsInfoBody: '<p>Edit any tag name or color inline—existing books update automatically. The core Study tag cannot be deleted because it tracks 6-month challenge hours.</p>',
      backupInfoBody: '<p>Exports your 182-day log, tasks, habits, bookshelf, reviews, tags, and subjects into one JSON file so you can move or restore your data on any device.</p>',
      dayStartInfoBody: '<p>Delays when a new study day begins (like Anki). For example, if set to <strong>4:00 AM</strong>, studying at 1:30 AM still logs to the previous day across Focus, Bookshelf, Habits, and Challenge.</p>',
      pasteTokenFirst: 'Please paste your GitHub Token first',
      syncingToast: 'Syncing...',
      syncDisconnected: 'Auto-sync disconnected',
      chimePlayed: 'Chime played 🎵',
      dayStartSaved: 'New day start hour saved',
      startDateUpdated: 'Start date updated',
      subjectAdded: 'Subject added',
      tagAdded: 'Tag added',
      tagNameUpdated: 'Tag name updated',
      tagColorUpdated: 'Tag color updated',
      tagDeleted: 'Tag deleted',
      backupDownloaded: 'Backup file downloaded',
      jsonCopied: 'JSON copied to clipboard',
      backupRestored: 'Backup restored!',
      invalidJson: 'Invalid JSON format',
      loadDemoMsg: 'Replace current data with 33 days of sample logs, books, tasks, and habits?',
      loadDemoConfirm: 'Load Demo',
      demoLoaded: 'Demo data loaded',
      resetAllMsg: 'Permanently erase all logs, tasks, habits, and books?',
      resetAllConfirm: 'Reset All',
      allCleared: 'All data cleared',
      notifNotSupported: 'Browser notifications are not supported here',
      notifEnabled: 'Notifications enabled! 🔔',
      notifDenied: 'Notification permission was not granted',
      notifError: 'Could not enable notifications in this view',
      syncedToCloud: 'Synced to cloud ☁️',
      offlineAutoSync: 'Offline — will auto-sync when back online',
      mergedAndSynced: 'Merged & synced ☁️',
      upToDate: 'Everything is up to date ☁️',
      shelfStyleClassic: '🎨 3D',
      shelfStyleMinimal: '✨ Minimal',
      shelfStyleToggleTitle: 'Switch bookshelf style',
      editChallengeTitle: '⚙️ Edit Challenge',
      challengeNameLabel: 'Challenge Name (Optional)',
      startDateShort: 'Start Date',
      durationWeeksLabel: 'Duration (Weeks)',
      dailyTargetsLabel: 'Daily Target Hours (Sat – Fri)',
      weeklyFlexLabel: 'Weekly Flex (h)',
      dailyGraceLabel: 'Daily Grace (h)',
      penaltyLimitLabel: '2W Alert (h)',
      resetDefaults: 'Defaults',
      challengePreviewLine: '{days} days • {wk}h/week • {total}h total',
      challengeUpdatedToast: 'Challenge updated ✅',
      customizeChallengeBtn: '⚙️ Customize Challenge Rules & Targets',
      logTabDynamic: '{n}-Day Log',
      allDaysCount: 'All {n} Days',
      finalTitleDynamic: 'Challenge Finale ({n} Days)',
      monthlyProgressDynamic: '📊 Monthly Progress ({m}m)',
      weeklyProgressDynamic: '📈 Weekly Progress ({w}w)',
      statsWeeklyInfoDynamic: '<p>The dashed amber line marks your {wk}h weekly target. Green bars met or exceeded the target; indigo bars are in progress.</p>',
      challengeInfoDynamic: '<p><strong>Total Goal:</strong> {total} hours across {weeks} weeks ({days} days) at {wk} hours/week.</p><p><strong>Daily Grace ({grace}h):</strong> Finishing within {grace}h of your daily target does not count as deficit.</p><p><strong>Flex &amp; Bi-Weekly Deficit:</strong> You get {flex}h weekly flexibility before drawing from your permanent <strong>Hour Bank</strong> or adding to your <strong>2-Week Deficit</strong> (resets every 2 weeks; penalty alert triggers above {penalty}h).</p>'
    },
    ar: {
      appTitle: 'متابع الدراسة',
      todayShort: 'اليوم',
      syncNowTitle: 'مزامنة الآن',
      toggleThemeTitle: 'تبديل المظهر',
      toggleLangTitle: 'تغيير اللغة',
      syncedLatest: 'تمت مزامنة أحدث البيانات ☁️',
      tab_focus: 'التركيز',
      tab_hall: 'القاعة',
      tab_tasks: 'المهام',
      tab_habits: 'العادات',
      tab_stats: 'الإحصاءات',
      tab_challenge: 'الخطة',
      tab_settings: 'الإعدادات',

      // Common
      save: 'حفظ',
      cancel: 'إلغاء',
      delete: 'حذف',
      deleteAll: 'حذف الكل',
      edit: 'تعديل',
      add: 'إضافة',
      all: 'الكل',
      none: 'بلا',
      select: 'تحديد',
      gotIt: 'حسناً',
      confirm: 'تأكيد',
      hrs: 'س',
      minShort: 'د',

      // Focus
      focusSession: '⏱️ جلسة التركيز',
      quickTest: '⚡ تجربة 0د',
      pomodoro: '⏱️ بومودورو',
      stopwatch: '♾️ ساعة إيقاف',
      paused: 'متوقف مؤقتاً',
      quickTestSub: 'تجربة 5 ثوانٍ',
      minLabel: '{m} دقيقة',
      countingUp: 'عدّ تصاعدي',
      tagLabel: 'الوسم (Tag)',
      subjectLabel: 'المادة',
      taskLabel: 'المهمة',
      noSubject: '— بدون مادة —',
      noTask: '— بدون مهمة —',
      startFocus: '▶ ابدأ التركيز',
      resume: '▶ استئناف',
      pause: '⏸ إيقاف مؤقت',
      finish: '⏹ إنهاء',
      stop: '⏹ إيقاف',
      focusInfoTitle: '⏱️ قواعد مؤقت التركيز',
      focusInfoBody: '<p><strong>بومودورو:</strong> اختر من 5 إلى 90 دقيقة، أو اضغط <strong>⚡ تجربة 0د</strong> لتجربة 5 ثوانٍ مع رنين.</p><p><strong>ساعة الإيقاف:</strong> تعدّ تصاعدياً؛ أقل من 5 دقائق يُحفظ ككتاب غير مكتمل، و5+ دقائق كجلسة مكتملة.</p><p><strong>مادة أو مهمة:</strong> يمكنك ربط الجلسة بمادة أو بمهمة ليظهر الكتاب بلونَي الوسم والمادة معاً على الرف.</p><p><strong>متزامن سحابياً:</strong> يعتمد على الطابع الزمني ليحافظ على تزامن الوقت بين هواتفك.</p>',
      notifCompleteTitle: 'اكتملت جلسة التركيز! 🏆',
      notifCompleteChallenge: 'تمت إضافة كتاب {m} دقيقة وتسجيله في تحدي 6 أشهر.',
      toastCompleteChallenge: 'تمت إضافة كتاب {m}د وتسجيله في التحدي 🏆',
      notifCompleteShelfTitle: 'اكتملت جلسة التركيز! 📚',
      notifCompleteShelf: 'تمت إضافة كتاب {m} دقيقة إلى مكتبتك.',
      toastCompleteShelf: 'تمت إضافة كتاب جديد إلى الرف 📚',
      toastIncomplete: 'جلسة غير مكتملة (أقل من 5 دقائق)',

      // Bookshelf
      bookshelfTitle: '📚 رف الكتب ({n})',
      hrsCompleted: '{h} ساعة مكتملة',
      noBooksYet: 'لا توجد كتب بعد',
      deleteSelectedCount: 'حذف ({n})',
      shelfInfoTitle: '📚 مستويات الكتب واللونين',
      shelfInfoBody: '<p>يكبر حجم كل كتاب حسب مدة الجلسة ويظهر <strong>بلونين</strong>: جسم الكتاب بلون <strong>الوسم (Tag)</strong>، والشريطان العلوي والسفلي بلون <strong>المادة (Subject)</strong>.</p><p>• <strong>كتيّب:</strong> 5 – 24 دقيقة</p><p>• <strong>كتاب:</strong> 25 – 49 دقيقة</p><p>• <strong>مرجع:</strong> 50 – 74 دقيقة</p><p>• <strong>موسوعة ذهبية:</strong> 75+ دقيقة</p><p>• <strong>كتاب مائل باهت:</strong> جلسة غير مكتملة (أقل من 5 دقائق).</p><p>اضغط على أي كتاب لتعديله أو حذفه، أو استخدم <strong>تحديد</strong> للحذف الجماعي.</p>',
      deleteBooksTitle: 'حذف الكتب المحددة',
      deleteBooksMsg: 'هل تريد حذف {n} كتاب/كتب من الرف؟',
      deletedBooksToast: 'تم حذف {n} كتاب/كتب',
      editBookTitle: 'تعديل الكتاب ({lvl} — {m}د)',
      dateLabel: 'التاريخ',
      taskNotePlaceholder: 'اختر مهمة أو اكتب ملاحظة',
      bookDeletedToast: 'تم حذف الكتاب',
      bookUpdatedToast: 'تم تحديث الكتاب',

      // Tasks
      studyTasks: '✅ مهام الدراسة',
      doneSummary: 'المنجز: {done}/{total} ({rate}%)',
      addTaskPlaceholder: 'أضف مهمة دراسية جديدة...',
      highPriority: 'أولوية عالية',
      mediumPriority: 'أولوية متوسطة',
      lowPriority: 'أولوية عادية',
      addTaskBtn: '+ إضافة مهمة',
      allCount: 'الكل ({n})',
      pendingCount: 'قيد التنفيذ ({n})',
      completedCount: 'مكتملة ({n})',
      allSubjects: 'كل المواد',
      noMatchingTasks: 'لا توجد مهام مطابقة.',
      taskAddedToast: 'تمت إضافة المهمة',

      // Habits
      dailyHabits: '🔥 العادات اليومية',
      weeklyPct: 'الأسبوعي: {p}%',
      addHabitPlaceholder: 'أضف عادة يومية جديدة...',
      streakLabel: 'السلسلة:',
      daysShort: 'ي',
      sevenDayLabel: 'آخر 7 أيام:',
      noHabitsYet: 'لا توجد عادات بعد.',
      habitAddedToast: 'تمت إضافة العادة',

      // Stats
      dailyAvg: 'المعدل اليومي',
      bestWeek: 'أفضل أسبوع',
      tasksDone: 'إنجاز المهام',
      habitsRate: 'التزام العادات',
      monthlyProgress: '📊 التقدم الشهري (6 أشهر)',
      weeklyProgress: '📈 التقدم الأسبوعي (26 أسبوعاً)',
      focusByTag: '🏷️ التركيز حسب الوسم',
      booksWord: 'كتب',
      statsMonthlyInfo: '<p>يقارن الساعات المسجلة (العمود البنفسجي) بالهدف الشهري (العمود الرمادي) عبر أشهر التحدي الستة.</p>',
      statsWeeklyInfo: '<p>الخط المتقطع يمثل الهدف الأسبوعي (41 ساعة). الأعمدة الخضراء حققت الهدف والبنفسجية قيد التقدم.</p>',

      // Challenge
      summaryTab: 'الملخص',
      logTab: 'سجل 182 يوماً',
      reviewsTab: 'المراجعات',
      challengeTitle: '🎯 الخطة الدراسية',
      loggedLabel: 'المسجّل:',
      goalLabel: 'الهدف:',
      todayHeader: '📅 اليوم ({day})',
      dayOfWeek: 'اليوم {d} / {total} • الأسبوع {w}',
      outsideRange: 'خارج نطاق التحدي',
      hourBank: 'بنك الساعات',
      deficitLabel: 'العجز',
      flexUsed: 'المرونة المستخدمة',
      penaltyAlertText: '⚠️ <strong>تنبيه العقوبة{bw}:</strong> تجاوز عجز الأسبوعين {lim} ساعة ({h}س).',
      all182Days: 'كل الأيام (182)',
      weekOption: 'الأسبوع {w} ({logged} / {target}س)',
      dayBadgeToday: 'اليوم',
      dayRowMeta: 'اليوم {d} • {day}',
      weekNum: 'الأسبوع {w}',
      upcoming: 'قادم',
      graceOk: 'سماحية ✓',
      challengeInfoTitle: '🏆 قواعد تحدي 6 أشهر',
      challengeInfoBody: '<p><strong>الهدف الكلي:</strong> 1,066 ساعة خلال 26 أسبوعاً (182 يوماً) بمعدل 41 ساعة/أسبوع.</p><p><strong>الأهداف اليومية:</strong> السبت 8س، الأحد–الأربعاء 5.5س، الخميس 4س، الجمعة 7س.</p><p><strong>سماحية 30 دقيقة:</strong> النقص ضمن نصف ساعة يومياً لا يُحسب كعجز.</p><p><strong>المرونة وعجز الأسبوعين:</strong> لك 7 ساعات مرونة أسبوعياً قبل السحب من <strong>بنك الساعات</strong> الدائم أو إضافة <strong>عجز الأسبوعين</strong> (يتصفّر كل أسبوعين؛ ويظهر التنبيه عند تجاوز 14 ساعة).</p>',
      editDayTitle: 'تعديل {day} ({date})',
      dailyTargetText: 'هدف اليوم:',
      loggedHoursLabel: 'الساعات المسجّلة',
      noteLabel: 'ملاحظة',
      notePlaceholder: 'ملاحظة اختيارية...',
      dayLogUpdated: 'تم تحديث سجل اليوم',

      // Reviews
      weeksRange: 'الأسبوعان {s}–{e}',
      biWeeklyTitle: 'مراجعة أسبوعين #{n} (W{s}–W{e})',
      finalGroup: 'الملخص النهائي',
      finalTitle: 'ختام تحدي 6 أشهر (182 يوماً)',
      noReviewNotes: 'لا توجد ملاحظات مراجعة بعد',
      editReviewBtn: '⭐ {r}/5 • تعديل',
      writeReviewBtn: 'كتابة مراجعة',
      consistencyRating: 'تقييم الالتزام (1–5)',
      keyLessons: 'أهم الدروس والخطوات القادمة',
      reviewPlaceholder: 'اكتب ملاحظات المراجعة هنا...',
      reviewSaved: 'تم حفظ المراجعة',

      // Settings
      languageTitle: '🌐 اللغة / Language',
      smartAutoSync: '☁️ المزامنة السحابية الذكية',
      syncedAt: 'تزامن {t}',
      connected: 'متصل',
      off: 'متوقف',
      tokenPlaceholder: 'الصق GitHub Token (بصلاحية gist)',
      syncNowBtn: '🔄 مزامنة الآن',
      connectSyncBtn: '☁️ ربط ومزامنة',
      disconnect: 'فصل',
      howItWorks: 'كيف تعمل؟',
      notifSoundTitle: '🔔 الإشعارات والصوت',
      soundOn: '🔊 الصوت: مفعّل',
      soundOff: '🔇 الصوت: متوقف',
      testChime: '🎵 تجربة الرنين',
      notifActive: '✅ إشعارات المتصفح مفعّلة',
      enableNotif: '🔔 تفعيل إشعارات المتصفح',
      pushSectionLabel: 'إشعارات الخلفية (عند إغلاق التطبيق / قفل الآيفون)',
      pushWorkerPlaceholder: 'https://study-tracker-push.yourname.workers.dev',
      pushEnableBtn: '🚀 تفعيل إشعارات الخلفية',
      pushActiveBtn: '✅ إشعارات الخلفية مفعّلة (اضغط للإيقاف)',
      pushTestBtn: '🧪 اختبار إشعار (5 ثوانٍ)',
      pushTestScheduled: 'تمت جدولة الاختبار! أغلق التطبيق أو أقفل الشاشة — سيصل خلال 5 ثوانٍ 🔔',
      pushTestTitle: 'اختبار Study Tracker 🔔',
      pushTestBody: 'إشعارات الخلفية تعمل بنجاح حتى عند إغلاق التطبيق!',
      pushEnabledToast: 'تم تفعيل إشعارات الخلفية بنجاح! 🚀',
      pushDisabledToast: 'تم إيقاف إشعارات الخلفية',
      pushIosNeedHomeScreen: 'على الآيفون، افتح التطبيق من أيقونة الشاشة الرئيسية أولاً',
      pushNeedWorkerUrl: 'أدخل رابط Cloudflare Worker أولاً (يبدأ بـ https://)',
      pushSwFailed: 'تعذر تسجيل Service Worker',
      pushWorkerUnreachable: 'تعذر الوصول إلى رابط Worker — تأكد من الرابط والنشر',
      pushWorkerNoKey: 'مفتاح VAPID_PUBLIC_KEY غير مضاف في إعدادات Worker',
      pushNotSubscribed: 'فعّل إشعارات الخلفية أولاً قبل الاختبار',
      startDateTitle: '📅 تاريخ بداية التحدي',
      newDayStartsAt: '🌙 يبدأ اليوم الجديد الساعة',
      midnightDefault: '12:00 ص (افتراضي)',
      hourAm: '{h}:00 ص',
      subjectsTitle: '📚 المواد الدراسية',
      newSubjectPlaceholder: 'اسم المادة الجديدة...',
      customTagsTitle: '🏷️ الوسوم المخصصة (Tags)',
      newTagPlaceholder: 'اسم الوسم الجديد...',
      coreBadge: 'أساسي',
      backupTitle: '💾 النسخ الاحتياطي والاستعادة (JSON)',
      downloadJson: '⬇ تحميل JSON',
      copyJson: '📋 نسخ JSON',
      pasteJsonPlaceholder: 'أو الصق نص JSON هنا...',
      restoreFromText: 'استعادة من النص',
      dataMgmtTitle: '🧪 إدارة البيانات',
      loadDemo: 'تحميل بيانات تجريبية',
      resetAll: 'مسح كل البيانات',
      syncInfoTitle: '☁️ المزامنة الذكية (إعداد بخطوة واحدة)',
      syncInfoBody: '<p><strong>بدون Gist ID:</strong> الصق رمز GitHub Personal Access Token (بصلاحية <strong>gist</strong> فقط) على كل جهاز واضغط <strong>ربط ومزامنة</strong>.</p><p><strong>دمج ذكي:</strong> يتزامن المؤقت النشط والكتب والمهام والعادات والسجل اليومي تلقائياً بين أجهزتك.</p><p><strong>تحديث تلقائي:</strong> تتم المزامنة عند العودة للتطبيق وكل 10 ثوانٍ أثناء فتح تبويب التركيز.</p>',
      notifInfoBody: '<p>يُصدر نغمة هادئة وإشعار متصفح عند انتهاء جلسة التركيز. على iPhone/iPad يلزم إضافة الموقع للشاشة الرئيسية عبر Safari لتفعيل الإشعارات.</p>',
      tagsInfoBody: '<p>عدّل اسم أو لون أي وسم مباشرة وستتحدث الكتب تلقائياً. الوسم الأساسي لا يمكن حذفه لأنه يحتسب ساعات تحدي 6 أشهر.</p>',
      backupInfoBody: '<p>يصدّر سجل 182 يوماً والمهام والعادات والكتب والمراجعات والوسوم والمواد في ملف JSON واحد لنقل بياناتك أو استعادتها.</p>',
      dayStartInfoBody: '<p>يؤخّر بداية اليوم الدراسي الجديد (مثل Anki). مثلاً عند اختيار <strong>4:00 ص</strong>، فإن الدراسة الساعة 1:30 فجراً تُسجّل ضمن اليوم السابق.</p>',
      pasteTokenFirst: 'الرجاء لصق GitHub Token أولاً',
      syncingToast: 'جارٍ المزامنة...',
      syncDisconnected: 'تم فصل المزامنة التلقائية',
      chimePlayed: 'تم تشغيل الرنين 🎵',
      dayStartSaved: 'تم حفظ ساعة بداية اليوم',
      startDateUpdated: 'تم تحديث تاريخ البداية',
      subjectAdded: 'تمت إضافة المادة',
      tagAdded: 'تمت إضافة الوسم',
      tagNameUpdated: 'تم تحديث اسم الوسم',
      tagColorUpdated: 'تم تحديث لون الوسم',
      tagDeleted: 'تم حذف الوسم',
      backupDownloaded: 'تم تحميل ملف النسخة الاحتياطية',
      jsonCopied: 'تم نسخ JSON إلى الحافظة',
      backupRestored: 'تمت استعادة النسخة الاحتياطية!',
      invalidJson: 'صيغة JSON غير صالحة',
      loadDemoMsg: 'استبدال البيانات الحالية بـ 33 يوماً من السجلات والكتب والمهام التجريبية؟',
      loadDemoConfirm: 'تحميل التجريبية',
      demoLoaded: 'تم تحميل البيانات التجريبية',
      resetAllMsg: 'مسح جميع السجلات والمهام والعادات والكتب نهائياً؟',
      resetAllConfirm: 'مسح الكل',
      allCleared: 'تم مسح جميع البيانات',
      notifNotSupported: 'إشعارات المتصفح غير مدعومة هنا',
      notifEnabled: 'تم تفعيل الإشعارات! 🔔',
      notifDenied: 'لم يتم منح صلاحية الإشعارات',
      notifError: 'تعذر تفعيل الإشعارات في هذا العرض',
      syncedToCloud: 'تمت المزامنة مع السحابة ☁️',
      offlineAutoSync: 'غير متصل — ستتم المزامنة تلقائياً عند عودة الإنترنت',
      mergedAndSynced: 'تم الدمج والمزامنة ☁️',
      upToDate: 'كل شيء محدّث بالفعل ☁️',
      shelfStyleClassic: '🎨 كلاسيكي',
      shelfStyleMinimal: '✨ عصري',
      shelfStyleToggleTitle: 'تبديل شكل الرف',
      editChallengeTitle: '⚙️ تعديل التحدي',
      challengeNameLabel: 'اسم التحدي (اختياري)',
      startDateShort: 'تاريخ البداية',
      durationWeeksLabel: 'المدة (بالأسابيع)',
      dailyTargetsLabel: 'ساعات الهدف اليومي (السبت – الجمعة)',
      weeklyFlexLabel: 'مرونة أسبوعية',
      dailyGraceLabel: 'سماحية يومية',
      penaltyLimitLabel: 'حد تنبيه أسبوعين',
      resetDefaults: 'الافتراضي',
      challengePreviewLine: '{days} يوماً • {wk}س/أسبوع • الإجمالي {total}س',
      challengeUpdatedToast: 'تم تحديث التحدي ✅',
      customizeChallengeBtn: '⚙️ تخصيص مدة وقواعد التحدي',
      logTabDynamic: 'سجل {n} يوماً',
      allDaysCount: 'كل الأيام ({n})',
      finalTitleDynamic: 'ختام التحدي ({n} يوماً)',
      monthlyProgressDynamic: '📊 التقدم الشهري ({m} أشهر)',
      weeklyProgressDynamic: '📈 التقدم الأسبوعي ({w} أسبوعاً)',
      statsWeeklyInfoDynamic: '<p>الخط المتقطع يمثل هدفك الأسبوعي ({wk} ساعة). الأعمدة الخضراء حققت الهدف والبنفسجية قيد التقدم.</p>',
      challengeInfoDynamic: '<p><strong>الهدف الكلي:</strong> {total} ساعة خلال {weeks} أسبوعاً ({days} يوماً) بمعدل {wk} ساعة/أسبوع.</p><p><strong>السماحية اليومية ({grace}س):</strong> النقص ضمن {grace}س يومياً لا يُحسب كعجز.</p><p><strong>المرونة وعجز الأسبوعين:</strong> لك {flex}س مرونة أسبوعياً قبل السحب من <strong>بنك الساعات</strong> الدائم أو إضافة <strong>عجز الأسبوعين</strong> (يتصفّر كل أسبوعين؛ ويظهر التنبيه عند تجاوز {penalty}س).</p>'
    }
  };

  function detectSystemLang() {
    try {
      const navLang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
      return /^ar\b/i.test(String(navLang)) ? 'ar' : 'en';
    } catch (e) {
      return 'en';
    }
  }

  function getLang() {
    return currentLang;
  }

  function getLangPref() {
    return langPref;
  }

  function isRTL() {
    return currentLang === 'ar';
  }

  function applyDomDir(lang) {
    currentLang = lang === 'ar' ? 'ar' : 'en';
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('appTitle');
  }

  let langListenerBound = false;
  function bindSystemLangListener() {
    if (langListenerBound) return;
    langListenerBound = true;
    window.addEventListener('languagechange', () => {
      if (langPref !== 'auto') return;
      const next = detectSystemLang();
      if (next !== currentLang) {
        applyDomDir(next);
        if (window.AppState && window.AppState.markLedgerDirty) window.AppState.markLedgerDirty();
        if (window.StudyApp && window.StudyApp.renderAll) window.StudyApp.renderAll();
      }
    });
  }

  function initLang() {
    let saved = null;
    try {
      saved = localStorage.getItem(C.LANG_KEY);
    } catch (e) {}
    langPref = (saved === 'ar' || saved === 'en') ? saved : 'auto';
    applyDomDir(langPref === 'auto' ? detectSystemLang() : langPref);
    bindSystemLangListener();
  }

  function setLang(lang, persist = true, syncToCloud = true) {
    const cleanPref = (lang === 'ar' || lang === 'en' || lang === 'auto') ? lang : 'auto';
    langPref = cleanPref;
    const resolved = cleanPref === 'auto' ? detectSystemLang() : cleanPref;
    applyDomDir(resolved);
    if (persist) {
      try {
        localStorage.setItem(C.LANG_KEY, cleanPref);
      } catch (e) {}
    }
    if (syncToCloud && window.AppState) {
      const data = window.AppState.getData();
      if (data && data.settings) {
        data.settings.lang = cleanPref;
        window.AppState.save(true);
      }
    }
    return resolved;
  }

  function toggleLang() {
    return setLang(currentLang === 'ar' ? 'en' : 'ar', true, true);
  }

  function t(key, vars) {
    const table = DICT[currentLang] || DICT.en;
    let str = table[key] !== undefined ? table[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
      });
    }
    return str;
  }

  return {
    initLang,
    getLang,
    getLangPref,
    detectSystemLang,
    isRTL,
    setLang,
    toggleLang,
    t
  };
})();