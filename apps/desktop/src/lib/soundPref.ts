import { readLocalStorage } from "@/hooks/useLocalStorage";

/// Settings → Personalization's Sounds switch. Covers only what plays in the
/// window: desktop banners and Carbon Island make their own sounds.
///
/// Its own module so `tick.ts` can read it without importing `sound.ts`, whose
/// load builds `Audio` elements a test environment does not have.
export const SOUNDS_KEY = "ade.sounds";

/// Read on every play rather than cached, so the switch needs no subscribers.
export function soundsOn() {
  return readLocalStorage(SOUNDS_KEY, true);
}
