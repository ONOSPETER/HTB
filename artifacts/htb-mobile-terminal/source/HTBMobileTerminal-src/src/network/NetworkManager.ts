import NetInfo from '@react-native-community/netinfo';

export class NetworkManager {
  online = true;
  private listeners = new Set<(online: boolean) => void>();
  private unsub?: () => void;

  start(): void {
    if (this.unsub) return;
    // Do not ping third-party hosts for reachability; rely on link state only.
    NetInfo.configure({ reachabilityShouldRun: () => false });
    this.unsub = NetInfo.addEventListener(s => {
      const on = s.isConnected !== false; // null (unknown) counts as online
      if (on !== this.online) {
        this.online = on;
        this.listeners.forEach(l => l(on));
      }
    });
  }

  subscribe(cb: (online: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}
