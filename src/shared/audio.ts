import { Howl } from 'howler';

/** One Howl per source file, created on first play and reused forever.
 *  Keyed by src, not by a nickname: `taskComplete`, `write` and `delete` all
 *  point at write.mp3 and used to build (and decode) three separate Howls. */
const sounds: Record<string, Howl> = {};

function readSoundPref(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('hubtify_sound') !== 'false';
  } catch {
    return false;
  }
}

// Cached so a play never has to touch localStorage.
let soundEnabled = readSoundPref();

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  localStorage.setItem('hubtify_sound', String(enabled));
  if (!enabled) stopAllSounds();
}

export function isSoundEnabled() {
  return soundEnabled;
}

/** Mute takes effect immediately, including on whatever is mid-playback. */
function stopAllSounds() {
  for (const howl of Object.values(sounds)) {
    try { howl.stop(); } catch { /* nothing playing */ }
  }
}

/* The cache above is written by setSoundEnabled, but `hubtify_sound` is also
 * written straight to localStorage by syncPull (shared/sync.ts) and by the
 * floating-timer window, neither of which goes through this module. Without
 * these listeners the flag stayed stale until a full reload — pulling
 * "sound: false" from another device left the app happily making noise. */
if (typeof window !== 'undefined') {
  const resync = () => { soundEnabled = readSoundPref(); };
  // Fires in every OTHER window/renderer that shares the origin.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'hubtify_sound') resync();
  });
  // Covers this window: syncPull runs on focus and on account switch.
  window.addEventListener('focus', resync);
  window.addEventListener('account:switched', resync);
}

function getSound(src: string, volume: number): Howl {
  let howl = sounds[src];
  if (!howl) {
    howl = new Howl({ src: [src], volume, preload: true });
    sounds[src] = howl;
  }
  return howl;
}

/** Play with random pitch jitter (±jitter around base rate).
 *  Volume is applied per playback id, so one shared Howl can serve callers
 *  that want the same file at different levels. */
function playSfx(src: string, volume: number, baseRate = 1.0, jitter = 0.2): void {
  if (!soundEnabled) return;
  try {
    const howl = getSound(src, volume);
    const id = howl.play();
    howl.volume(volume, id);
    howl.rate(baseRate + (Math.random() * 2 - 1) * jitter, id);
  } catch { /* Sound not available */ }
}

const WRITE = new URL('../assets/fx/write.mp3', import.meta.url).href;

export function playTaskComplete() {
  playSfx(WRITE, 0.4);
}

export function playLevelUp() {
  playSfx(new URL('../assets/fx/levelup.mp3', import.meta.url).href, 0.15);
}

export function playWrite() {
  playSfx(WRITE, 0.3);
}

export function playDelete() {
  playSfx(WRITE, 0.3);
}

const pageFlipSources = [
  new URL('../assets/fx/page-flip.mp3', import.meta.url).href,
  new URL('../assets/fx/page-flip-2.mp3', import.meta.url).href,
  new URL('../assets/fx/page-flip-3.mp3', import.meta.url).href,
];
let lastPageFlipIndex = -1;

export function playPageFlip() {
  if (!soundEnabled) return;
  // Pick a random variant, avoiding the same one twice in a row
  let idx = Math.floor(Math.random() * pageFlipSources.length);
  if (idx === lastPageFlipIndex) idx = (idx + 1) % pageFlipSources.length;
  lastPageFlipIndex = idx;
  playSfx(pageFlipSources[idx], 0.18);
}

/* ── Cauldron sounds ── */

export function playCauldronStart() {
  playSfx(new URL('../assets/fx/start-fire.mp3', import.meta.url).href, 0.15);
}

export function playCauldronCycleEnd() {
  playSfx(new URL('../assets/fx/fanfare.wav', import.meta.url).href, 0.5);
}

export function playCauldronWarning() {
  playSfx(new URL('../assets/fx/brew-warning.mp3', import.meta.url).href, 0.35);
}

export function playCauldronPause() {
  playSfx(new URL('../assets/fx/brew-stop.mp3', import.meta.url).href, 0.15);
}

export function playCauldronResume() {
  playSfx(new URL('../assets/fx/start-fire.mp3', import.meta.url).href, 0.06);
}

/* ── Seal press ── */

export function playSealPress() {
  playSfx(new URL('../assets/fx/paper-scrape.mp3', import.meta.url).href, 0.025, 1.0, 0.15);
}

/* ── Coin clink ── */

export function playCoinClink() {
  playSfx(new URL('../assets/fx/coin-clink.mp3', import.meta.url).href, 0.06);
}
