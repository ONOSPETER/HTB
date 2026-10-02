import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AuthType = 'password' | 'key';
type Machine = {
  id: string;
  workspace: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
};
type Credential = { password: string } | { privateKey: string; passphrase?: string };
type Screen =
  | { kind: 'home' }
  | { kind: 'add' }
  | { kind: 'terminal'; machine: Machine; sample: boolean };

const MACHINE_STORAGE_KEY = 'htb-mobile-terminal:machines:v1';
const CREDENTIAL_STORAGE_PREFIX = 'htb-mobile-terminal:credential:';
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const terminalSample: Machine = {
  id: 'sample-machine',
  workspace: 'HTB',
  name: 'Sample target',
  host: 'lab-machine.local',
  port: 22,
  username: 'student',
  authType: 'password',
};
const quickKeys = [
  { label: 'ESC', icon: 'corner-up-left' as const },
  { label: 'TAB', icon: 'corner-down-right' as const },
  { label: '↑', icon: 'chevron-up' as const },
  { label: '↓', icon: 'chevron-down' as const },
  { label: '←', icon: 'chevron-left' as const },
  { label: '→', icon: 'chevron-right' as const },
  { label: '/', icon: 'slash' as const },
];

function isMachine(value: unknown): value is Machine {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.workspace === 'string' &&
    typeof row.name === 'string' &&
    typeof row.host === 'string' &&
    typeof row.port === 'number' &&
    typeof row.username === 'string' &&
    (row.authType === 'password' || row.authType === 'key')
  );
}

