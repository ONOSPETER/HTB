/**
 * Minimal terminal emulator: character grid + scrollback.
 * Handles CR/LF/BS/TAB, cursor movement, erase, insert/delete line/char, OSC.
 * Ignores colors/attributes and private modes (no alt-screen, no scroll regions).
 * Replace with a fuller emulator by keeping write() / lines() / onOsc.
 */
type State = 'text' | 'esc' | 'csi' | 'osc' | 'oscesc' | 'charset';

export class AnsiScreen {
  readonly cols: number;
  readonly nrows: number;
  onOsc?: (payload: string) => void;

  private rows: string[][];
  private scrollback: string[] = [];
  private maxScrollback: number;
  private cx = 0;
  private cy = 0;
  private saved: [number, number] = [0, 0];
  private state: State = 'text';
  private buf = '';

  constructor(cols = 80, nrows = 24, maxScrollback = 2000) {
    this.cols = cols;
    this.nrows = nrows;
    this.maxScrollback = maxScrollback;
    this.rows = this.blankRows();
  }

  write(data: string): void {
    for (const ch of data) this.put(ch);
  }

  /** Scrollback plus visible rows, trailing blank rows trimmed. */
  lines(): string[] {
    let last = this.cy;
    for (let i = this.nrows - 1; i > last; i--) {
      if (this.rows[i].some(c => c !== ' ')) { last = i; break; }
    }
    return this.scrollback.concat(this.rows.slice(0, last + 1).map(r => this.rowText(r)));
  }

  /** Moves visible content into scrollback and clears the grid (used before a re-attach redraw). */
  archive(): void {
    let last = -1;
    this.rows.forEach((r, i) => { if (r.some(c => c !== ' ')) last = i; });
    for (let i = 0; i <= last; i++) this.pushScroll(this.rowText(this.rows[i]));
    this.rows = this.blankRows();
    this.cx = 0;
    this.cy = 0;
  }

  // ---- internals ----
  private rowText(r: string[]): string { return r.join('').replace(/\s+$/, ''); }
  private emptyRow(): string[] { return new Array<string>(this.cols).fill(' '); }
  private blankRows(): string[][] { return Array.from({ length: this.nrows }, () => this.emptyRow()); }
  private pushScroll(line: string): void {
    this.scrollback.push(line);
    if (this.scrollback.length > this.maxScrollback) this.scrollback.shift();
  }

  private put(ch: string): void {
    switch (this.state) {
      case 'esc': this.onEsc(ch); return;
      case 'csi':
        if (ch >= '@' && ch <= '~') { this.state = 'text'; this.csi(ch, this.buf); }
        else if (this.buf.length > 64) { this.state = 'text'; }
        else this.buf += ch;
        return;
      case 'osc':
        if (ch === '\x07') this.endOsc();
        else if (ch === '\x1b') this.state = 'oscesc';
        else if (this.buf.length < 256) this.buf += ch;
        return;
      case 'oscesc':
        if (ch === '\\') this.endOsc(); else this.state = 'text';
        return;
      case 'charset': this.state = 'text'; return;
      default: this.text(ch);
    }
  }

  private endOsc(): void {
    const p = this.buf;
    this.state = 'text';
    this.buf = '';
    this.onOsc?.(p);
  }

  private onEsc(ch: string): void {
    this.state = 'text';
    if (ch === '[') { this.state = 'csi'; this.buf = ''; }
    else if (ch === ']') { this.state = 'osc'; this.buf = ''; }
    else if (ch === '(' || ch === ')') this.state = 'charset';
    else if (ch === 'M') { if (this.cy > 0) this.cy--; }
    else if (ch === '7') this.saved = [this.cx, this.cy];
    else if (ch === '8') { this.cx = this.saved[0]; this.cy = this.saved[1]; }
    else if (ch === 'c') { this.rows = this.blankRows(); this.cx = 0; this.cy = 0; }
  }

