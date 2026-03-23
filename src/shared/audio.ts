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
  if (localStorage.getItem('hubtify_sound') === 'false') return;
  try {
    getSound('taskComplete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.4).play();
  } catch { /* Sound not available */ }
}

export function playXpGain() {
  if (localStorage.getItem('hubtify_sound') === 'false') return;
  try {
    getSound('xpGain', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}

export function playLevelUp() {
  if (localStorage.getItem('hubtify_sound') === 'false') return;
  try {
    getSound('levelUp', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.5).play();
  } catch { /* Sound not available */ }
}

export function playWrite() {
  if (localStorage.getItem('hubtify_sound') === 'false') return;
  try {
    getSound('write', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}

export function playDelete() {
  if (localStorage.getItem('hubtify_sound') === 'false') return;
  try {
    getSound('delete', new URL('../assets/fx/write.mp3', import.meta.url).href, 0.3).play();
  } catch { /* Sound not available */ }
}
