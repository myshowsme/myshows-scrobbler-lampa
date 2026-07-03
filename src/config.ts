// Plugin-wide constants. Kept dependency-free so any module can import it.

export const VERSION = "0.0.3";
export const PLUGIN_ID = "myshows_scrobbler";
export const SOURCE_APP = "lampa";

// Canonical scrobble API base URL (configurable in settings for test / self-host).
export const DEFAULT_BASE_URL = "https://myshows.me/scrobble";
export const DEFAULT_THRESHOLD = 80; // percent watched before /stop counts as watched