  private text(ch: string): void {
    if (ch === '\x1b') { this.state = 'esc'; return; }
    if (ch === '\r') { this.cx = 0; return; }
    if (ch === '\n') { this.lineFeed(); return; }
    if (ch === '\b') { if (this.cx > 0) this.cx--; return; }
    if (ch === '\t') { this.cx = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8); return; }
    if (ch < ' ' || ch === '\x7f') return;
    if (this.cx >= this.cols) { this.cx = 0; this.lineFeed(); }
    this.rows[this.cy][this.cx++] = ch;
  }

  private lineFeed(): void {
    if (this.cy >= this.nrows - 1) {
      this.pushScroll(this.rowText(this.rows[0]));
      this.rows.shift();
      this.rows.push(this.emptyRow());
    } else {
      this.cy++;
    }
  }

  private clearRow(y: number, from: number, to: number): void {
    for (let x = Math.max(0, from); x < Math.min(this.cols, to); x++) this.rows[y][x] = ' ';
  }

  private csi(final: string, params: string): void {
    if (/^[?>=!]/.test(params)) return; // private modes: ignored
    const nums = params.split(';').map(s => parseInt(s, 10));
    const n = (i: number, d: number): number => (Number.isFinite(nums[i]) && nums[i] > 0 ? nums[i] : d);
    const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
    const row = this.rows[this.cy];
    switch (final) {
      case 'A': this.cy = Math.max(0, this.cy - n(0, 1)); break;
      case 'B': this.cy = Math.min(this.nrows - 1, this.cy + n(0, 1)); break;
      case 'C': this.cx = Math.min(this.cols - 1, this.cx + n(0, 1)); break;
      case 'D': this.cx = Math.max(0, this.cx - n(0, 1)); break;
      case 'G': this.cx = Math.min(this.cols - 1, n(0, 1) - 1); break;
      case 'd': this.cy = Math.min(this.nrows - 1, n(0, 1) - 1); break;
      case 'H':
      case 'f':
        this.cy = Math.min(this.nrows - 1, n(0, 1) - 1);
        this.cx = Math.min(this.cols - 1, n(1, 1) - 1);
        break;
      case 'J':
        if (mode === 0) {
          this.clearRow(this.cy, this.cx, this.cols);
          for (let y = this.cy + 1; y < this.nrows; y++) this.clearRow(y, 0, this.cols);
        } else if (mode === 1) {
          for (let y = 0; y < this.cy; y++) this.clearRow(y, 0, this.cols);
          this.clearRow(this.cy, 0, this.cx + 1);
        } else {
          for (let y = 0; y < this.nrows; y++) this.clearRow(y, 0, this.cols);
        }
        break;
      case 'K':
        if (mode === 0) this.clearRow(this.cy, this.cx, this.cols);
        else if (mode === 1) this.clearRow(this.cy, 0, this.cx + 1);
        else this.clearRow(this.cy, 0, this.cols);
        break;
      case 'L': {
        const k = Math.min(n(0, 1), this.nrows - this.cy);
        this.rows.splice(this.nrows - k, k);
        for (let i = 0; i < k; i++) this.rows.splice(this.cy, 0, this.emptyRow());
        break;
      }
      case 'M': {
        const k = Math.min(n(0, 1), this.nrows - this.cy);
        this.rows.splice(this.cy, k);
        for (let i = 0; i < k; i++) this.rows.push(this.emptyRow());
        break;
      }
      case 'P': row.splice(this.cx, n(0, 1)); while (row.length < this.cols) row.push(' '); break;
      case '@': row.splice(this.cx, 0, ...new Array<string>(n(0, 1)).fill(' ')); row.length = this.cols; break;
      case 'X': this.clearRow(this.cy, this.cx, this.cx + n(0, 1)); break;
      case 's': this.saved = [this.cx, this.cy]; break;
      case 'u': this.cx = this.saved[0]; this.cy = this.saved[1]; break;
      default: break; // m (colors), r, h, l, etc. ignored
    }
  }
}
