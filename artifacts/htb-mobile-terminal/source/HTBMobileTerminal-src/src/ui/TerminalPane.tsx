import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TerminalSession } from '../terminal/TerminalSession';
import { Mods } from '../terminal/keys';
import { ConnStatus } from '../types';
import { FONT_SIZE, LINE_H, mono, theme } from './theme';

const STATUS: Record<ConnStatus, { label: string; color: string }> = {
  connected: { label: 'Connected', color: theme.accent },
  connecting: { label: 'Connecting…', color: theme.warn },
  reconnecting: { label: 'Reconnecting…', color: theme.warn },
  offline: { label: 'Offline', color: theme.err },
  disconnected: { label: 'Disconnected · tap to connect', color: theme.dim },
};

export function useSession(s: TerminalSession): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => s.subscribe(force), [s]);
}

interface Props {
  session: TerminalSession;
  focused: boolean;
  fullscreen: boolean;
  mods: Mods;
  onFocus: () => void;
  onToggleFull: () => void;
  onClose: () => void;
  send: (s: TerminalSession, data: string) => void;
}

export function TerminalPane({ session, focused, fullscreen, mods, onFocus, onToggleFull, onClose, send }: Props) {
  useSession(session);
  const [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const stick = useRef(true);
  const st = STATUS[session.status];

  const onChange = (t: string) => {
    // With sticky CTRL/ALT armed, the next typed character is sent immediately as a chord.
    if ((mods.ctrl || mods.alt) && t.length > text.length) {
      send(session, t.slice(-1));
      return;
    }
    setText(t);
  };

  const submit = () => {
    if (session.sendInput(text + '\r')) setText('');
  };

  return (
    <View style={[s.pane, focused && s.focused]}>
      <View style={s.header}>
        <Text style={s.title} numberOfLines={1}>{session.term.title}</Text>
        <Pressable onPress={() => session.status === 'disconnected' && session.connect()} style={s.statusWrap}>
          <View style={[s.dot, { backgroundColor: st.color }]} />
          <Text style={[s.status, { color: st.color }]} numberOfLines={1}>{st.label}</Text>
        </Pressable>
        {session.status === 'connected' && !session.hookActive && <Text style={s.warn}>cmd-log off</Text>}
        <Pressable onPress={onToggleFull} hitSlop={8}><Text style={s.icon}>{fullscreen ? '▣' : '⤢'}</Text></Pressable>
        <Pressable onPress={onClose} hitSlop={8}><Text style={s.icon}>✕</Text></Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={s.out}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={64}
        onScroll={e => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          stick.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
        }}
        onContentSizeChange={() => stick.current && scroll.current?.scrollToEnd({ animated: false })}
      >
        <Text style={s.text} selectable>{session.screen.lines().join('\n')}</Text>
      </ScrollView>

      <View style={s.inputRow}>
        <Text style={s.prompt}>›</Text>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={onChange}
          onFocus={onFocus}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          returnKeyType="send"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="visible-password"
          placeholder={session.status === 'connected' ? 'command' : 'not connected'}
          placeholderTextColor={theme.dim}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pane: { flex: 1, backgroundColor: theme.bg, borderBottomWidth: 1, borderColor: theme.border, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  focused: { borderLeftColor: theme.accent },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, paddingHorizontal: 8, paddingVertical: 4, gap: 10 },
  title: { color: theme.fg, fontFamily: mono, fontSize: 12, fontWeight: 'bold' },
  statusWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontFamily: mono, fontSize: 11, flexShrink: 1 },
  warn: { color: theme.warn, fontFamily: mono, fontSize: 10 },
  icon: { color: theme.fg, fontSize: 16 },
  out: { flex: 1, paddingHorizontal: 6 },
  text: { color: theme.fg, fontFamily: mono, fontSize: FONT_SIZE, lineHeight: LINE_H },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, paddingHorizontal: 6 },
  prompt: { color: theme.accent, fontFamily: mono, fontSize: 16, marginRight: 4 },
  input: { flex: 1, color: theme.fg, fontFamily: mono, fontSize: 14, paddingVertical: 4 },
});