function makeId() {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const loadMachines = async () => {
    setLoading(true);
    setStorageError(null);
    try {
      const raw = await AsyncStorage.getItem(MACHINE_STORAGE_KEY);
      const value: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(value) || !value.every(isMachine)) {
        throw new Error('The saved machine list could not be read.');
      }
      setMachines(value);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Local storage is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMachines();
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, Machine[]>();
    for (const machine of machines) {
      const rows = grouped.get(machine.workspace) ?? [];
      rows.push(machine);
      grouped.set(machine.workspace, rows);
    }
    return Array.from(grouped.entries());
  }, [machines]);

  const saveMachine = async (machine: Machine, credential: Credential) => {
    const secureKey = `${CREDENTIAL_STORAGE_PREFIX}${machine.id}`;
    await SecureStore.setItemAsync(secureKey, JSON.stringify(credential));
    const next = [...machines, machine];
    try {
      await AsyncStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify(next));
      setMachines(next);
      setScreen({ kind: 'home' });
      return true;
    } catch (error) {
      await SecureStore.deleteItemAsync(secureKey).catch(() => undefined);
      Alert.alert(
        'Could not save machine',
        error instanceof Error ? error.message : 'Check device storage and try again.',
      );
      return false;
    }
  };

  const deleteMachine = (machine: Machine) => {
    Alert.alert(
      `Delete ${machine.name}?`,
      'This removes the machine and its saved secure credential from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const key = `${CREDENTIAL_STORAGE_PREFIX}${machine.id}`;
              const previousCredential = await SecureStore.getItemAsync(key);
              await SecureStore.deleteItemAsync(key);
              const next = machines.filter((item) => item.id !== machine.id);
              try {
                await AsyncStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify(next));
                setMachines(next);
              } catch (error) {
                if (previousCredential) {
                  await SecureStore.setItemAsync(key, previousCredential).catch(() => undefined);
                }
                Alert.alert(
                  'Could not delete machine',
                  error instanceof Error ? error.message : 'Check device storage and try again.',
                );
              }
            })().catch((error: unknown) => {
              Alert.alert(
                'Could not delete machine',
                error instanceof Error ? error.message : 'Secure storage is unavailable.',
              );
            });
          },
        },
      ],
    );
  };

  const topInset = Platform.OS === 'web' ? 67 : Math.max(insets.top, 8);
  const bottomInset = insets.bottom + (Platform.OS === 'web' ? 34 : 12);

  if (screen.kind === 'add') {
    return (
      <AddMachineScreen
        onBack={() => setScreen({ kind: 'home' })}
        onSave={saveMachine}
        topInset={topInset}
        bottomInset={bottomInset}
      />
    );
  }

  if (screen.kind === 'terminal') {
    return (
      <TerminalScreen
        machine={screen.machine}
        sample={screen.sample}
        onBack={() => setScreen({ kind: 'home' })}
        topInset={topInset}
        bottomInset={bottomInset}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.topBar, { paddingTop: topInset, backgroundColor: colors.card }]}>
        <View style={styles.brandLine}>
          <View style={[styles.brandMark, { borderColor: colors.primary }]}>
            <Feather name="terminal" size={15} color={colors.primary} />
          </View>
          <View style={styles.brandText}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>AUTHORIZED LAB ACCESS</Text>
            <Text style={[styles.appTitle, { color: colors.primary }]}>HTB MOBILE TERMINAL</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add machine"
            testID="add-machine"
            onPress={() => setScreen({ kind: 'add' })}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Feather name="plus" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.topRule, { backgroundColor: colors.primary }]} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.homeContent, { paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionHeading}>
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>WORKSPACES</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {machines.length.toString().padStart(2, '0')} MACHINES
          </Text>
        </View>

        {loading ? (
          <View style={styles.messagePanel}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.messageText, { color: colors.mutedForeground }]}>Loading local machines…</Text>
          </View>
        ) : storageError ? (
          <View style={styles.messagePanel}>
            <Feather name="alert-circle" size={22} color={colors.destructive} />
            <Text style={[styles.messageText, { color: colors.foreground }]}>{storageError}</Text>
            <Pressable onPress={() => void loadMachines()} style={[styles.outlineButton, { borderColor: colors.border }]}>
              <Text style={[styles.outlineButtonText, { color: colors.foreground }]}>Try again</Text>
            </Pressable>
          </View>
        ) : groups.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={[styles.emptyIcon, { borderColor: colors.border }]}>
              <Feather name="server" size={22} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No machines saved</Text>
            <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>
              Add an authorized lab machine to organize its SSH connection and terminals.
            </Text>
            <Pressable
              testID="empty-add-machine"
              onPress={() => setScreen({ kind: 'add' })}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="plus" size={16} color={colors.primaryForeground} />
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Add machine</Text>
            </Pressable>
          </View>
        ) : (
          groups.map(([workspace, rows]) => (
            <View key={workspace} style={styles.workspaceBlock}>
              <View style={styles.workspaceHeader}>
                <Feather name="folder" size={14} color={colors.primary} />
                <Text style={[styles.workspaceName, { color: colors.primary }]}>{workspace}</Text>
                <Text style={[styles.workspaceCount, { color: colors.mutedForeground }]}>
                  {rows.length.toString().padStart(2, '0')}
                </Text>
              </View>
              {rows.map((machine) => (
                <Pressable
                  key={machine.id}
                  testID={`machine-${machine.id}`}
                  onPress={() =>
                    setScreen({ kind: 'terminal', machine, sample: false })
                  }
                  onLongPress={() => deleteMachine(machine)}
                  style={({ pressed }) => [
                    styles.machineCard,
                    { borderColor: colors.border, backgroundColor: colors.card },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.machineIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name="server" size={17} color={colors.primary} />
                  </View>
                  <View style={styles.machineDetails}>
                    <Text style={[styles.machineName, { color: colors.foreground }]}>{machine.name}</Text>
                    <Text style={[styles.machineAddress, { color: colors.mutedForeground }]}>
                      {machine.username}@{machine.host}:{machine.port}
                    </Text>
                  </View>
                  <View style={styles.machineEnd}>
                    <Text style={[styles.authTag, { color: colors.mutedForeground }]}>
                      {machine.authType === 'key' ? 'KEY' : 'PASS'}
                    </Text>
                    <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                  </View>
                </Pressable>
              ))}
            </View>
          ))
        )}

        <View style={styles.previewSection}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.kicker, { color: colors.mutedForeground }]}>INTERFACE PREVIEW</Text>
            <Feather name="eye" size={15} color={colors.mutedForeground} />
          </View>
          <Pressable
            testID="preview-terminal"
            onPress={() => setScreen({ kind: 'terminal', machine: terminalSample, sample: true })}
            style={({ pressed }) => [
              styles.previewCard,
              { borderColor: colors.border, backgroundColor: colors.card },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.previewTopline}>
              <View style={[styles.previewDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.previewLabel, { color: colors.primary }]}>LOCAL PREVIEW</Text>
              <Feather name="arrow-up-right" size={15} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.previewTitle, { color: colors.foreground }]}>Explore a terminal screen</Text>
            <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>
              View the pane layout and mobile key toolbar without connecting to a machine.
            </Text>
          </Pressable>
        </View>

        <View style={styles.footerNote}>
          <Feather name="shield" size={13} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            For authorized HTB and CTF labs only
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function AddMachineScreen({
  onBack,
  onSave,
  topInset,
  bottomInset,
}: {
  onBack: () => void;
  onSave: (machine: Machine, credential: Credential) => Promise<boolean>;
  topInset: number;
  bottomInset: number;
}) {
  const colors = useColors();
  const [workspace, setWorkspace] = useState('HTB');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const secureCredentialEntry = Platform.OS !== 'web';

  const submit = async () => {
    if (!secureCredentialEntry) {
      Alert.alert(
        'Use the phone preview',
        'Credential entry is disabled in the browser preview. Open this app on your phone to use secure device storage.',
      );
      return;
    }
    const parsedPort = Number.parseInt(port, 10);
    if (!name.trim() || !host.trim() || !username.trim() || !secret) {
      Alert.alert('Missing fields', 'Machine name, host, username, and a password or private key are required.');
      return;
    }
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      Alert.alert('Invalid port', 'Enter a port from 1 to 65535.');
      return;
    }
    const machine: Machine = {
      id: makeId(),
      workspace: workspace.trim() || 'Default',
      name: name.trim(),
      host: host.trim(),
      port: parsedPort,
      username: username.trim(),
      authType,
    };
    const credential: Credential =
      authType === 'key'
        ? { privateKey: secret, passphrase: passphrase || undefined }
        : { password: secret };
    setSaving(true);
    try {
      const saved = await onSave(machine, credential);
      if (saved) {
        setSecret('');
        setPassphrase('');
      }
    } catch (error) {
      Alert.alert(
        'Could not save credential',
        error instanceof Error ? error.message : 'Secure device storage is unavailable.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.subHeader, { paddingTop: topInset, backgroundColor: colors.card }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}>
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <View style={styles.subHeaderText}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>WORKSPACE / MACHINE</Text>
          <Text style={[styles.subTitle, { color: colors.foreground }]}>Add machine</Text>
        </View>
      </View>
      <KeyboardAwareScrollViewCompat
        style={styles.flex}
        contentContainerStyle={[styles.formContent, { paddingBottom: bottomInset }]}
        bottomOffset={72}
      >
        <View style={[styles.formIntro, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="shield" size={17} color={colors.primary} />
          <Text style={[styles.formIntroText, { color: colors.mutedForeground }]}>
            Connect only to systems you own or are authorized to use.
          </Text>
        </View>
        <FormField
          label="WORKSPACE"
          value={workspace}
          onChangeText={setWorkspace}
          placeholder="HTB"
          autoCapitalize="words"
        />
        <FormField label="MACHINE NAME" value={name} onChangeText={setName} placeholder="e.g. Lame" />
        <FormField
          label="HOST / IP"
          value={host}
          onChangeText={setHost}
          placeholder="10.10.10.10"
          keyboardType="url"
        />
        <View style={styles.formRow}>
          <View style={styles.portField}>
            <FormField
              label="PORT"
              value={port}
              onChangeText={setPort}
              placeholder="22"
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.userField}>
            <FormField
              label="USERNAME"
              value={username}
              onChangeText={setUsername}
              placeholder="root"
              autoCapitalize="none"
            />
          </View>
        </View>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>AUTHENTICATION</Text>
        <View style={[styles.authChoices, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {(['password', 'key'] as AuthType[]).map((option) => {
            const selected = authType === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`auth-${option}`}
                onPress={() => setAuthType(option)}
                style={[
                  styles.authChoice,
                  selected && { backgroundColor: colors.primary },
                ]}
              >
                <Feather
                  name={option === 'key' ? 'key' : 'lock'}
                  size={15}
                  color={selected ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.authChoiceText,
                    { color: selected ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {option === 'key' ? 'Private key' : 'Password'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {authType === 'password' ? (
          <FormField
            label="PASSWORD"
            value={secret}
            onChangeText={setSecret}
            placeholder={secureCredentialEntry ? 'Enter password' : 'Available on phone preview'}
            secureTextEntry
            editable={secureCredentialEntry}
          />
        ) : (
          <>
            <FormField
              label="PRIVATE KEY (PEM)"
              value={secret}
              onChangeText={setSecret}
              placeholder={secureCredentialEntry ? 'Paste private key' : 'Available on phone preview'}
              multiline
              secureTextEntry={false}
              editable={secureCredentialEntry}
            />
            <FormField
              label="KEY PASSPHRASE · OPTIONAL"
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder={secureCredentialEntry ? 'Enter passphrase' : 'Available on phone preview'}
              secureTextEntry
              editable={secureCredentialEntry}
            />
          </>
        )}
        <View style={[styles.secureNote, { borderLeftColor: colors.primary }]}>
          <Text style={[styles.secureNoteText, { color: colors.mutedForeground }]}>
            {secureCredentialEntry
              ? 'Credentials are saved in the phone’s secure storage. This preview will not connect or send commands.'
              : 'This browser preview cannot safely store a password or private key. Open the app on your phone to try this form.'}
          </Text>
        </View>
        <Pressable
          testID="save-machine"
          disabled={saving || !secureCredentialEntry}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
            (pressed || saving) && styles.pressed,
            !secureCredentialEntry && styles.disabledButton,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Feather name="save" size={16} color={colors.primaryForeground} />
          )}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
            {saving ? 'Saving securely…' : 'Save machine'}
          </Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  editable = true,
  keyboardType,
  autoCapitalize = 'none',
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  editable?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'url';
  autoCapitalize?: 'none' | 'words';
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        editable={editable}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.input,
            borderRadius: colors.radius,
            backgroundColor: colors.card,
          },
          multiline && styles.multilineInput,
          !editable && styles.disabledInput,
        ]}
      />
    </View>
  );
}

function TerminalScreen({
  machine,
  sample,
  onBack,
  topInset,
  bottomInset,
}: {
  machine: Machine;
  sample: boolean;
  onBack: () => void;
  topInset: number;
  bottomInset: number;
}) {
  const colors = useColors();
  const [paneIds, setPaneIds] = useState<string[]>(['terminal-1']);
  const [activeId, setActiveId] = useState('terminal-1');
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);

  const addPane = () => {
    const id = `terminal-${paneIds.length + 1}-${Date.now()}`;
    setPaneIds((current) => [...current, id]);
    setActiveId(id);
    setFullscreenId(null);
  };

  const closePane = (id: string) => {
    Alert.alert('Close terminal?', 'No remote session is active in this preview.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          const next = paneIds.filter((paneId) => paneId !== id);
          setPaneIds(next);
          if (activeId === id && next[0]) setActiveId(next[0]);
          if (fullscreenId === id) setFullscreenId(null);
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.terminalHeader, { paddingTop: topInset, backgroundColor: colors.card }]}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to machines"
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <View style={styles.terminalTitleBlock}>
          <Text style={[styles.terminalTitle, { color: colors.primary }]} numberOfLines={1}>
            {machine.name}
          </Text>
          <Text style={[styles.terminalSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {machine.username}@{machine.host}
          </Text>
        </View>
        <Pressable
          onPress={addPane}
          accessibilityRole="button"
          accessibilityLabel="Add terminal pane"
          testID="add-terminal"
          style={styles.iconButton}
        >
          <Feather name="plus" size={21} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={[styles.previewNotice, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
        <Feather name="info" size={15} color={colors.primary} />
        <Text style={[styles.previewNoticeText, { color: colors.foreground }]}>
          {sample
            ? 'Screen preview only. No SSH session or remote commands.'
            : 'SSH is not active in this preview. No commands are sent.'}
        </Text>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.panesContent,
          { paddingBottom: bottomInset },
          fullscreenId ? styles.fullscreenContent : null,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {(fullscreenId ? paneIds.filter((id) => id === fullscreenId) : paneIds).map((id, index) => (
          <View
            key={id}
            style={[
              styles.pane,
              { borderColor: id === activeId ? colors.primary : colors.border, backgroundColor: colors.background },
              fullscreenId ? styles.fullscreenPane : null,
            ]}
          >
            <Pressable
              onPress={() => setActiveId(id)}
              style={[styles.paneHeader, { backgroundColor: colors.card }]}
            >
              <View style={styles.paneHeading}>
                <Feather name="terminal" size={14} color={colors.primary} />
                <Text style={[styles.paneName, { color: colors.foreground }]}>
                  {paneIds.length > 1 ? `Terminal ${index + 1}` : 'Terminal 1'}
                </Text>
              </View>
              <View style={styles.paneActions}>
                <View style={[styles.statusDot, { backgroundColor: colors.mutedForeground }]} />
                <Text style={[styles.disconnectedText, { color: colors.mutedForeground }]}>PREVIEW</Text>
                <Pressable
                  onPress={() => setFullscreenId(fullscreenId === id ? null : id)}
                  accessibilityRole="button"
                  accessibilityLabel={fullscreenId === id ? 'Exit full screen' : 'Full screen'}
                  style={styles.paneIcon}
                >
                  <Feather
                    name={fullscreenId === id ? 'minimize-2' : 'maximize-2'}
                    size={15}
                    color={colors.mutedForeground}
                  />
                </Pressable>
                <Pressable
                  onPress={() => closePane(id)}
                  accessibilityRole="button"
                  accessibilityLabel="Close terminal"
                  style={styles.paneIcon}
                >
                  <Feather name="x" size={17} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </Pressable>
            <View style={styles.terminalOutput}>
              <Text style={[styles.terminalPrompt, { color: colors.primary }]}>$</Text>
              <Text style={[styles.terminalInfo, { color: colors.mutedForeground }]}>
                {sample
                  ? 'Terminal layout preview\nThe original app shows remote shell output here after SSH connects.'
                  : 'Waiting for SSH transport\nThis preview build does not open a remote connection.'}
              </Text>
              <View style={styles.previewCursorRow}>
                <Text style={[styles.terminalPrompt, { color: colors.primary }]}>›</Text>
                <View style={[styles.cursorBlock, { backgroundColor: colors.primary }]} />
              </View>
            </View>
            <View style={[styles.commandRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.terminalPrompt, { color: colors.primary }]}>›</Text>
              <TextInput
                editable={false}
                placeholder="Command entry is disabled in preview"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.commandInput, { color: colors.foreground }]}
                accessibilityLabel="Command input, unavailable in preview"
              />
              <Feather name="send" size={16} color={colors.mutedForeground} />
            </View>
          </View>
        ))}
        {!paneIds.length && (
          <View style={[styles.noPane, { borderColor: colors.border }]}>
            <Text style={[styles.messageText, { color: colors.mutedForeground }]}>
              No terminals. Tap + to add one.
            </Text>
          </View>
        )}
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => setCtrl((value) => !value)}
            style={[
              styles.toolbarKey,
              { borderColor: ctrl ? colors.primary : colors.border },
              ctrl && { backgroundColor: colors.primary },
            ]}
          >
            <Text style={[styles.toolbarLabel, { color: ctrl ? colors.primaryForeground : colors.foreground }]}>CTRL</Text>
          </Pressable>
          <Pressable
            onPress={() => setAlt((value) => !value)}
            style={[
              styles.toolbarKey,
              { borderColor: alt ? colors.primary : colors.border },
              alt && { backgroundColor: colors.primary },
            ]}
          >
            <Text style={[styles.toolbarLabel, { color: alt ? colors.primaryForeground : colors.foreground }]}>ALT</Text>
          </Pressable>
          {quickKeys.map((key) => (
            <View
              key={key.label}
              style={[styles.toolbarKey, styles.inactiveKey, { borderColor: colors.border }]}
            >
              <Feather name={key.icon} size={13} color={colors.mutedForeground} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  disabledButton: { opacity: 0.42 },
  topBar: { paddingHorizontal: 18, paddingBottom: 14 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { flex: 1, gap: 3 },
  eyebrow: { fontFamily: mono, fontSize: 9, letterSpacing: 1.3 },
  appTitle: { fontFamily: mono, fontSize: 13, fontWeight: '700', letterSpacing: 0.55 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topRule: { height: 1, opacity: 0.55, marginTop: 14 },
  homeContent: { paddingHorizontal: 17, paddingTop: 23, gap: 15 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
  sectionCount: { fontFamily: mono, fontSize: 9, letterSpacing: 0.7 },
  messagePanel: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 22 },
  messageText: { fontFamily: mono, fontSize: 12, textAlign: 'center', lineHeight: 19 },
  emptyCard: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderWidth: 1,
    borderRadius: 12,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontFamily: mono, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  bodyCopy: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 17,
    marginTop: 18,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: { fontFamily: mono, fontSize: 12, fontWeight: '700' },
  outlineButton: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  outlineButtonText: { fontFamily: mono, fontSize: 12 },
  workspaceBlock: { gap: 8 },
  workspaceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingBottom: 2 },
  workspaceName: { fontFamily: mono, fontSize: 13, fontWeight: '700', flex: 1 },
  workspaceCount: { fontFamily: mono, fontSize: 10 },
  machineCard: { minHeight: 72, borderWidth: 1, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  machineIcon: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  machineDetails: { flex: 1, gap: 5 },
  machineName: { fontFamily: mono, fontSize: 13, fontWeight: '700' },
  machineAddress: { fontFamily: mono, fontSize: 10 },
  machineEnd: { alignItems: 'flex-end', gap: 4 },
  authTag: { fontFamily: mono, fontSize: 8, letterSpacing: 1 },
  previewSection: { gap: 10, marginTop: 3 },
  previewCard: { padding: 14, borderWidth: 1, borderRadius: 10, gap: 9 },
  previewTopline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  previewDot: { width: 6, height: 6, borderRadius: 3 },
  previewLabel: { flex: 1, fontFamily: mono, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  previewTitle: { fontFamily: mono, fontSize: 13, fontWeight: '700' },
  footerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 1 },
  footerText: { fontFamily: mono, fontSize: 9 },
  subHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingBottom: 14, gap: 9 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  subHeaderText: { gap: 4 },
  subTitle: { fontFamily: mono, fontSize: 16, fontWeight: '700' },
  formContent: { paddingHorizontal: 18, paddingTop: 17, gap: 14 },
  formIntro: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 9, padding: 12, marginBottom: 1 },
  formIntroText: { flex: 1, fontSize: 11, lineHeight: 16 },
  fieldGroup: { gap: 7, flex: 1 },
  fieldLabel: { fontFamily: mono, fontSize: 9, fontWeight: '700', letterSpacing: 1.15 },
  input: {
    minHeight: 45,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: mono,
    fontSize: 12,
  },
  multilineInput: { minHeight: 115, textAlignVertical: 'top' },
  disabledInput: { opacity: 0.55 },
  formRow: { flexDirection: 'row', gap: 11 },
  portField: { width: 92 },
  userField: { flex: 1 },
  authChoices: { flexDirection: 'row', borderWidth: 1, borderRadius: 9, padding: 4, gap: 5 },
  authChoice: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 6 },
  authChoiceText: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  secureNote: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 2 },
  secureNoteText: { fontSize: 11, lineHeight: 16 },
  terminalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingBottom: 11, gap: 5 },
  terminalTitleBlock: { flex: 1, gap: 4 },
  terminalTitle: { fontFamily: mono, fontSize: 12, fontWeight: '700' },
  terminalSubtitle: { fontFamily: mono, fontSize: 9 },
  previewNotice: { minHeight: 39, borderWidth: 1, borderRadius: 7, marginHorizontal: 12, marginTop: 9, marginBottom: 7, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewNoticeText: { flex: 1, fontFamily: mono, fontSize: 9, lineHeight: 14 },
  panesContent: { paddingHorizontal: 10, paddingTop: 4, gap: 9 },
  fullscreenContent: { flexGrow: 1 },
  pane: { height: 260, borderWidth: 1, borderRadius: 9, overflow: 'hidden' },
  fullscreenPane: { flex: 1, height: undefined },
  paneHeader: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  paneHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paneName: { fontFamily: mono, fontSize: 10, fontWeight: '700' },
  paneActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  disconnectedText: { fontFamily: mono, fontSize: 8, letterSpacing: 0.65 },
  paneIcon: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  terminalOutput: { flex: 1, paddingHorizontal: 12, paddingTop: 13 },
  terminalPrompt: { fontFamily: mono, fontSize: 13, fontWeight: '700' },
  terminalInfo: { fontFamily: mono, fontSize: 10, lineHeight: 17, marginTop: 8 },
  previewCursorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  cursorBlock: { width: 7, height: 12, opacity: 0.9 },
  commandRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderTopWidth: 1 },
  commandInput: { flex: 1, paddingVertical: 8, fontFamily: mono, fontSize: 10 },
  noPane: { minHeight: 145, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingVertical: 9, paddingHorizontal: 1 },
  toolbarKey: { minWidth: 39, height: 37, paddingHorizontal: 7, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  inactiveKey: { backgroundColor: '#0d1117' },
  toolbarLabel: { fontFamily: mono, fontSize: 9, fontWeight: '700' },
});