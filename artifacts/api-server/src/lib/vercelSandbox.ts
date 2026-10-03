import { spawn } from "node:child_process";
import { createRequire } from "node:module";

export type VercelSandboxImage =
  | "vercel/sandbox/node:22"
  | "vercel/sandbox/python:3.13";

export interface VercelServerConfig {
  token: string;
  projectId: string;
  teamId?: string;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const require = createRequire(import.meta.url);
const SANDBOX_CLI_PATH = require.resolve("sandbox/bin/sandbox.mjs");

export function getSandboxCliPath(): string {
  return SANDBOX_CLI_PATH;
}

export function getSandboxCliEnvironment(
  config: VercelServerConfig,
  interactive = false,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    VERCEL_AUTH_TOKEN: config.token,
    ...(interactive ? { TERM: "xterm-256color" } : {}),
  };
  const allowedKeys = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "XDG_CONFIG_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "LANG",
    "LC_ALL",
    "CI",
  ];
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  return environment;
}

export function getVercelServerConfig(): VercelServerConfig | null {
  const token = process.env["VERCEL_TOKEN"]?.trim();
  const projectId = process.env["VERCEL_PROJECT_ID"]?.trim();
  const teamId = process.env["VERCEL_TEAM_ID"]?.trim();

  if (!token || !projectId) return null;
  return { token, projectId, ...(teamId ? { teamId } : {}) };
}

export function getVercelScopeArgs(config: VercelServerConfig): string[] {
  return [
    "--project",
    config.projectId,
    ...(config.teamId ? ["--scope", config.teamId] : []),
  ];
}

export function runSandboxCli(
  args: string[],
  config: VercelServerConfig,
  timeoutMs = 90_000,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(SANDBOX_CLI_PATH, args, {
      env: getSandboxCliEnvironment(config),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish(new Error("The Vercel Sandbox CLI timed out."));
    }, timeoutMs);

    const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
      const value = chunk.toString("utf8");
      if (target === "stdout") stdout = appendBounded(stdout, value);
      else stderr = appendBounded(stderr, value);
    };

    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    function finish(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function safeCliMessage(output: string, token: string): string {
  const safeOutput = output
    .replaceAll(token, "[redacted]")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(" ");

  return safeOutput.length > 400 ? `${safeOutput.slice(0, 399)}…` : safeOutput;
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  return combined.length > 16_000 ? combined.slice(-16_000) : combined;
}