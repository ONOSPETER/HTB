import { AnsiScreen } from './AnsiScreen';
import { Repository } from '../db/Repository';
import { SshConnection, SshTransport } from '../ssh/SshTransport';
import { CredentialStore } from '../security/CredentialStore';
import { Chunk, ConnStatus, Machine, TerminalRow, newId } from '../types';
import { backoffDelay, withTimeout } from '../util/timing';

export interface SessionDeps { repo: Repository; ssh: SshTransport; creds: CredentialStore }

/**
 * Prompt hook: emits OSC 777 "htb-exit;<code>" before each prompt (bash PROMPT_COMMAND / zsh precmd).
 * Inside tmux it is wrapped in DCS passthrough (needs tmux >= 3.3 with allow-passthrough).
 */
const HOOK = String.raw`s=$?;if [ -n "$TMUX" ];then printf "\033Ptmux;\033\033]777;htb-exit;%s\007\033\\\\" "$s";else printf "\033]777;htb-exit;%s\007" "$s";fi`;

const errMsg = (e: unknown): string => String((e as any)?.message ?? e);

export class TerminalSession {
  readonly screen: AnsiScreen;
  status: ConnStatus = 'disconnected';
  attempts = 0;
  hookActive = false;

  private conn: SshConnection | null = null;
  private desired = false;
  private online = true;
  private everConnected = false;
  private epoch = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private hbTimer?: ReturnType<typeof setInterval>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private notifyTimer?: ReturnType<typeof setTimeout>;
  private pending: Chunk[] = [];
  private listeners = new Set<() => void>();
  private lineBuf = '';
  private escSkip = 0;
  private currentCmd: string | null = null;
  private replaying = false;

  constructor(
    readonly term: TerminalRow,
    readonly machine: Machine,
    private deps: SessionDeps,
    cols: number,
  ) {
    this.screen = new AnsiScreen(cols, 24);
    this.screen.onOsc = p => this.onOsc(p);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  // ---- lifecycle ----
  async restore(): Promise<void> {
    const chunks = await this.deps.repo.recentChunks(this.term.id, 200_000);
    if (!chunks.length) return;
    this.replaying = true;
    for (const c of chunks) this.screen.write(c.data);
    this.replaying = false;
    this.screen.archive();
    this.screen.write('[htb] history restored\r\n');
    this.bump();
  }

  connect(): void {
    if (this.status === 'connected') return;
    this.teardown();
    this.desired = true;
    this.attempts = 0;
    if (!this.online) { this.setStatus('offline', 'no network'); return; }
    void this.attempt();
  }

  /** User-initiated disconnect; history stays. */
  disconnect(): void {
    this.desired = false;
    this.teardown();
    void this.flush();
    this.setStatus('disconnected', 'user');
  }

  close(): void {
    this.disconnect();
    this.listeners.clear();
  }

  setOnline(on: boolean): void {
    if (on === this.online) return;
    this.online = on;
    if (!this.desired) return;
    if (!on) {
      this.teardown();
      this.setStatus('offline', 'network lost');
    } else {
      this.attempts = 0;
      void this.attempt();
    }
  }

  /** Called when the app returns to foreground. */
  probe(): void {
    if (this.status === 'connected') void this.ping();
  }

  flushNow(): void { void this.flush(); }

  sendInput(data: string): boolean {
    const conn = this.conn;
    if (!conn || this.status !== 'connected') return false;
    this.track(data);
    conn.write(data).catch(() => this.handleDrop('write failed'));
    return true;
  }

  // ---- connection ----
  private async attempt(): Promise<void> {
    if (!this.desired || !this.online) return;
    const epoch = ++this.epoch;
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    try {
      const secret = await this.deps.creds.get(this.machine.id);
      if (!secret) {
        this.desired = false;
        this.setStatus('disconnected', 'no stored credential');
        return;
      }
      const conn = await this.deps.ssh.connect({
        host: this.machine.host, port: this.machine.port, username: this.machine.username, secret,
      });
      if (epoch !== this.epoch || !this.desired) { await conn.disconnect(); return; }
      this.conn = conn;
      conn.onData(d => { if (epoch === this.epoch) this.emit(d); });
      conn.onClose(() => { if (epoch === this.epoch) this.handleDrop('connection closed'); });
      if (this.everConnected) { this.screen.archive(); this.note('reconnected'); }
      this.everConnected = true;
      this.attempts = 0;
      this.hookActive = false;
      this.currentCmd = null;
      this.setStatus('connected');
      conn.write(this.bootstrap()).catch(() => this.handleDrop('write failed'));
      this.hbTimer = setInterval(() => void this.ping(), 15000);
    } catch (e) {
      if (epoch !== this.epoch) return;
      // Error text only; never secrets.
      if (!this.everConnected) {
        this.desired = false;
        this.note(`connect failed: ${errMsg(e)}`);
        this.setStatus('disconnected', errMsg(e));
      } else {
        this.scheduleRetry();
      }
    }
  }

  private bootstrap(): string {
    const { cols, nrows } = this.screen;
    let s = ` stty cols ${cols} rows ${nrows}; export PROMPT_COMMAND='${HOOK}'; precmd() { ${HOOK}; }\r`;
    if (this.term.useTmux) {
      s += ` command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s htb_${this.term.id} \\; set -g allow-passthrough on\r`;
    }
    return s;
  }

  private async ping(): Promise<void> {
    const conn = this.conn;
    const epoch = this.epoch;
    if (!conn) return;
    try {
      await withTimeout(conn.ping(), 6000);
    } catch {
      if (epoch === this.epoch) this.handleDrop('heartbeat failed');
    }
  }

  private handleDrop(reason: string): void {
    this.teardown();
    if (!this.desired) return;
    if (!this.online) { this.setStatus('offline', reason); return; }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.setStatus('reconnecting');
    const delay = backoffDelay(this.attempts++);
    this.retryTimer = setTimeout(() => void this.attempt(), delay);
  }

  private teardown(): void {
    this.epoch++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.retryTimer = undefined;
    this.hbTimer = undefined;
    const c = this.conn;
    this.conn = null;
    c?.disconnect().catch(() => undefined);
  }

  private setStatus(s: ConnStatus, detail?: string): void {
    if (this.status === s && !detail) return;
    this.status = s;
    this.deps.repo.addEvent(this.term.id, Date.now(), s, detail).catch(() => undefined);
    this.bump();
  }

  // ---- output ----
  private emit(d: string): void {
    const cid = this.currentCmd; // capture before OSC may close it
    this.screen.write(d);
    this.pending.push({ commandId: cid, ts: Date.now(), data: d });
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 300);
    this.bump();
  }

