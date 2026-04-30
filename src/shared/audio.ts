import { Howl } from 'howler';

// Lazy-load sounds to avoid blocking startup
const sounds: Record<string, Howl> = {};

// Cache sound preference to avoid hitting localStorage on every play
let soundEnabled = localStorage.getItem('hubtify_sound') !== 'false';

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  localStorage.setItem('hubtify_sound', String(enabled));
}

export function isSoundEnabled() {
  return soundEnabled;
}

function getSound(name: string, src: string, volume = 0.5): Howl {
  if (!sounds[name]) {
    sounds[name] = new Howl({ src: [src], volume, preload: true });
  }
  return sounds[name];
}

/** Play with random pitch jitter (±0.1 around base rate) */
function playWithJitter(howl: Howl, baseRate = 1.0, jitter = 0.2): void {
  const rate = baseRate + (Math.random() * 2 - 1) * jitter;
  const id = howl.play();
  howl.rate(rate, id);
}

export function playTaskComplete() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('taskComplete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.4));
  } catch { /* Sound not available */ }
}

export function playLevelUp() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('levelUp', new URL('../assets/fx/levelup.mp3', import.meta.url).href, 0.15));
  } catch { /* Sound not available */ }
}

export function playWrite() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('write', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3));
  } catch { /* Sound not available */ }
}

export function playDelete() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('delete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3));
  } catch { /* Sound not available */ }
}

const pageFlipSources = [
  () => new URL('../assets/fx/page-flip.mp3', import.meta.url).href,
  () => new URL('../assets/fx/page-flip-2.mp3', import.meta.url).href,
  () => new URL('../assets/fx/page-flip-3.mp3', import.meta.url).href,
];
let lastPageFlipIndex = -1;

export function playPageFlip() {
  if (!soundEnabled) return;
  try {
    // Pick a random variant, avoiding the same one twice in a row
    let idx = Math.floor(Math.random() * pageFlipSources.length);
    if (idx === lastPageFlipIndex) idx = (idx + 1) % pageFlipSources.length;
    lastPageFlipIndex = idx;
    playWithJitter(getSound(`pageFlip${idx}`, pageFlipSources[idx](), 0.18));
  } catch { /* Sound not available */ }
}

/* ── Cauldron sounds ── */

export function playCauldronStart() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('cauldronStart', new URL('../assets/fx/start-fire.mp3', import.meta.url).href, 0.15));
  } catch { /* Sound not available */ }
}

export function playCauldronCycleEnd() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('cauldronCycleEnd', new URL('../assets/fx/fanfare.wav', import.meta.url).href, 0.5));
  } catch { /* Sound not available */ }
}

export function playCauldronWarning() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('cauldronWarning', new URL('../assets/fx/brew-warning.mp3', import.meta.url).href, 0.35));
  } catch { /* Sound not available */ }
}

export function playCauldronPause() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('cauldronPause', new URL('../assets/fx/brew-stop.mp3', import.meta.url).href, 0.15));
  } catch { /* Sound not available */ }
}

export function playCauldronResume() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('cauldronResume', new URL('../assets/fx/start-fire.mp3', import.meta.url).href, 0.06));
  } catch { /* Sound not available */ }
}

/* ── Seal press ── */

export function playSealPress() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('sealPress', new URL('../assets/fx/paper-scrape.mp3', import.meta.url).href, 0.025), 1.0, 0.15);
  } catch { /* Sound not available */ }
}

/* ── Coin clink ── */

export function playCoinClink() {
  if (!soundEnabled) return;
  try {
    playWithJitter(getSound('coinClink', new URL('../assets/fx/coin-clink.mp3', import.meta.url).href, 0.06));
  } catch { /* Sound not available */ }
}
