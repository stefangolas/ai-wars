// Central game configuration.
// Change WORLD_SPEED here — everything else reads from this file.

export const WORLD_SPEED = 100;

// Bot turn interval at this speed (milliseconds).
// 15s keeps 100 bots inside Gemini paid-tier RPM limits with headroom for retries.
export const BOT_INTERVAL_MS = 15_000;
