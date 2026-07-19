// בית עלמא (alma-home) configuration.
// Reuses the SAME Entra app registration as threads-intake (public clientId by
// design for a SPA). The redirect URI for THIS origin/path must be added to the
// app registration (Authentication > SPA) or login fails with AADSTS50011.
export const CONFIG = {
  clientId: "9a084397-f3c5-4982-ad7a-f83a87c8acf2",
  authority: "https://login.microsoftonline.com/33886826-9914-4ae1-ad7e-9c093e058b05",
  // zi5i: Calendars.ReadWrite lets the "➕ ליומן" button create events via Graph.
  // Incremental consent: requested at the next interactive login (one approval).
  scopes: ["Files.ReadWrite", "User.Read", "Calendars.ReadWrite"],
  // Timezone for calendar events written via the "➕ ליומן" button.
  calendarTz: "Asia/Jerusalem",

  // Threads inbox (OneDrive for Business, drive-root relative). Used by the
  // dispatcher to list/read/lock threads. ASCII path (vault iron rule).
  inboxPath: "Alma Mind/Alma.Threads/00-raw/inbox",

  // Where good-morning writes the live brief data (drive-root relative).
  // The home page fetches this after login; nothing sensitive lives in the repo.
  briefPath: "Alma Mind/Alma.R/00-system/brief/brief-latest.json",

  // Open-questions board (qboard data on OneDrive). The questions page reads the
  // active file (open, fed by the session-close collection loop) + the archive
  // (answered history, restored), writes answers back, and appends to the log.
  openQuestionsPath: "Alma Mind/Alma.R/99-harvest/open-questions.md",
  openQuestionsArchivePath: "Alma Mind/Alma.R/99-harvest/open-questions-archive.md",
  resolvedLogPath: "Alma Mind/Alma.R/99-harvest/resolved-log.jsonl",

  // Actions lane (the 4th leg): action items extracted from threads/questions/brief.
  // The machine does the safe autonomous ones; owner:assaf items wait for you.
  // Full CRUD from any surface (add/edit/delete/status) - read/write via Graph.
  actionsPath: "Alma Mind/Alma.R/00-system/actions.md",

  // jbwv (ב): on-demand narrative refresh. The "רענן נרטיב" button writes this
  // flag to OneDrive; a local PC watcher (scheduled task, ~2 min) sees it, runs
  // the brief daemon once (pay-per-use ~$0.15), and clears it. Zero idle cost.
  refreshFlagPath: "Alma Mind/Alma.R/00-system/brief/refresh-request.json",

  // חדר-המכונות בכיס (19/07): לוח-הענן שהמנצח כותב (guard/ממתין-לך/הכרעות-נעולות),
  // וההכרעות שחוזרות מהנייד - קובץ חדש לכל הכרעה (כמו הלכידה), לעולם לא דורס.
  engineBoardPath: "OD - Alma/IT/AI/AI - מקומי/guard-hub/engine-board.json",
  engineInboxPath: "OD - Alma/IT/AI/AI - מקומי/guard-hub/inbox",

  // גשר-הענן השני של גרסת-הכיס (19/07): מעבר-עיניים - המנצח מפרסם eyes-pass.json,
  // הפסיקות מהנייד חוזרות כקובץ חדש לכל פסיקה לאותה תיקיית inbox (eyes-*.json
  // לצד decide-*.json, בלי להתנגש).
  eyesPassPath: "OD - Alma/IT/AI/AI - מקומי/guard-hub/eyes-pass.json",
};
