import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import SSHClient, { PtyType } from '@dylankenneally/react-native-ssh-sftp';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCreateVercelSandbox, useCreateVercelSandboxTerminalTicket, useStopVercelSandbox } from '@workspace/api-client-react';
import type { VercelSandboxInfo } from '@workspace/api-client-react';
import { setBaseUrl } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AuthType = 'password' | 'key';
type ActiveVercelSandbox = VercelSandboxInfo & { expiresAt: number };
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
type AppScreen = 'home' | 'add' | 'guide' | 'settings' | 'sandbox' | 'terminal';
type RuntimeSettings = { apiBaseUrl: string; gatewayToken: string };

const MACHINE_STORAGE_KEY = 'htb-mobile-terminal:machines:v1';
const CREDENTIAL_STORAGE_PREFIX = 'htb-mobile-terminal-credential-';
const SETTINGS_KEY = 'htb-mobile-terminal-runtime-settings-v1';
const ACTIVE_SANDBOX_KEY = 'htb-mobile-terminal-active-vercel-sandbox-v1';
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const defaultApiBaseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
  : '';
const emptySettings: RuntimeSettings = { apiBaseUrl: defaultApiBaseUrl, gatewayToken: '' };

function isMachine(value: unknown): value is Machine {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.workspace === 'string' && typeof row.name === 'string' &&
    typeof row.host === 'string' && typeof row.port === 'number' && typeof row.username === 'string' &&
    (row.authType === 'password' || row.authType === 'key');
}

function isPrivateKeyPem(value: string): boolean {
  const key = value.trim();
  return /^-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(key) &&
    /-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----$/.test(key);
}

