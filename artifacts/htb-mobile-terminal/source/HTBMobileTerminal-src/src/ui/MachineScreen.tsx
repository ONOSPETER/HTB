import React, { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { manager, repo } from '../container';
import { TerminalSession } from '../terminal/TerminalSession';
import { Mods, applyMods } from '../terminal/keys';
import { Machine } from '../types';
import { KeyboardToolbar } from './KeyboardToolbar';
import { TerminalPane } from './TerminalPane';
import { mono, theme } from './theme';

export function MachineScreen({ machineId, onBack }: { machineId: string; onBack: () => void }) {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [mods, setMods] = useState<Mods>({ ctrl: false, alt: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await repo.getMachine(machineId);
      const list = await manager.openMachine(machineId);
      if (!alive) return;
      setMachine(m);
      setSessions(list);
      setFocusId(list[0]?.term.id ?? null);
    })();
    return () => { alive = false; }; // sessions stay alive in the manager
  }, [machineId]);

  const send = (s: TerminalSession, data: string) => {
    s.sendInput(applyMods(data, mods));
    if (mods.ctrl || mods.alt) setMods({ ctrl: false, alt: false });
  };

  const add = async () => {
    const s = await manager.addTerminal(machineId);
    if (s) { setSessions(p => [...p, s]); setFocusId(s.term.id); setFull(null); }
  };

  const remove = (s: TerminalSession) =>
    Alert.alert('Close terminal?', 'History is kept locally. A remote tmux session keeps running (tmux ls).', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close', style: 'destructive',
        onPress: async () => {
          await manager.removeTerminal(s.term.id);
          setSessions(p => p.filter(x => x !== s));
          if (full === s.term.id) setFull(null);
        },
      },
    ]);

  const shown = full ? sessions.filter(s => s.term.id === full) : sessions;
  const focused = sessions.find(s => s.term.id === focusId);

  return (
    <SafeAreaView style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={st.bar}>
        <Pressable onPress={onBack} hitSlop={8}><Text style={st.btn}>‹</Text></Pressable>
        <Text style={st.title} numberOfLines={1}>
          {machine ? `${machine.name} · ${machine.username}@${machine.host}` : '…'}
        </Text>
        <Pressable onPress={add} hitSlop={8}><Text style={st.btn}>＋</Text></Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {shown.map(s => (
          <TerminalPane
            key={s.term.id}
            session={s}
            focused={s.term.id === focusId}
            fullscreen={full === s.term.id}
            mods={mods}
            send={send}
            onFocus={() => setFocusId(s.term.id)}
            onToggleFull={() => setFull(full === s.term.id ? null : s.term.id)}
            onClose={() => remove(s)}
          />
        ))}
        {!shown.length && <Text style={st.empty}>No terminals. Tap ＋ to add one.</Text>}
      </View>

      <KeyboardToolbar
        mods={mods}
        onToggle={k => setMods(m => ({ ...m, [k]: !m[k] }))}
        onKey={d => focused && send(focused, d)}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, paddingHorizontal: 10, paddingVertical: 6, gap: 12 },
  title: { flex: 1, color: theme.accent, fontFamily: mono, fontSize: 13 },
  btn: { color: theme.fg, fontSize: 22 },
  empty: { color: theme.dim, fontFamily: mono, padding: 16 },
});
