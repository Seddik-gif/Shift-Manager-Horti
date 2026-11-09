// Notification chime, synthesised with the Web Audio API (no audio file needed).
// Browsers only allow sound after the person has interacted with the page, so the audio context is
// unlocked on the first click/keypress; until then a chime is silently skipped.

const KEY = "hm-notification-sound";
let ctx: AudioContext | null = null;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the preference just won't persist */
  }
}

/** Call from a user gesture (click / key) so later chimes are allowed to play. */
export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio not available */
  }
}

/** A short, soft two-note chime. Returns false if the browser blocked it. */
export function playChime(): boolean {
  if (!ctx || ctx.state !== "running") return false;
  const now = ctx.currentTime;
  const note = (freq: number, start: number, length: number) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.22, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + start);
    osc.stop(now + start + length + 0.05);
  };
  note(784, 0, 0.35); // G5
  note(1175, 0.14, 0.55); // D6
  return true;
}
