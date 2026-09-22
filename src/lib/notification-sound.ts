// Tiny WebAudio beep used across the app to signal a new notification.
// Extracted so every notification type plays the same sound.
//
// Debounced: if beeps fire in rapid succession (e.g. a client sends 3
// messages back to back and Realtime delivers them all at once), we
// still only play one sound so it doesn't sound like a slot machine.

let lastBeepAt = 0;
const MIN_INTERVAL_MS = 800;

export function playNotificationBeep() {
  const now = Date.now();
  if (now - lastBeepAt < MIN_INTERVAL_MS) return;
  lastBeepAt = now;

  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.12);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.34);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Browsers block audio until a user gesture — silent failure is fine.
  }
}
