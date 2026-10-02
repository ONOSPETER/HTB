import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';
import { Chunk, Machine, TerminalRow, Workspace, newId } from '../types';

SQLite.enablePromise(true);

export interface Repository {
  init(): Promise<void>;
  listWorkspaces(): Promise<Workspace[]>;
  ensureWorkspace(name: string): Promise<Workspace>;
  listMachines(workspaceId: string): Promise<Machine[]>;
  getMachine(id: string): Promise<Machine | null>;
  addMachine(m: Machine): Promise<void>;
  deleteMachine(id: string): Promise<void>;
  listTerminals(machineId: string): Promise<TerminalRow[]>;
  addTerminal(t: TerminalRow): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  addCommand(c: { id: string; terminalId: string; text: string; startedAt: number }): Promise<void>;
  finishCommand(id: string, exitCode: number, endedAt: number): Promise<void>;
  addChunks(terminalId: string, chunks: Chunk[]): Promise<void>;
  recentChunks(terminalId: string, maxChars: number): Promise<Chunk[]>;
  addEvent(terminalId: string, ts: number, status: string, detail?: string): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS workspaces(
     id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS machines(
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
     username TEXT NOT NULL, auth_type TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS terminals(
     id TEXT PRIMARY KEY,
     machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
     title TEXT NOT NULL, use_tmux INTEGER NOT NULL,
     created_at INTEGER NOT NULL, closed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS commands(
     id TEXT PRIMARY KEY,
     terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
     text TEXT NOT NULL, started_at INTEGER NOT NULL,
     ended_at INTEGER, exit_code INTEGER)`,
  // stream is 'pty': a PTY merges stdout and stderr, so they cannot be separated.
  `CREATE TABLE IF NOT EXISTS output_chunks(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
     command_id TEXT, ts INTEGER NOT NULL,
     stream TEXT NOT NULL DEFAULT 'pty', data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_term ON output_chunks(terminal_id, id)`,
  `CREATE TABLE IF NOT EXISTS connection_events(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
     ts INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT)`,
];

export class SqliteRepository implements Repository {
  private db!: SQLiteDatabase;

  async init(): Promise<void> {
    this.db = await SQLite.openDatabase({ name: 'htb_terminal.db', location: 'default' });
    await this.db.executeSql('PRAGMA foreign_keys = ON');
    for (const stmt of SCHEMA) await this.db.executeSql(stmt);
  }

  private async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const [res] = await this.db.executeSql(sql, params);
    return res.rows.raw() as T[];
  }
  private async run(sql: string, params: any[] = []): Promise<void> {
    await this.db.executeSql(sql, params);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const r = await this.all('SELECT * FROM workspaces ORDER BY created_at DESC');
    return r.map(x => ({ id: x.id, name: x.name, createdAt: x.created_at }));
  }

  async ensureWorkspace(name: string): Promise<Workspace> {
    const found = await this.all('SELECT * FROM workspaces WHERE name = ?', [name]);
    if (found[0]) return { id: found[0].id, name, createdAt: found[0].created_at };
    const w = { id: newId(), name, createdAt: Date.now() };
    await this.run('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', [w.id, w.name, w.createdAt]);
    return w;
  }

  private toMachine = (x: any): Machine => ({
    id: x.id, workspaceId: x.workspace_id, name: x.name, host: x.host,
    port: x.port, username: x.username, authType: x.auth_type,
  });

  async listMachines(workspaceId: string): Promise<Machine[]> {
    return (await this.all('SELECT * FROM machines WHERE workspace_id = ? ORDER BY name', [workspaceId])).map(this.toMachine);
  }
  async getMachine(id: string): Promise<Machine | null> {
    const r = await this.all('SELECT * FROM machines WHERE id = ?', [id]);
    return r[0] ? this.toMachine(r[0]) : null;
  }
  async addMachine(m: Machine): Promise<void> {
    await this.run(
      'INSERT INTO machines(id,workspace_id,name,host,port,username,auth_type) VALUES(?,?,?,?,?,?,?)',
      [m.id, m.workspaceId, m.name, m.host, m.port, m.username, m.authType],
    );
  }
  async deleteMachine(id: string): Promise<void> {
    await this.run('DELETE FROM machines WHERE id = ?', [id]);
  }

  async listTerminals(machineId: string): Promise<TerminalRow[]> {
    const r = await this.all('SELECT * FROM terminals WHERE machine_id = ? AND closed_at IS NULL ORDER BY created_at', [machineId]);
    return r.map(x => ({ id: x.id, machineId: x.machine_id, title: x.title, useTmux: !!x.use_tmux, createdAt: x.created_at }));
  }
  async addTerminal(t: TerminalRow): Promise<void> {
    await this.run('INSERT INTO terminals(id,machine_id,title,use_tmux,created_at) VALUES(?,?,?,?,?)',
      [t.id, t.machineId, t.title, t.useTmux ? 1 : 0, t.createdAt]);
  }
  /** Soft close: history is kept. */
  async closeTerminal(id: string): Promise<void> {
    await this.run('UPDATE terminals SET closed_at = ? WHERE id = ?', [Date.now(), id]);
  }

  async addCommand(c: { id: string; terminalId: string; text: string; startedAt: number }): Promise<void> {
    await this.run('INSERT INTO commands(id,terminal_id,text,started_at) VALUES(?,?,?,?)', [c.id, c.terminalId, c.text, c.startedAt]);
  }
  async finishCommand(id: string, exitCode: number, endedAt: number): Promise<void> {
    await this.run('UPDATE commands SET exit_code = ?, ended_at = ? WHERE id = ?', [exitCode, endedAt, id]);
  }

  async addChunks(terminalId: string, chunks: Chunk[]): Promise<void> {
    if (!chunks.length) return;
    await this.db.transaction(tx => {
      for (const c of chunks) {
        tx.executeSql('INSERT INTO output_chunks(terminal_id,command_id,ts,stream,data) VALUES(?,?,?,?,?)',
          [terminalId, c.commandId, c.ts, 'pty', c.data]);
      }
    });
  }

  async recentChunks(terminalId: string, maxChars: number): Promise<Chunk[]> {
    const rows = await this.all<{ command_id: string | null; ts: number; data: string }>(
      'SELECT command_id, ts, data FROM output_chunks WHERE terminal_id = ? ORDER BY id DESC LIMIT 5000', [terminalId]);
    const out: Chunk[] = [];
    let total = 0;
    for (const r of rows) {
      total += r.data.length;
      if (total > maxChars && out.length) break;
      out.push({ commandId: r.command_id, ts: r.ts, data: r.data });
    }
    return out.reverse();
  }

  async addEvent(terminalId: string, ts: number, status: string, detail?: string): Promise<void> {
    await this.run('INSERT INTO connection_events(terminal_id,ts,status,detail) VALUES(?,?,?,?)', [terminalId, ts, status, detail ?? null]);
  }
}
