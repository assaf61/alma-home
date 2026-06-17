// בית עלמא (alma-home) configuration.
// Reuses the SAME Entra app registration as threads-intake (public clientId by
// design for a SPA). The redirect URI for THIS origin/path must be added to the
// app registration (Authentication > SPA) or login fails with AADSTS50011.
export const CONFIG = {
  clientId: "9a084397-f3c5-4982-ad7a-f83a87c8acf2",
  authority: "https://login.microsoftonline.com/33886826-9914-4ae1-ad7e-9c093e058b05",
  scopes: ["Files.ReadWrite", "User.Read"],

  // Threads inbox (OneDrive for Business, drive-root relative). Used by the
  // dispatcher to list/read/lock threads. ASCII path (vault iron rule).
  inboxPath: "Alma Mind/Alma.Threads/00-raw/inbox",

  // Where good-morning writes the live brief data (drive-root relative).
  // The home page fetches this after login; nothing sensitive lives in the repo.
  briefPath: "Alma Mind/Alma.R/00-system/brief/brief-latest.json",
};
