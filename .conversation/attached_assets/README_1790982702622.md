# HTB Mobile Terminal

Mobile SSH terminal for manually operating **authorized** Hack The Box / CTF lab machines.
No exploitation, scanning or automation logic is included.

## Layout

```
App.tsx                      entry (Home <-> Machine screens)
src/container.ts             composition root: swap implementations here
src/ui/                      React Native UI (Home, Machine, TerminalPane, KeyboardToolbar)
src/terminal/                TerminalSession (per-terminal SSH + reconnect), SessionManager,
                             AnsiScreen (replaceable emulator), keys
src/ssh/                     SshTransport interface + RnSshTransport (library adapter)
src/db/Repository.ts         Repository interface + SQLite implementation
src/network/                 NetworkManager (NetInfo)
src/security/                CredentialStore interface + Keychain (Android Keystore) impl
__tests__/core.test.ts       emulator / keys / backoff tests
```

Data model: Workspace > Machine > Terminals. History lives in SQLite (`commands`,
`output_chunks`, `connection_events`); credentials only in Keystore-backed storage.

## Build the APK

Prereqs: Node 20+, JDK 17, Android SDK (Android Studio), `ANDROID_HOME` set.

```bash
# 1. Generate the native Android shell
npx @react-native-community/cli@latest init HTBMobileTerminal
cd HTBMobileTerminal

# 2. Copy this project's sources over it
cp -r /path/to/htb/src /path/to/htb/App.tsx .
cp /path/to/htb/__tests__/core.test.ts __tests__/
rm -f __tests__/App.test.tsx          # template test would fail (native modules)

# 3. Native dependencies
npm i react-native-sqlite-storage react-native-keychain \
      @react-native-community/netinfo @dylankenneally/react-native-ssh-sftp
npm i -D @types/react-native-sqlite-storage

# 4. Run on a device / emulator (USB debugging on)
npx react-native run-android

# 5. Release APK (sideload)
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

The template signs release builds with the debug keystore, which is fine for sideloading.
For your own key: `keytool -genkeypair -v -storetype PKCS12 -keystore htb.keystore -alias htb -keyalg RSA -keysize 2048 -validity 10000`,
then add it under `signingConfigs.release` in `android/app/build.gradle`.

Confirm `android:windowSoftInputMode="adjustResize"` is on the activity in `AndroidManifest.xml`
(the template default) so the toolbar stays above the keyboard.

Tests: `npm test`.

## Using it

1. Tap **＋**, enter workspace, machine name, host, user, and password or pasted PEM key. The secret goes to Keystore.
2. Open the machine. One terminal is created and connects; tap **＋** for more (stacked vertically).
3. Type in a pane's input and press send. Toolbar keys go to the focused pane. CTRL/ALT are sticky for one key.
4. ⤢ toggles fullscreen for a pane. ✕ closes it (history kept; remote tmux session keeps running, see `tmux ls`).
5. HTB machines usually need the HTB VPN, so run the OpenVPN/WireGuard app on the phone first.

## Behavior notes

- Each terminal runs `tmux new-session -A -s htb_<id>` after login when tmux exists, so a running command survives a phone disconnect and is re-attached on reconnect.
- Reconnect: offline detection via NetInfo, plus a 15s SSH heartbeat; retries use 1s..30s exponential backoff.
- Exit codes and command text are recorded through a prompt hook (bash `PROMPT_COMMAND` / zsh `precmd`). If the hook is not active the header shows `cmd-log off` and commands are not recorded (output still is).
- Text typed while a command is running (password prompts) is never recorded as a command.
