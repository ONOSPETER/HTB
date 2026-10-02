export const KEY = {
  ESC: '\x1b',
  TAB: '\t',
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  RIGHT: '\x1b[C',
  LEFT: '\x1b[D',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_Z: '\x1a',
};

export interface Mods { ctrl: boolean; alt: boolean }

/** Applies sticky CTRL/ALT to a key or single character. */
export function applyMods(data: string, m: Mods): string {
  let out = data;
  if (m.ctrl && data.length === 1) {
    const c = data.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64);
    else if (data === '?') out = '\x7f';
  }
  if (m.alt) out = '\x1b' + out;
  return out;
}
