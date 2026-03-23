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

export function playXpGain() {
  if (!soundEnabled) return;
  try {
    getSound('xpGain', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
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
