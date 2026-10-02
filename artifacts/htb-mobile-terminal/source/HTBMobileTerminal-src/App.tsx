import React, { useEffect, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { network, repo } from './src/container';
import { HomeScreen } from './src/ui/HomeScreen';
import { MachineScreen } from './src/ui/MachineScreen';
import { mono, theme } from './src/ui/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [machineId, setMachineId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await repo.init();
      network.start();
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (machineId) { setMachineId(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [machineId]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: theme.accent, fontFamily: mono }}>starting…</Text>
      </View>
    );
  }
  return machineId
    ? <MachineScreen machineId={machineId} onBack={() => setMachineId(null)} />
    : <HomeScreen onOpen={setMachineId} />;
}