  private note(text: string): void { this.emit(`\r\n[htb] ${text}\r\n`); }

  private async flush(): Promise<void> {
    this.flushTimer = undefined;
    const batch = this.pending;
    this.pending = [];
    if (!batch.length) return;
    try { await this.deps.repo.addChunks(this.term.id, batch); }
    catch (e) { console.warn('persist failed', errMsg(e)); }
  }

  private onOsc(p: string): void {
    const m = /^htb-exit;(\d+)$/.exec(p);
    if (!m || this.replaying) return;
    this.hookActive = true;
    if (this.currentCmd) {
      this.deps.repo.finishCommand(this.currentCmd, parseInt(m[1], 10), Date.now()).catch(() => undefined);
      this.currentCmd = null;
    }
    this.bump();
  }

  // ---- command tracking ----
  // A line is recorded as a command only when the prompt hook is active and no command is
  // running, so text typed into a running program (sudo/ssh password prompts) is never stored.
  private track(data: string): void {
    for (const ch of data) {
      if (this.escSkip > 0) { this.escSkip--; continue; }
      if (ch === '\x1b') { this.escSkip = 2; continue; }
      if (ch === '\r' || ch === '\n') {
        const text = this.lineBuf.trim();
        this.lineBuf = '';
        if (text && this.hookActive && !this.currentCmd) this.startCommand(text);
      } else if (ch === '\x7f' || ch === '\b') this.lineBuf = this.lineBuf.slice(0, -1);
      else if (ch === '\x03' || ch === '\x15') this.lineBuf = '';
      else if (ch >= ' ') this.lineBuf += ch;
    }
  }

  private startCommand(text: string): void {
    const id = newId();
    this.currentCmd = id;
    this.deps.repo.addCommand({ id, terminalId: this.term.id, text, startedAt: Date.now() }).catch(() => undefined);
  }

  private bump(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.listeners.forEach(l => l());
    }, 50);
  }
}
