---
name: Expo package installation in the workspace
description: Install Expo SDK-bound native modules inside the correct monorepo artifact.
---

For Expo-native dependencies in this pnpm monorepo, run the Expo installer scoped to the app package: `pnpm --filter @workspace/<artifact> exec expo install <package>`.

**Why:** the generic language-package installer targets the workspace root, where pnpm rejects adding an app dependency; Expo's installer also selects an SDK-compatible version.

**How to apply:** use the scoped Expo installer when adding a native module to an Expo artifact, then type-check and restart its managed workflow.