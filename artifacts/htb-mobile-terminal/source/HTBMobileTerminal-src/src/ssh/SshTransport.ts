import { Secret } from '../types';

export interface SshConnectParams { host: string; port: number; username: string; secret: Secret }

export interface SshConnection {
  onData(cb: (data: string) => void): void;
  /** Called if the underlying library reports the connection closed. */
  onClose(cb: () => void): void;
  write(data: string): Promise<void>;
  /** Cheap round-trip used as a heartbeat; must reject if the link is dead. */
  ping(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SshTransport {
  connect(p: SshConnectParams): Promise<SshConnection>;
}