function isActiveVercelSandbox(value: unknown): value is ActiveVercelSandbox {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' &&
    (row.image === 'vercel/sandbox/node:22' || row.image === 'vercel/sandbox/python:3.13') &&
    row.timeout === '1h' && typeof row.expiresAt === 'number';
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<RuntimeSettings>(emptySettings);
  const [screen, setScreen] = useState<AppScreen>('home');
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const topInset = Platform.OS === 'web' ? 67 : Math.max(insets.top, 8);
  const bottomInset = insets.bottom + (Platform.OS === 'web' ? 34 : 12);

  const loadLocalState = async () => {
    setLoading(true);
    setStorageError('');
    try {
      const [rawMachines, rawSettings] = await Promise.all([
        AsyncStorage.getItem(MACHINE_STORAGE_KEY),
          Platform.OS === 'web' ? Promise.resolve(null) : SecureStore.getItemAsync(SETTINGS_KEY),
      ]);
      const parsed: unknown = rawMachines ? JSON.parse(rawMachines) : [];
      if (!Array.isArray(parsed) || !parsed.every(isMachine)) throw new Error('Saved machine data is not readable.');
      setMachines(parsed);
      const secureSettings = rawSettings ? JSON.parse(rawSettings) as RuntimeSettings : emptySettings;
      const savedApiBaseUrl = typeof secureSettings.apiBaseUrl === 'string' ? secureSettings.apiBaseUrl.trim() : '';
      const next = {
        apiBaseUrl: savedApiBaseUrl || defaultApiBaseUrl,
        gatewayToken: typeof secureSettings.gatewayToken === 'string' ? secureSettings.gatewayToken : '',
      };
      setSettings(next);
      setBaseUrl(next.apiBaseUrl.trim() || defaultApiBaseUrl || null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Local secure storage is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadLocalState(); }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, Machine[]>();
    machines.forEach((machine) => grouped.set(machine.workspace, [...(grouped.get(machine.workspace) ?? []), machine]));
    return Array.from(grouped.entries());
  }, [machines]);

  const saveMachine = async (machine: Machine, credential: Credential) => {
    const secureKey = `${CREDENTIAL_STORAGE_PREFIX}${machine.id}`;
    await SecureStore.setItemAsync(secureKey, JSON.stringify(credential));
    const next = [...machines, machine];
    try {
      await AsyncStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify(next));
      setMachines(next);
      setScreen('home');
      return true;
    } catch (error) {
      await SecureStore.deleteItemAsync(secureKey).catch(() => undefined);
      Alert.alert('Could not save machine', error instanceof Error ? error.message : 'Device storage is unavailable.');
      return false;
    }
  };

  const deleteMachine = (machine: Machine) => Alert.alert(
    `Delete ${machine.name}?`,
    'This removes its saved credential from this device.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        void (async () => {
          const key = `${CREDENTIAL_STORAGE_PREFIX}${machine.id}`;
          const previous = await SecureStore.getItemAsync(key);
          await SecureStore.deleteItemAsync(key);
          const next = machines.filter((item) => item.id !== machine.id);
          try {
            await AsyncStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify(next));
            setMachines(next);
          } catch (error) {
            if (previous) await SecureStore.setItemAsync(key, previous).catch(() => undefined);
            Alert.alert('Could not delete machine', error instanceof Error ? error.message : 'Storage is unavailable.');
          }
        })().catch((error: unknown) => Alert.alert('Could not delete credential', String(error)));
      } },
    ],
  );

  const openTerminal = (machine: Machine) => {
    setSelectedMachine(machine);
    setScreen('terminal');
  };

  if (screen === 'add') return <AddMachineScreen topInset={topInset} bottomInset={bottomInset} onBack={() => setScreen('home')} onSave={saveMachine} />;
  if (screen === 'guide') return <GuideScreen topInset={topInset} bottomInset={bottomInset} onBack={() => setScreen('home')} />;
  if (screen === 'settings') return <SettingsScreen topInset={topInset} bottomInset={bottomInset} onBack={() => setScreen('home')} initial={settings} onSave={async (next) => {
    await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setBaseUrl(next.apiBaseUrl.trim() || defaultApiBaseUrl || null);
    setScreen('home');
  }} />;
  if (screen === 'sandbox') return <SandboxScreen topInset={topInset} bottomInset={bottomInset} settings={settings} onBack={() => setScreen('home')} />;
  if (screen === 'terminal' && selectedMachine) return <NativeTerminalScreen machine={selectedMachine} topInset={topInset} bottomInset={bottomInset} onBack={() => setScreen('home')} />;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.topBar, { paddingTop: topInset, backgroundColor: colors.card }]}>
        <View style={styles.brandLine}>
          <View style={[styles.brandMark, { borderColor: colors.primary }]}><Feather name="terminal" size={16} color={colors.primary} /></View>
          <View style={styles.brandText}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>AUTHORIZED HOSTS · MOBILE SSH</Text>
            <Text style={[styles.appTitle, { color: colors.primary }]}>FIELD TERMINAL</Text>
          </View>
          <IconButton icon="plus" label="Add SSH profile" onPress={() => setScreen('add')} />
        </View>
        <View style={[styles.topRule, { backgroundColor: colors.primary }]} />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={[styles.homeContent, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <View style={styles.sectionHeading}>
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>SAVED SSH PROFILES</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{machines.length.toString().padStart(2, '0')} MACHINES</Text>
        </View>
        {loading ? <View style={styles.messagePanel}><ActivityIndicator color={colors.primary} /><Text style={[styles.messageText, { color: colors.mutedForeground }]}>Reading secure profiles…</Text></View>
          : storageError ? <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="alert-circle" size={23} color={colors.destructive} /><Text style={[styles.bodyCopy, { color: colors.foreground }]}>{storageError}</Text><ActionButton title="Try again" icon="refresh-cw" onPress={() => void loadLocalState()} /></View>
            : groups.length === 0 ? <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={[styles.emptyIcon, { borderColor: colors.border }]}><Feather name="server" size={22} color={colors.primary} /></View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No SSH profiles yet</Text>
              <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>Save a Replit development shell or another authorized SSH host. Private credentials stay on this device.</Text>
              <ActionButton title="Add SSH profile" icon="plus" onPress={() => setScreen('add')} />
            </View> : groups.map(([workspace, rows]) => <View key={workspace} style={styles.workspaceBlock}>
              <View style={styles.workspaceHeader}><Feather name="folder" size={14} color={colors.primary} /><Text style={[styles.workspaceName, { color: colors.primary }]}>{workspace}</Text><Text style={[styles.workspaceCount, { color: colors.mutedForeground }]}>{rows.length.toString().padStart(2, '0')}</Text></View>
              {rows.map((machine) => <Pressable key={machine.id} onPress={() => openTerminal(machine)} onLongPress={Platform.OS === 'web' ? undefined : () => deleteMachine(machine)} accessibilityRole="button" accessibilityLabel={`Connect to ${machine.name}; long press to delete`} style={({ pressed }) => [styles.machineCard, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}>
                <View style={[styles.machineIcon, { backgroundColor: colors.secondary }]}><Feather name="server" size={17} color={colors.primary} /></View>
                <View style={styles.machineDetails}><Text style={[styles.machineName, { color: colors.foreground }]}>{machine.name}</Text><Text style={[styles.machineAddress, { color: colors.mutedForeground }]}>{machine.username}@{machine.host}:{machine.port}</Text></View>
                <View style={styles.machineEnd}><Text style={[styles.authTag, { color: colors.mutedForeground }]}>{machine.authType === 'key' ? 'KEY' : 'PASSWORD'}</Text><Feather name="chevron-right" size={17} color={colors.mutedForeground} /></View>
              </Pressable>)}
            </View>)}
        <Text style={[styles.kicker, { color: colors.mutedForeground, marginTop: 10 }]}>TOOLS & CONFIGURATION</Text>
        <MenuRow icon="box" title="Vercel Sandbox" detail="Create, connect, and stop a 1-hour shell" onPress={() => setScreen('sandbox')} />
        <MenuRow icon="book-open" title="Connection guide" detail="Replit SSH and Vercel Sandbox setup" onPress={() => setScreen('guide')} />
        <MenuRow icon="sliders" title="API & gateway settings" detail={settings.apiBaseUrl && settings.gatewayToken ? 'Server configured in secure storage' : 'Required to use Vercel Sandbox'} onPress={() => setScreen('settings')} />
        <View style={[styles.hostInfo, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="shield" size={16} color={colors.primary} /><View style={styles.hostInfoContent}><Text style={[styles.hostInfoTitle, { color: colors.foreground }]}>Authorized access only</Text><Text style={[styles.hostInfoText, { color: colors.mutedForeground }]}>Native SSH connects directly from this device. Browser preview never opens SSH. The SSH library cannot verify server host keys, so the app requires an explicit warning confirmation before connecting.</Text></View>
        </View>
      </ScrollView>
    </View>
  );
}

function IconButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Feather name={icon} size={21} color={colors.foreground} /></Pressable>;
}

function ActionButton({ title, icon, onPress, disabled, busy }: { title: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const colors = useColors();
  return <Pressable disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary, borderRadius: colors.radius }, (pressed || disabled || busy) && styles.disabled]}>
    {busy ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : <Feather name={icon} size={16} color={colors.primaryForeground} />}
    <Text style={[styles.actionButtonText, { color: colors.primaryForeground }]}>{title}</Text>
  </Pressable>;
}

function MenuRow({ icon, title, detail, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; detail: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}>
    <Feather name={icon} size={18} color={colors.primary} /><View style={styles.menuCopy}><Text style={[styles.machineName, { color: colors.foreground }]}>{title}</Text><Text style={[styles.machineAddress, { color: colors.mutedForeground }]}>{detail}</Text></View><Feather name="chevron-right" size={17} color={colors.mutedForeground} />
  </Pressable>;
}

