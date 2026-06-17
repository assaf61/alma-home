# בית עלמא (alma-home)

הבית הדיגיטלי האישי של עלמא: אתר אחד, מובייל-first, מתארח, שמאחד את הכלים שהיו מפוזרים על פורטים שונים. דף הבית = מורנינג בריף; דף החוטים = מפיץ החוטים החי עם כפתור נעילה.

## מודל פרטיות
**לוגין-גייטד + שליפה חיה.** כל האתר מאחורי לוגין Microsoft (Entra). הבריף והחוטים נשלפים חי מ-OneDrive הפרטי דרך Microsoft Graph, רק אחרי התחברות. **שום מידע רגיש לא נשמר ב-repo הזה** - הוא מכיל קוד בלבד. לכן ה-repo יכול להיות ציבורי בבטחה; ההגנה היא הלוגין, לא ערפול ה-URL.

## קבצים
| קובץ | תפקיד |
|------|-------|
| `index.html` | שלד PWA + ניווט תחתון |
| `app.js` | בקר: אימות, ניתוב hash, רינדור דפים |
| `auth.js` | MSAL/Entra (reuse מ-threads-intake, ללא שינוי) |
| `graph.js` | Graph: listInbox / getFileText / putFileReplace (inbox) + getDrivePathText (בריף) |
| `config.js` | clientId, authority, scopes, inboxPath, briefPath |
| `queue.js` | KV מינימלי ל-IndexedDB (cache token עבור auth.js) |
| `brief.js` | דף בית: מנוע ציור הבריף (חולץ מ-good-morning/brief-template.html) + שליפה חיה |
| `threads.js` | דף חוטים: מפיץ חי + חוזה נעילה (mirror ל-worker/lock.py) |
| `ui.js` | toast משותף |
| `app.css` / `tokens.css` | עיצוב Nordic theme-sky, mobile-first |
| `sw.js` | service worker: מטמון shell בלבד, לא נוגע ב-auth/Graph |
| `brief-sample.json` | נתוני הדגמה **סינתטיים** (למצב לא-מחובר / פיתוח מקומי) |

## חוזה הנעילה (מפיץ החוטים)
כפתור "✓ נעל" כותב ל-frontmatter של קובץ החוט, זהה ל-`threads-intake/worker/lock.py`:
```
locked: true
locked_vault: <slug>
locked_at: YYYY-MM-DD HH:MM
```
ואז `distribute.py --locked-only` (מתוזמן, כל 10 דק', מצורף ל-run-enrich) מתייק את החוט לוולט ומוציא אותו מה-inbox.

## דרישת-קדם: Entra Redirect URI
ל-origin/path של האתר חובה להוסיף **Redirect URI מסוג SPA** ל-app registration (clientId `9a084397-...`, אותו אחד של threads-intake):
- פיתוח מקומי: `http://localhost:8857/`
- ייצור: `https://assaf61.github.io/alma-home/`

Azure Portal → App registrations → Authentication → Single-page application → Add URI. בלי זה הלוגין נכשל ב-AADSTS50011. ה-scopes (`Files.ReadWrite`, `User.Read`) כבר מאושרים.

## פיתוח מקומי
```
serve-local.cmd        REM python -m http.server 8857
```
פתח http://localhost:8857/ . ללא לוגין רשום אפשר ללחוץ "צפה בהדגמה".

## פריסה
GitHub Pages מה-repo (branch main). שינוי = `git push`.

## מקור הבריף החי
הסקיל `good-morning` כותב את נתוני הבריף ל-`OneDrive:/Alma Mind/Alma.R/00-system/brief/brief-latest.json`. דף הבית שולף אותם חי. הקובץ חי ב-OneDrive הפרטי, לא ב-repo.
