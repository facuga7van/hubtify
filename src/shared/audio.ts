import { Howl } from 'howler';

// Lazy-load sounds to avoid blocking startup
const sounds: Record<string, Howl> = {};

function getSound(name: string, src: string, volume = 0.5): Howl {
  if (!sounds[name]) {
    sounds[name] = new Howl({ src: [src], volume, preload: true });
  }
  return sounds[name];
}

export function playTaskComplete() {
  try {
    getSound('taskComplete', new URL('../assets/fx/graciastio.mp3', import.meta.url).href, 0.4).play();
  } catch { /* Sound not available */ }
}

export function playXpGain() {
  try {
    getSound('xpGain', new URL('../assets/fx/graciastio.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}

export function playLevelUp() {
  try {
    getSound('levelUp', new URL('../assets/fx/graciastio.mp3', import.meta.url).href, 0.5).play();
  } catch { /* Sound not available */ }
}

export function playWrite() {
  try {
    getSound('write', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}

export function playDelete() {
  try {
    getSound('delete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}
