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

export function playTaskComplete() {
  if (!soundEnabled) return;
  try {
    getSound('taskComplete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.4).play();
  } catch { /* Sound not available */ }
}

export function playLevelUp() {
  if (!soundEnabled) return;
  try {
    getSound('levelUp', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.5).play();
  } catch { /* Sound not available */ }
}

export function playWrite() {
  if (!soundEnabled) return;
  try {
    getSound('write', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}

export function playDelete() {
  if (!soundEnabled) return;
  try {
    getSound('delete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
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
    getSound(`pageFlip${idx}`, pageFlipSources[idx](), 0.18).play();
  } catch { /* Sound not available */ }
}
