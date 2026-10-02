import { AnsiScreen } from '../src/terminal/AnsiScreen';
import { applyMods, KEY } from '../src/terminal/keys';
import { backoffDelay } from '../src/util/timing';

describe('AnsiScreen', () => {
  it('renders text and CRLF', () => {
    const s = new AnsiScreen(20, 5);
    s.write('hello\r\nworld');
    expect(s.lines()).toEqual(['hello', 'world']);
  });

  it('handles carriage return overwrite and backspace', () => {
    const s = new AnsiScreen(20, 5);
    s.write('abc\rX');
    expect(s.lines()[0]).toBe('Xbc');
    s.write('\b\bZ'); // cursor at 1 -> back to 0 -> Z overwrites X
    expect(s.lines()[0]).toBe('Zbc');
  });

  it('strips SGR colors and supports cursor addressing + erase', () => {
    const s = new AnsiScreen(20, 5);
    s.write('\x1b[31mred\x1b[0m\x1b[2J\x1b[1;1Hok');
    expect(s.lines()).toEqual(['ok']);
  });

  it('scrolls old rows into scrollback', () => {
    const s = new AnsiScreen(10, 3);
    s.write('1\r\n2\r\n3\r\n4\r\n5');
    expect(s.lines()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('reports OSC payloads for BEL and ST terminators', () => {
    const s = new AnsiScreen(20, 3);
    const got: string[] = [];
    s.onOsc = p => got.push(p);
    s.write('\x1b]777;htb-exit;0\x07x\x1b]777;htb-exit;127\x1b\\');
    expect(got).toEqual(['777;htb-exit;0', '777;htb-exit;127']);
  });
});

describe('keys', () => {
  it('maps CTRL+c to 0x03 and ALT to ESC prefix', () => {
    expect(applyMods('c', { ctrl: true, alt: false })).toBe('\x03');
    expect(applyMods('f', { ctrl: false, alt: true })).toBe('\x1bf');
    expect(applyMods(KEY.UP, { ctrl: false, alt: false })).toBe('\x1b[A');
  });
});

describe('backoff', () => {
  it('doubles and caps at 30s', () => {
    expect([0, 1, 2, 3].map(a => backoffDelay(a))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(10)).toBe(30000);
  });
});
