import * as Keychain from 'react-native-keychain';
import { Secret } from '../types';

export interface CredentialStore {
  save(id: string, secret: Secret): Promise<void>;
  get(id: string): Promise<Secret | null>;
  remove(id: string): Promise<void>;
}

const service = (id: string) => `htb.cred.${id}`;

/** Android Keystore-backed via react-native-keychain. Never logs values. */
export class KeychainCredentialStore implements CredentialStore {
  async save(id: string, secret: Secret): Promise<void> {
    await Keychain.setGenericPassword('secret', JSON.stringify(secret), { service: service(id) });
  }
  async get(id: string): Promise<Secret | null> {
    const r = await Keychain.getGenericPassword({ service: service(id) });
    return r ? (JSON.parse(r.password) as Secret) : null;
  }
  async remove(id: string): Promise<void> {
    await Keychain.resetGenericPassword({ service: service(id) });
  }
}
