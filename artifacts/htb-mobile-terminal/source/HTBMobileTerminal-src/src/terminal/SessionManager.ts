import { AppState } from 'react-native';
import { TerminalSession, SessionDeps } from './TerminalSession';
import { NetworkManager } from '../network/NetworkManager';
import { Machine, TerminalRow, newId } from '../types';

export class SessionManager {
  private sessions = new Map<string, TerminalSession>();

  constructor(private deps: SessionDeps & { network: NetworkManager; cols: number }) {
    deps.network.subscribe(on => this.sessions.forEach(s => s.setOnline(on)));
    AppState.addEventListener('change', st => {
      this.sessions.forEach(s => (st === 'active' ? s.probe() : s.flushNow()));
    });
  }

  /** Loads (or creates) the machine's terminals, restores history and connects each. */
  async openMachine(machineId: string): Promise<TerminalSession[]> {
    const machine = await this.deps.repo.getMachine(machineId);
    if (!machine) return [];
    let terms = await this.deps.repo.listTerminals(machineId);
    if (!terms.length) terms = [await this.createRow(machine, 1)];
    const out: TerminalSession[] = [];
    for (const t of terms) out.push(await this.ensure(t, machine));
    return out;
  }

  async addTerminal(machineId: string): Promise<TerminalSession | null> {
    const machine = await this.deps.repo.getMachine(machineId);
    if (!machine) return null;
    const n = (await this.deps.repo.listTerminals(machineId)).length + 1;
    return this.ensure(await this.createRow(machine, n), machine);
  }

  async removeTerminal(id: string): Promise<void> {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
    await this.deps.repo.closeTerminal(id);
  }

  dropMachine(machineId: string): void {
    for (const [id, s] of this.sessions) {
      if (s.machine.id === machineId) { s.close(); this.sessions.delete(id); }
    }
  }

  private async createRow(machine: Machine, n: number): Promise<TerminalRow> {
    const t: TerminalRow = { id: newId(), machineId: machine.id, title: `Terminal ${n}`, useTmux: true, createdAt: Date.now() };
    await this.deps.repo.addTerminal(t);
    return t;
  }

  private async ensure(t: TerminalRow, machine: Machine): Promise<TerminalSession> {
    let s = this.sessions.get(t.id);
    if (!s) {
      s = new TerminalSession(t, machine, this.deps, this.deps.cols);
      s.setOnline(this.deps.network.online);
      await s.restore();
      this.sessions.set(t.id, s);
    }
    s.connect();
    return s;
  }
}
