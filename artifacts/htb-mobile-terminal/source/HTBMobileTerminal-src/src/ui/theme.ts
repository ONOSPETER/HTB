import { Platform } from 'react-native';

export const theme = {
  bg: '#000000',
  panel: '#0d1117',
  fg: '#d6d6d6',
  dim: '#6b7280',
  accent: '#00e676',
  warn: '#ffb300',
  err: '#ff5252',
  border: '#1f2937',
};

export const FONT_SIZE = 12;
export const CHAR_W = FONT_SIZE * 0.6; // approximate monospace advance
export const LINE_H = 16;
export const mono = Platform.OS === 'android' ? 'monospace' : 'Menlo';