function ScreenHeader({ title, kicker, topInset, onBack }: { title: string; kicker: string; topInset: number; onBack: () => void }) {
  const colors = useColors();
  return <View style={[styles.subHeader, { paddingTop: topInset, backgroundColor: colors.card }]}>
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}><Feather name="arrow-left" size={21} color={colors.foreground} /></Pressable>
    <View style={styles.subHeaderText}><Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{kicker}</Text><Text style={[styles.subTitle, { color: colors.foreground }]}>{title}</Text></View>
  </View>;
}

function FormField({ label, value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType, autoCapitalize, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder: string; secureTextEntry?: boolean; multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'url'; autoCapitalize?: 'none' | 'words'; editable?: boolean;
}) {
  const colors = useColors();
  return <View style={styles.fieldGroup}><Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.mutedForeground}
      secureTextEntry={secureTextEntry} multiline={multiline} editable={editable} keyboardType={keyboardType ?? 'default'}
      autoCapitalize={autoCapitalize ?? 'none'} autoCorrect={false} spellCheck={false}
      style={[styles.input, { color: colors.foreground, borderColor: colors.input, borderRadius: colors.radius, backgroundColor: colors.card }, multiline && styles.multilineInput, !editable && styles.disabled]} />
  </View>;
}

function AddMachineScreen({ topInset, bottomInset, onBack, onSave }: { topInset: number; bottomInset: number; onBack: () => void; onSave: (machine: Machine, credential: Credential) => Promise<boolean> }) {
  const colors = useColors();
  const [workspace, setWorkspace] = useState('Replit');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('key');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const canEnterCredential = Platform.OS !== 'web';
  const submit = async () => {
    const normalizedPort = port.trim();
    const parsedPort = Number.parseInt(normalizedPort, 10);
    if (!canEnterCredential) return Alert.alert('Native device required', 'Browser preview stays disconnected. Use the native Android or iOS build to save credentials and connect.');
    if (!name.trim() || !host.trim() || !username.trim() || !secret) return Alert.alert('Required fields', `Enter profile name, host, username, and ${authType === 'key' ? 'private key' : 'password'}.`);
    if (/\s/.test(host.trim())) return Alert.alert('Invalid host', 'Enter a hostname or IP address without spaces.');
    if (!/^\d{1,5}$/.test(normalizedPort) || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return Alert.alert('Invalid port', 'Enter a port between 1 and 65535.');
    if (authType === 'key' && !isPrivateKeyPem(secret)) return Alert.alert('Private key format not recognized', 'Paste the complete private key, including its BEGIN and END lines.');
    setSaving(true);
    try {
      const credential: Credential = authType === 'key'
        ? { privateKey: secret, passphrase: passphrase || undefined }
        : { password: secret };
      const saved = await onSave({ id: makeId(), workspace: workspace.trim() || 'Replit', name: name.trim(), host: host.trim(), port: parsedPort, username: username.trim(), authType }, credential);
      if (saved) {
        setSecret('');
        setPassphrase('');
      }
    } catch (error) { Alert.alert('Could not save profile', error instanceof Error ? error.message : 'Secure device storage is unavailable.'); }
    finally { setSaving(false); }
  };
  return <View style={[styles.root, { backgroundColor: colors.background }]}><StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <ScreenHeader title="Add SSH profile" kicker="DIRECT SSH / PROFILE" topInset={topInset} onBack={onBack} />
    <KeyboardAwareScrollViewCompat style={styles.flex} contentContainerStyle={[styles.formContent, { paddingBottom: bottomInset }]} bottomOffset={72} keyboardShouldPersistTaps="handled">
      <Notice icon="info" text="Use Replit’s Connect manually values for the development shell. Published Replit URLs are not SSH hosts." />
      <FormField label="WORKSPACE" value={workspace} onChangeText={setWorkspace} placeholder="Replit" autoCapitalize="words" />
      <FormField label="PROFILE NAME" value={name} onChangeText={setName} placeholder="My development Repl" />
      <FormField label="SSH HOST" value={host} onChangeText={setHost} placeholder="Host from Connect manually" keyboardType="url" />
      <View style={styles.formRow}><View style={styles.portField}><FormField label="PORT" value={port} onChangeText={setPort} placeholder="22" keyboardType="number-pad" /></View><View style={styles.userField}><FormField label="USERNAME" value={username} onChangeText={setUsername} placeholder="SSH username" /></View></View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>AUTHENTICATION</Text>
      <View style={styles.authChoiceRow}>
        {(['key', 'password'] as const).map((option) => {
          const selected = authType === option;
          return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => {
            setAuthType(option);
            setSecret('');
            setPassphrase('');
          }} style={[styles.authChoice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}>
            <Feather name={selected ? 'check-circle' : 'circle'} size={16} color={selected ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.optionLabel, { color: colors.foreground }]}>{option === 'key' ? 'Private key' : 'Password'}</Text>
          </Pressable>;
        })}
      </View>
      <FormField label={authType === 'key' ? 'PRIVATE KEY (PEM)' : 'SSH PASSWORD'} value={secret} onChangeText={setSecret}
        placeholder={canEnterCredential ? (authType === 'key' ? 'Paste complete private key' : 'Password supplied by the host or lab') : 'Available in native builds'}
        secureTextEntry={authType === 'password'} multiline={authType === 'key'} editable={canEnterCredential} />
      {authType === 'key' && <FormField label="KEY PASSPHRASE · OPTIONAL" value={passphrase} onChangeText={setPassphrase} placeholder="Leave blank if the key has no passphrase" secureTextEntry editable={canEnterCredential} />}
      <View style={[styles.securityNote, { borderLeftColor: colors.primary }]}><Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>The selected password or private key is stored in device SecureStore. This SSH library cannot verify server host keys; the terminal will ask you to acknowledge that limitation before each connection.</Text></View>
      {!canEnterCredential && <Notice icon="monitor" text="Browser preview is disconnected and cannot save SSH credentials. Continue from an Android or iOS native build." />}
      <ActionButton title={saving ? 'Saving securely…' : 'Save profile'} icon="save" onPress={() => void submit()} busy={saving} disabled={!canEnterCredential} />
    </KeyboardAwareScrollViewCompat>
  </View>;
}

