import { Dimensions } from 'react-native';
import { SqliteRepository } from './db/Repository';
import { KeychainCredentialStore } from './security/CredentialStore';
import { NetworkManager } from './network/NetworkManager';
import { RnSshTransport } from './ssh/RnSshTransport';
import { SessionManager } from './terminal/SessionManager';
import { CHAR_W } from './ui/theme';

// Swap implementations here (SSH library, DB, credential store) without touching the UI.
export const repo = new SqliteRepository();
export const creds = new KeychainCredentialStore();
export const network = new NetworkManager();
const ssh = new RnSshTransport();

const cols = Math.max(30, Math.floor((Dimensions.get('window').width - 16) / CHAR_W));

export const manager = new SessionManager({ repo, ssh, creds, network, cols });
