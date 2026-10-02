import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { creds, manager, repo } from '../container';
import { AuthType, Machine, Workspace, newId } from '../types';
import { mono, theme } from './theme';

interface Group { w: Workspace; machines: Machine[] }

function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={theme.dim} autoCapitalize="none" autoCorrect={false} {...props} style={[s.input, props.style]} />;
}

export function HomeScreen({ onOpen }: { onOpen: (machineId: string) => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ ws: 'HTB', name: '', host: '', port: '22', user: '', secret: '', passphrase: '' });
  const [auth, setAuth] = useState<AuthType>('password');

  const load = useCallback(async () => {
    const ws = await repo.listWorkspaces();
    setGroups(await Promise.all(ws.map(async w => ({ w, machines: await repo.listMachines(w.id) }))));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!f.name.trim() || !f.host.trim() || !f.user.trim() || !f.secret) {
      Alert.alert('Missing fields', 'Name, host, user and password/key are required.');
      return;
    }
    const w = await repo.ensureWorkspace(f.ws.trim() || 'Default');
    const m: Machine = {
      id: newId(), workspaceId: w.id, name: f.name.trim(), host: f.host.trim(),
      port: parseInt(f.port, 10) || 22, username: f.user.trim(), authType: auth,
    };
    await creds.save(m.id, auth === 'key'
      ? { privateKey: f.secret, passphrase: f.passphrase || undefined }
      : { password: f.secret });
    await repo.addMachine(m);
    setF({ ...f, name: '', host: '', user: '', secret: '', passphrase: '' }); // wipe secret from state
    setAdding(false);
    await load();
  };

  const del = (m: Machine) =>
    Alert.alert(`Delete ${m.name}?`, 'Removes its terminals, history and stored credential.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { manager.dropMachine(m.id); await creds.remove(m.id); await repo.deleteMachine(m.id); await load(); },
      },
    ]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={s.bar}>
        <Text style={s.title}>HTB Mobile Terminal</Text>
        <Pressable onPress={() => setAdding(a => !a)}><Text style={s.plus}>{adding ? '✕' : '＋'}</Text></Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}>
        {adding && (
          <View style={s.form}>
            <Field placeholder="Workspace (e.g. HTB)" value={f.ws} onChangeText={ws => setF({ ...f, ws })} />
            <Field placeholder="Machine name (e.g. Lame)" value={f.name} onChangeText={name => setF({ ...f, name })} />
            <Field placeholder="Host / IP" value={f.host} onChangeText={host => setF({ ...f, host })} />
            <Field placeholder="Port" keyboardType="number-pad" value={f.port} onChangeText={port => setF({ ...f, port })} />
            <Field placeholder="Username" value={f.user} onChangeText={user => setF({ ...f, user })} />
            <View style={s.row}>
              {(['password', 'key'] as AuthType[]).map(a => (
                <Pressable key={a} onPress={() => setAuth(a)} style={[s.chip, auth === a && s.chipOn]}>
                  <Text style={{ color: auth === a ? '#000' : theme.fg, fontFamily: mono }}>{a}</Text>
                </Pressable>
              ))}
            </View>
            {auth === 'password'
              ? <Field placeholder="Password" secureTextEntry value={f.secret} onChangeText={secret => setF({ ...f, secret })} />
              : <>
                  <Field placeholder="Paste private key (PEM)" multiline value={f.secret} onChangeText={secret => setF({ ...f, secret })} style={{ minHeight: 90 }} />
                  <Field placeholder="Key passphrase (optional)" secureTextEntry value={f.passphrase} onChangeText={passphrase => setF({ ...f, passphrase })} />
                </>}
            <Pressable onPress={save} style={s.save}><Text style={s.saveTxt}>Save to Keystore & add</Text></Pressable>
          </View>
        )}
        {!groups.length && !adding && <Text style={s.empty}>No machines yet. Tap ＋ to add an HTB machine.</Text>}
        {groups.map(g => (
          <View key={g.w.id} style={{ marginBottom: 16 }}>
            <Text style={s.ws}>▾ {g.w.name}</Text>
            {g.machines.map(m => (
              <Pressable key={m.id} onPress={() => onOpen(m.id)} onLongPress={() => del(m)} style={s.machine}>
                <Text style={s.mName}>{m.name}</Text>
                <Text style={s.mSub}>{m.username}@{m.host}:{m.port} · {m.authType}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <Text style={s.hint}>Long-press a machine to delete it.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.panel, padding: 12 },
  title: { color: theme.accent, fontFamily: mono, fontSize: 16, fontWeight: 'bold' },
  plus: { color: theme.fg, fontSize: 22 },
  form: { backgroundColor: theme.panel, padding: 10, borderRadius: 6, marginBottom: 16, gap: 8 },
  input: { color: theme.fg, fontFamily: mono, borderWidth: 1, borderColor: theme.border, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.border },
  chipOn: { backgroundColor: theme.accent },
  save: { backgroundColor: theme.accent, padding: 10, borderRadius: 4, alignItems: 'center' },
  saveTxt: { color: '#000', fontFamily: mono, fontWeight: 'bold' },
  empty: { color: theme.dim, fontFamily: mono },
  ws: { color: theme.warn, fontFamily: mono, marginBottom: 6 },
  machine: { backgroundColor: theme.panel, padding: 12, borderRadius: 6, marginBottom: 6 },
  mName: { color: theme.fg, fontFamily: mono, fontSize: 15 },
  mSub: { color: theme.dim, fontFamily: mono, fontSize: 12, marginTop: 2 },
  hint: { color: theme.dim, fontFamily: mono, fontSize: 11, marginTop: 8 },
});