function Notice({ icon, text, warning }: { icon: React.ComponentProps<typeof Feather>['name']; text: string; warning?: boolean }) {
  const colors = useColors();
  return <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name={icon} size={16} color={warning ? colors.destructive : colors.primary} /><Text style={[styles.noticeText, { color: colors.mutedForeground }]}>{text}</Text></View>;
}

function GuideScreen({ topInset, bottomInset, onBack }: { topInset: number; bottomInset: number; onBack: () => void }) {
  const colors = useColors();
  return <View style={[styles.root, { backgroundColor: colors.background }]}><StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <ScreenHeader title="Connection guide" kicker="SETUP / REFERENCE" topInset={topInset} onBack={onBack} />
    <ScrollView style={styles.flex} contentContainerStyle={[styles.formContent, { paddingBottom: bottomInset }]}>
      <GuideStep number="01" title="Get SSH connection details" body="Replit: open the workspace SSH pane, choose Connect manually, add/select your public key, then copy the host and username shown (port 22). Do not use a published app URL. Hack The Box: start an authorized lab machine and use its target IP plus the SSH username and password/key supplied by the lab. Connect Android to the HTB VPN first with the official OpenVPN or WireGuard profile. Other hosts: ask the administrator for the SSH host, port, username, and allowed login method." />
      <GuideStep number="02" title="Choose password or private key" body="Password: use the SSH password issued by the host administrator or lab; this app stores it only in Android/iOS SecureStore. Key: on a trusted computer, create a key pair (for example, ssh-keygen -t rsa -b 3072 -f ~/.ssh/htb-mobile). Install the .pub file on the authorized account or Replit SSH settings, then paste the matching private-key file here. Enter its passphrase if you set one. Never share the private key." />
      <GuideStep number="03" title="Connect from the native app" body="Tap a saved profile on Android (or a supported physical iOS device). The browser preview is intentionally disconnected. Replit development shells run as a standard user; HTB machines must be reachable through the phone’s active VPN." />
      <Notice warning icon="alert-triangle" text="Important: the included SSH library disables host-key verification. It cannot detect a server impersonator or compare a pinned fingerprint. Only use trusted networks and non-sensitive sessions; the app asks you to acknowledge this before each connection." />
      <View style={[styles.guidePanel, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[styles.machineName, { color: colors.foreground }]}>Vercel Sandbox credentials</Text>
        <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>1) Create a Vercel token at vercel.com/account/tokens, preferably scoped and time-limited. 2) Find the Project ID in Vercel Project Settings → General; if it is a team project, also copy the Team ID from team settings. 3) On the trusted API server, add VERCEL_TOKEN, VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID, and a separate random TERMINAL_GATEWAY_TOKEN as server-side Secrets. You can generate the gateway value locally with openssl rand -hex 32. 4) In this app’s API & gateway settings, enter the API server’s HTTPS origin and the same TERMINAL_GATEWAY_TOKEN. Never put VERCEL_TOKEN in the mobile app or repository. Vercel Sandboxes are separate from deployed Vercel URLs and are limited to one hour here; stopping preserves their filesystem snapshot. Sudo is an explicit opt-in.</Text>
      </View>
      <Notice icon="shield" text="Treat VERCEL_TOKEN, TERMINAL_GATEWAY_TOKEN, passwords, private keys, and passphrases as secrets. Never commit them or send them in chat." />
    </ScrollView>
  </View>;
}

