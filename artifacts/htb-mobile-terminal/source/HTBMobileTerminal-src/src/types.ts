export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'disconnected';
export type AuthType = 'password' | 'key';

export interface Workspace { id: string; name: string; createdAt: number }
export interface Machine {
  id: string;
  workspaceId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
}
export interface TerminalRow { id: string; machineId: string; title: string; useTmux: boolean; createdAt: number }
export interface Chunk { commandId: string | null; ts: number; data: string }

/** Lives only in Android Keystore-backed storage, never in SQLite or logs. */
export interface Secret { password?: string; privateKey?: string; passphrase?: string }

/** Alphanumeric only, so it is safe inside a tmux session name. */
export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
