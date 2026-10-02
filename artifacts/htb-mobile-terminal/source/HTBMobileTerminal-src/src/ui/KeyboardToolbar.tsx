import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KEY, Mods } from '../terminal/keys';
import { mono, theme } from './theme';

const SYMBOLS = ['|', '/', '-', '~', '_', '.', ':', '"', "'", '&', '>', '<', '$', '*', '\\', '#', ';'];
const KEYS: { label: string; data: string }[] = [
  { label: 'ESC', data: KEY.ESC },
  { label: 'TAB', data: KEY.TAB },
  { label: '←', data: KEY.LEFT },
  { label: '↑', data: KEY.UP },
  { label: '↓', data: KEY.DOWN },
  { label: '→', data: KEY.RIGHT },
  { label: '^C', data: KEY.CTRL_C },
  { label: '^D', data: KEY.CTRL_D },
  { label: '^Z', data: KEY.CTRL_Z },
  ...SYMBOLS.map(s => ({ label: s, data: s })),
];

function Btn({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, active && s.active]}>
      <Text style={[s.txt, active && { color: '#000' }]}>{label}</Text>
    </Pressable>
  );
}

export function KeyboardToolbar(props: {
  mods: Mods;
  onToggle: (k: keyof Mods) => void;
  onKey: (data: string) => void;
}) {
  return (
    <View style={s.bar}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
        <Btn label="CTRL" active={props.mods.ctrl} onPress={() => props.onToggle('ctrl')} />
        <Btn label="ALT" active={props.mods.alt} onPress={() => props.onToggle('alt')} />
        {KEYS.map(k => <Btn key={k.label} label={k.label} onPress={() => props.onKey(k.data)} />)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { backgroundColor: theme.panel, borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: 4 },
  btn: { minWidth: 40, paddingHorizontal: 10, paddingVertical: 8, marginHorizontal: 2, borderRadius: 4, backgroundColor: '#161b22', alignItems: 'center' },
  active: { backgroundColor: theme.accent },
  txt: { color: theme.fg, fontFamily: mono, fontSize: 13 },
});
