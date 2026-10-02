---
name: Remote terminal hosting
description: Replit SSH and Vercel hosting options for this mobile terminal.
---

Replit SSH can reach a development Repl directly: add the matching public key in Replit's SSH pane, then use the username and hostname from “Connect manually” with port 22 and the private key in the mobile client. This is standard-user access, not root; install system packages through Nix. A published Replit deployment is separate from the development shell. See https://docs.replit.com/features/workspace-tools/ssh.

Vercel Functions are not persistent interactive SSH hosts. Vercel Sandbox is a separate isolated Linux microVM product with interactive shell commands; its CLI supports `--sudo` on supported images. A mobile app would need an authenticated Sandbox service/gateway rather than a regular SSH profile. See https://vercel.com/docs/sandbox and https://vercel.com/docs/sandbox/cli-reference.

**Why:** the user wants phone access to a remote shell and asked whether Replit or Vercel deployments provide root.

**How to apply:** prefer direct Replit SSH when the target is a development Repl; do not expose an unrestricted shell through the published app. Use Vercel Sandbox only if the user wants a separately managed VM and accepts the extra authenticated service.