function GuideStep({ number, title, body }: { number: string; title: string; body: string }) {
  const colors = useColors();
  return <View style={[styles.guideStep, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[styles.stepNumber, { color: colors.primary }]}>{number}</Text><View style={styles.guideCopy}><Text style={[styles.machineName, { color: colors.foreground }]}>{title}</Text><Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>{body}</Text></View></View>;
}

function SettingsScreen({ topInset, bottomInset, onBack, initial, onSave }: { topInset: number; bottomInset: number; onBack: () => void; initial: RuntimeSettings; onSave: (settings: RuntimeSettings) => Promise<void> }) {
  const colors = useColors();
  const secureStorageAvailable = Platform.OS !== 'web';
  const [apiBaseUrl, setApiBaseUrl] = useState(initial.apiBaseUrl);
  const [gatewayToken, setGatewayToken] = useState(initial.gatewayToken);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!secureStorageAvailable) return Alert.alert('Native app required', 'The browser preview cannot store the gateway token securely. Configure this in the Android or iOS app.');
    const value = apiBaseUrl.trim().replace(/\/+$/, '');
    if (!value) return Alert.alert('API URL required', 'Enter the API server origin.');
    let parsedUrl: URL;
    try { parsedUrl = new URL(value); }
    catch { return Alert.alert('Invalid API URL', 'Enter a valid API server origin.'); }
    const localHttpAllowed = parsedUrl.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
    if ((parsedUrl.protocol !== 'https:' && !localHttpAllowed) ||
      parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash ||
      parsedUrl.username || parsedUrl.password) {
      return Alert.alert('Invalid API URL', 'Use an HTTPS API server origin. HTTP is allowed only for localhost development.');
    }
    if (!gatewayToken.trim()) return Alert.alert('Gateway token required', 'Enter the shared TERMINAL_GATEWAY_TOKEN configured on the server.');
    setSaving(true);
    try { await onSave({ apiBaseUrl: parsedUrl.origin, gatewayToken: gatewayToken.trim() }); }
    catch (error) { Alert.alert('Could not save settings', error instanceof Error ? error.message : 'SecureStore is unavailable.'); }
    finally { setSaving(false); }
  };
  return <View style={[styles.root, { backgroundColor: colors.background }]}><StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <ScreenHeader title="API & gateway" kicker="RUNTIME / SECURE CONFIG" topInset={topInset} onBack={onBack} />
    <KeyboardAwareScrollViewCompat style={styles.flex} contentContainerStyle={[styles.formContent, { paddingBottom: bottomInset }]} bottomOffset={72} keyboardShouldPersistTaps="handled">
      <Notice warning icon="alert-circle" text="Both values are required for Sandbox API actions. Missing settings are never replaced with a simulated connection." />
      {!secureStorageAvailable && <Notice warning icon="lock" text="Browser preview cannot store the gateway token securely. Enter these values only in the native Android or iOS app." />}
      <FormField label="API BASE URL" value={apiBaseUrl} onChangeText={setApiBaseUrl} placeholder="https://your-api.example" keyboardType="url" editable={secureStorageAvailable} />
      <FormField label="SHARED TERMINAL_GATEWAY_TOKEN" value={gatewayToken} onChangeText={setGatewayToken} placeholder="Server-shared gateway token" secureTextEntry editable={secureStorageAvailable} />
      <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>Values are kept in native device SecureStore and sent only to the configured API. Use the same shared token configured for the terminal gateway. Do not enter or ship VERCEL_TOKEN.</Text>
      <ActionButton title={saving ? 'Saving securely…' : 'Save settings'} icon="save" onPress={() => void save()} busy={saving} disabled={!secureStorageAvailable} />
    </KeyboardAwareScrollViewCompat>
  </View>;
}

