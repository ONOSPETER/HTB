import SSHClient from '@dylankenneally/react-native-ssh-sftp';
import { SshConnectParams, SshConnection, SshTransport } from './SshTransport';

/**
 * Adapter over @dylankenneally/react-native-ssh-sftp.
 * ASSUMPTION: the library API is connectWithPassword / connectWithKey, startShell,
 * on('Shell'), writeToShell, execute, closeShell, disconnect. Verify on a device.
 * NOTE: the library does not verify host keys.
 */
export class RnSshTransport implements SshTransport {
  async connect(p: SshConnectParams): Promise<SshConnection> {
    const { host, port, username, secret } = p;
    const client: any = secret.privateKey
      ? await SSHClient.connectWithKey(host, port, username, secret.privateKey, secret.passphrase)
      : await SSHClient.connectWithPassword(host, port, username, secret.password ?? '');

    let dataCb: ((d: string) => void) | undefined;
    let closeCb: (() => void) | undefined;

    client.on('Shell', (e: unknown) => { if (e != null) dataCb?.(String(e)); });
    client.on?.('Error', () => closeCb?.());
    await client.startShell('xterm');

    return {
      onData: cb => { dataCb = cb; },
      onClose: cb => { closeCb = cb; },
      write: async d => { await client.writeToShell(d); },
      ping: async () => { await client.execute('true'); },
      disconnect: async () => {
        try { client.closeShell(); } catch { /* already closed */ }
        try { client.disconnect(); } catch { /* already closed */ }
      },
    };
  }
}