function SandboxScreen({ topInset, bottomInset, settings, onBack }: { topInset: number; bottomInset: number; settings: RuntimeSettings; onBack: () => void }) {
  const colors = useColors();
  const configured = Boolean(settings.apiBaseUrl.trim() && settings.gatewayToken.trim());
  const createSandbox = useCreateVercelSandbox();
  const stopSandbox = useStopVercelSandbox();
  const createTicket = useCreateVercelSandboxTerminalTicket();
  const [name, setName] = useState(`mobile-${Math.random().toString(36).slice(2, 7)}`);
  const [image, setImage] = useState<'vercel/sandbox/node:22' | 'vercel/sandbox/python:3.13'>('vercel/sandbox/node:22');
  const [sandbox, setSandbox] = useState<ActiveVercelSandbox | null>(null);
  const [sudo, setSudo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [terminalState, setTerminalState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const socketUrl = useMemo(() => {
    const base = settings.apiBaseUrl.trim().replace(/\/+$/, '');
    return base ? `${base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')}` : '';
  }, [settings.apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'web') {
      void SecureStore.getItemAsync(ACTIVE_SANDBOX_KEY)
        .then(async (raw) => {
          if (!raw || cancelled) return;
          const parsed: unknown = JSON.parse(raw);
          if (isActiveVercelSandbox(parsed) && parsed.expiresAt > Date.now()) {
            setSandbox(parsed);
          } else {
            await SecureStore.deleteItemAsync(ACTIVE_SANDBOX_KEY);
          }
        })
        .catch(() => {
          Alert.alert('Saved Sandbox unavailable', 'The locally saved Sandbox details could not be read.');
        });
    }
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, []);

  const create = async () => {
    if (!configured) return Alert.alert('Server settings missing', 'Set the API base URL and shared gateway token in Settings before creating a Sandbox.');
    if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(name.trim())) return Alert.alert('Invalid Sandbox name', 'Use 3–48 lowercase letters, numbers, or hyphens; start with a letter or number.');
    setBusy(true);
    try {
      const response = await createSandbox.mutateAsync({ data: { name: name.trim(), image } });
      const created: ActiveVercelSandbox = {
        ...response,
        expiresAt: Date.now() + 61 * 60 * 1000,
      };
      setSandbox(created);
      setOutput('');
      setTerminalState('idle');
      try {
        await SecureStore.setItemAsync(ACTIVE_SANDBOX_KEY, JSON.stringify(created));
      } catch {
        Alert.alert('Sandbox created', 'The active Sandbox could not be saved on this device. Stop it before leaving this screen.');
      }
    } catch (error) { Alert.alert('Sandbox was not created', error instanceof Error ? error.message : 'The configured API request failed.'); }
    finally { setBusy(false); }
  };

  const connect = async () => {
    if (!configured) return Alert.alert('Server settings missing', 'Set the API base URL and shared gateway token in Settings before connecting.');
    if (!sandbox) return Alert.alert('No Sandbox', 'Create a Sandbox before opening its terminal.');
    setBusy(true);
    setTerminalState('connecting');
    try {
      const ticketResponse = await createTicket.mutateAsync({ name: sandbox.name, data: { sudo } });
      const url = `${socketUrl}/api/vercel-sandboxes/${encodeURIComponent(sandbox.name)}/terminal?ticket=${encodeURIComponent(ticketResponse.ticket)}`;
      const socket = new WebSocket(url);
      socketRef.current?.close();
      socketRef.current = socket;
      socket.onopen = () => { setTerminalState('connected'); setOutput((previous) => previous + '\n[Gateway WebSocket connected]\n'); };
      socket.onmessage = (event) => setOutput((previous) => `${previous}${typeof event.data === 'string' ? event.data : ''}`.slice(-24000));
      socket.onerror = () => { setTerminalState('error'); setOutput((previous) => `${previous}\n[WebSocket error]\n`); };
      socket.onclose = () => { setTerminalState((state) => state === 'error' ? 'error' : 'idle'); };
    } catch (error) {
      setTerminalState('error');
      Alert.alert('Could not connect', error instanceof Error ? error.message : 'The ticket request failed. Check server settings and access.');
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!sandbox || !configured) return;
    setBusy(true);
    try {
      socketRef.current?.close();
      socketRef.current = null;
      await stopSandbox.mutateAsync({ name: sandbox.name });
      setSandbox(null);
      setTerminalState('idle');
      setOutput('');
      await SecureStore.deleteItemAsync(ACTIVE_SANDBOX_KEY).catch(() => undefined);
    } catch (error) { Alert.alert('Could not stop Sandbox', error instanceof Error ? error.message : 'The configured API request failed.'); }
    finally { setBusy(false); }
  };

  const send = () => {
    if (terminalState !== 'connected' || !socketRef.current || !command.trim()) return;
    socketRef.current.send(`${command}\n`);
    setOutput((previous) => `${previous}$ ${command}\n`);
    setCommand('');
    Keyboard.dismiss();
  };

  return <View style={[styles.root, { backgroundColor: colors.background }]}><StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <ScreenHeader title="Vercel Sandbox" kicker="EPHEMERAL SHELL / 1 HOUR" topInset={topInset} onBack={onBack} />
    <KeyboardAwareScrollViewCompat style={styles.flex} contentContainerStyle={[styles.formContent, { paddingBottom: bottomInset }]} bottomOffset={78} keyboardShouldPersistTaps="handled">
      {!configured && <Notice warning icon="alert-circle" text="API base URL and TERMINAL_GATEWAY_TOKEN are missing. Configure both in API & gateway settings; Sandbox actions remain unavailable." />}
      <FormField label="SANDBOX NAME" value={name} onChangeText={setName} placeholder="mobile-sandbox" />
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>RUNTIME IMAGE</Text>
      {(['vercel/sandbox/node:22', 'vercel/sandbox/python:3.13'] as const).map((option) => {
        const selected = image === option;
        return <Pressable key={option} onPress={() => setImage(option)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.optionRow, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.card }]}>
          <Feather name={selected ? 'check-circle' : 'circle'} size={17} color={selected ? colors.primary : colors.mutedForeground} /><Text style={[styles.optionLabel, { color: colors.foreground }]}>{option}</Text>
        </Pressable>;
      })}
      {sandbox ? <View style={[styles.sandboxStatus, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.workspaceHeader}><View style={[styles.statusDot, { backgroundColor: colors.primary }]} /><Text style={[styles.machineName, { color: colors.foreground }]}>{sandbox.name}</Text><Text style={[styles.authTag, { color: colors.primary }]}>ACTIVE · 1H</Text></View>
        <Text style={[styles.machineAddress, { color: colors.mutedForeground }]}>{sandbox.image} · automatic lifetime {sandbox.timeout}</Text>
      </View> : <Notice icon="clock" text="A created Sandbox is time-limited to one hour. Stop it when finished; filesystem snapshot is retained server-side." />}
      <View style={[styles.sudoRow, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={styles.menuCopy}><Text style={[styles.machineName, { color: colors.foreground }]}>Request sudo access</Text><Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>Explicit opt-in. Off by default.</Text></View><Switch value={sudo} onValueChange={setSudo} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.foreground} accessibilityLabel="Opt in to sudo" /></View>
      {!sandbox ? <ActionButton title={busy ? 'Creating Sandbox…' : 'Start Sandbox'} icon="play" onPress={() => void create()} busy={busy} disabled={!configured} />
        : <View style={styles.buttonRow}>
          <ActionButton title={busy ? 'Working…' : 'Connect terminal'} icon="terminal" onPress={() => void connect()} busy={busy} disabled={!configured || terminalState === 'connected'} />
          <Pressable disabled={busy || !configured} onPress={() => void stop()} style={({ pressed }) => [styles.stopButton, { borderColor: colors.destructive }, pressed && styles.pressed]}><Feather name="square" size={15} color={colors.destructive} /><Text style={[styles.stopButtonText, { color: colors.destructive }]}>Stop</Text></Pressable>
        </View>}
      {sandbox && <View style={[styles.sandboxTerminal, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.paneHeader}><Text style={[styles.kicker, { color: terminalState === 'connected' ? colors.primary : colors.mutedForeground }]}>GATEWAY / {terminalState.toUpperCase()}</Text><Text style={[styles.authTag, { color: colors.mutedForeground }]}>{sudo ? 'SUDO REQUESTED' : 'STANDARD USER'}</Text></View>
        <ScrollView style={styles.outputScroll}><Text selectable style={[styles.outputText, { color: colors.foreground }]}>{output || 'Terminal output will appear after the ticket-backed WebSocket opens.'}</Text></ScrollView>
        <View style={[styles.commandRow, { borderTopColor: colors.border }]}><Text style={[styles.terminalPrompt, { color: colors.primary }]}>$</Text><TextInput value={command} onChangeText={setCommand} editable={terminalState === 'connected'} onSubmitEditing={send} placeholder={terminalState === 'connected' ? 'Enter command' : 'Connect to enable command input'} placeholderTextColor={colors.mutedForeground} style={[styles.commandInput, { color: colors.foreground }]} returnKeyType="send" autoCapitalize="none" /><Pressable accessibilityRole="button" accessibilityLabel="Send command" disabled={terminalState !== 'connected'} onPress={send}><Feather name="send" size={16} color={terminalState === 'connected' ? colors.primary : colors.mutedForeground} /></Pressable></View>
      </View>}
      <Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>The ticket is short-lived and single-use. A new connect attempt requests a new ticket; the gateway URL contains the ticket, not the shared token.</Text>
    </KeyboardAwareScrollViewCompat>
  </View>;
}

function NativeTerminalScreen({ machine, topInset, bottomInset, onBack }: { machine: Machine; topInset: number; bottomInset: number; onBack: () => void }) {
  const colors = useColors();
  const clientRef = useRef<SSHClient | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [credentialMissing, setCredentialMissing] = useState(false);
  useEffect(() => () => {
    const client = clientRef.current;
    if (client) {
      client.off('Shell');
      client.closeShell();
      client.disconnect();
      clientRef.current = null;
    }
  }, []);

  const connectDirect = async () => {
    setConnecting(true);
    setStatus('connecting');
    setOutput('');
    setCredentialMissing(false);
    try {
      const raw = await SecureStore.getItemAsync(`${CREDENTIAL_STORAGE_PREFIX}${machine.id}`);
      if (!raw) { setCredentialMissing(true); throw new Error('Saved credential is missing. Delete and recreate this profile.'); }
      const credential = JSON.parse(raw) as Credential;
      const client = 'privateKey' in credential
        ? await SSHClient.connectWithKey(machine.host, machine.port, machine.username, credential.privateKey, credential.passphrase)
        : await SSHClient.connectWithPassword(machine.host, machine.port, machine.username, credential.password);
      clientRef.current = client;
      client.on('Shell', (event: unknown) => {
        const text = typeof event === 'string' ? event : JSON.stringify(event);
        setOutput((previous) => (previous + text).slice(-24000));
      });
      const initial = await client.startShell(PtyType.XTERM);
      if (initial) setOutput(String(initial));
      setStatus('connected');
    } catch (error) {
      if (clientRef.current) {
        clientRef.current.off('Shell');
        clientRef.current.closeShell();
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      setStatus('error');
      setOutput((previous) => `${previous}\n${error instanceof Error ? error.message : 'SSH connection failed.'}\n`);
      Alert.alert('SSH connection failed', error instanceof Error ? error.message : 'Could not establish SSH session.');
    } finally { setConnecting(false); }
  };

  const connect = () => {
    if (Platform.OS === 'web') return Alert.alert('Native build required', 'Browser preview is intentionally disconnected from SSH. Use the Android or iOS app.');
    Alert.alert(
      'SSH host identity is not verified',
      'This SSH library disables host-key verification and cannot confirm the server’s identity. Only continue on a trusted network with a host you expect.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I understand — connect', style: 'destructive', onPress: () => { void connectDirect(); } },
      ],
    );
  };

  const disconnect = () => {
    const client = clientRef.current;
    if (client) {
      client.off('Shell');
      client.closeShell();
      client.disconnect();
      clientRef.current = null;
    }
    setStatus('idle');
  };

  const send = async () => {
    const client = clientRef.current;
    if (!client || status !== 'connected' || !command) return;
    const line = command;
    setCommand('');
    try { await client.writeToShell(`${line}\n`); }
    catch (error) { setStatus('error'); setOutput((previous) => `${previous}\n${error instanceof Error ? error.message : 'Write failed.'}\n`); }
  };

  return <View style={[styles.root, { backgroundColor: colors.background }]}><StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <ScreenHeader title={machine.name} kicker={`${machine.username}@${machine.host}:${machine.port}`} topInset={topInset} onBack={() => { disconnect(); onBack(); }} />
    <View style={[styles.terminalNotice, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="alert-triangle" size={15} color={colors.destructive} /><Text style={[styles.noticeText, { color: colors.foreground }]}>Host identity is not verified. Confirm before each connection; use trusted networks only.</Text></View>
    {Platform.OS === 'web' ? <View style={styles.nativeDisconnected}><Feather name="smartphone" size={25} color={colors.primary} /><Text style={[styles.machineName, { color: colors.foreground }]}>Native connection only</Text><Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>Browser preview remains disconnected. Open an Android or iOS native build to connect directly from your device.</Text></View> : <>
      {credentialMissing && <Notice warning icon="key" text="No saved secure credential was found for this profile." />}
      <View style={styles.connectionActions}>
        <View style={styles.statusLine}><View style={[styles.statusDot, { backgroundColor: status === 'connected' ? colors.primary : status === 'error' ? colors.destructive : colors.mutedForeground }]} /><Text style={[styles.kicker, { color: colors.mutedForeground }]}>{status.toUpperCase()}</Text></View>
        {status === 'connected' ? <Pressable onPress={disconnect} style={[styles.stopButton, { borderColor: colors.destructive }]}><Feather name="square" size={14} color={colors.destructive} /><Text style={[styles.stopButtonText, { color: colors.destructive }]}>Disconnect</Text></Pressable> : <Pressable disabled={connecting} onPress={() => void connect()} style={[styles.connectButton, { backgroundColor: colors.primary }, connecting && styles.disabled]}>{connecting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="link" size={15} color={colors.primaryForeground} />}<Text style={[styles.actionButtonText, { color: colors.primaryForeground }]}>{connecting ? 'Connecting…' : 'Connect directly'}</Text></Pressable>}
      </View>
      <View style={[styles.nativeTerminal, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <ScrollView style={styles.nativeOutput}><Text selectable style={[styles.outputText, { color: colors.foreground }]}>{output || (status === 'connecting' ? 'Opening direct SSH transport…' : 'SSH shell output will render here after connection.')}</Text></ScrollView>
        <View style={[styles.commandRow, { borderTopColor: colors.border }]}><Text style={[styles.terminalPrompt, { color: colors.primary }]}>$</Text><TextInput value={command} onChangeText={setCommand} editable={status === 'connected'} onSubmitEditing={() => void send()} placeholder={status === 'connected' ? 'Enter command' : 'Connect to enable shell'} placeholderTextColor={colors.mutedForeground} style={[styles.commandInput, { color: colors.foreground }]} autoCapitalize="none" returnKeyType="send" /><Pressable accessibilityRole="button" accessibilityLabel="Send command" disabled={status !== 'connected'} onPress={() => void send()}><Feather name="send" size={16} color={status === 'connected' ? colors.primary : colors.mutedForeground} /></Pressable></View>
      </View>
      <View style={[styles.sessionFootnote, { borderColor: colors.border }]}><Feather name="shield" size={14} color={colors.primary} /><Text style={[styles.bodyCopy, { color: colors.mutedForeground }]}>Direct device-to-host SSH. Use only hosts you own or are authorized to access.</Text></View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  topBar: { paddingHorizontal: 18, paddingBottom: 14 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 34, height: 34, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  brandText: { flex: 1, gap: 3 },
  eyebrow: { fontFamily: mono, fontSize: 9, letterSpacing: 1.2 },
  appTitle: { fontFamily: mono, fontSize: 14, fontWeight: '700', letterSpacing: 0.7 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topRule: { height: 1, opacity: 0.55, marginTop: 14 },
  homeContent: { paddingHorizontal: 17, paddingTop: 22, gap: 13 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 1.35, fontWeight: '700' },
  sectionCount: { fontFamily: mono, fontSize: 9, letterSpacing: 0.7 },
  messagePanel: { minHeight: 145, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 22 },
  messageText: { fontFamily: mono, fontSize: 12, textAlign: 'center', lineHeight: 19 },
  emptyCard: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24, borderWidth: 1, borderRadius: 12, gap: 9 },
  emptyIcon: { width: 52, height: 52, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontFamily: mono, fontSize: 15, fontWeight: '700' },
  bodyCopy: { fontSize: 11, lineHeight: 17 },
  actionButton: { minHeight: 46, paddingHorizontal: 16, marginTop: 9, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  actionButtonText: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  workspaceBlock: { gap: 8 },
  workspaceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingBottom: 2 },
  workspaceName: { fontFamily: mono, fontSize: 13, fontWeight: '700', flex: 1 },
  workspaceCount: { fontFamily: mono, fontSize: 10 },
  machineCard: { minHeight: 72, borderWidth: 1, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  machineIcon: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  machineDetails: { flex: 1, gap: 5 },
  machineName: { fontFamily: mono, fontSize: 12, fontWeight: '700' },
  machineAddress: { fontFamily: mono, fontSize: 9 },
  machineEnd: { alignItems: 'flex-end', gap: 4 },
  authTag: { fontFamily: mono, fontSize: 8, letterSpacing: 0.75 },
  hostInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 2 },
  hostInfoContent: { flex: 1, gap: 5 },
  hostInfoTitle: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  hostInfoText: { fontSize: 10, lineHeight: 15 },
  menuRow: { minHeight: 64, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  menuCopy: { flex: 1, gap: 5 },
  subHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingBottom: 14, gap: 9 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  subHeaderText: { gap: 4, flex: 1 },
  subTitle: { fontFamily: mono, fontSize: 16, fontWeight: '700' },
  formContent: { paddingHorizontal: 18, paddingTop: 17, gap: 14 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 9, padding: 12 },
  noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
  fieldGroup: { gap: 7, flex: 1 },
  fieldLabel: { fontFamily: mono, fontSize: 9, fontWeight: '700', letterSpacing: 1.05 },
  authChoiceRow: { flexDirection: 'row', gap: 10 },
  authChoice: { minHeight: 44, flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minHeight: 45, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontFamily: mono, fontSize: 11 },
  multilineInput: { minHeight: 126, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: 11 },
  portField: { width: 92 },
  userField: { flex: 1 },
  securityNote: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 2 },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 9, padding: 13, gap: 12 },
  stepNumber: { fontFamily: mono, fontSize: 15, fontWeight: '700' },
  guideCopy: { flex: 1, gap: 8 },
  guidePanel: { borderWidth: 1, borderRadius: 9, padding: 13, gap: 9 },
  optionRow: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  optionLabel: { fontFamily: mono, fontSize: 10, flex: 1 },
  sudoRow: { minHeight: 62, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sandboxStatus: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 9 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopButton: { minHeight: 45, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  stopButtonText: { fontFamily: mono, fontSize: 10, fontWeight: '700' },
  sandboxTerminal: { minHeight: 330, borderWidth: 1, borderRadius: 9, overflow: 'hidden' },
  paneHeader: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  outputScroll: { height: 230, padding: 12 },
  outputText: { fontFamily: mono, fontSize: 10, lineHeight: 16 },
  commandRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderTopWidth: 1 },
  terminalPrompt: { fontFamily: mono, fontSize: 13, fontWeight: '700' },
  commandInput: { flex: 1, paddingVertical: 8, fontFamily: mono, fontSize: 10 },
  terminalNotice: { minHeight: 43, borderWidth: 1, borderRadius: 7, marginHorizontal: 12, marginTop: 10, marginBottom: 7, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionActions: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  connectButton: { minHeight: 40, borderRadius: 7, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  nativeTerminal: { flex: 1, minHeight: 280, marginHorizontal: 12, borderWidth: 1, borderRadius: 9, overflow: 'hidden' },
  nativeOutput: { flex: 1, padding: 12 },
  sessionFootnote: { margin: 12, padding: 10, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nativeDisconnected: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
});