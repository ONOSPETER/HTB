import { spawn } from "node:child_process";
import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { consumeTerminalTicket } from "./lib/terminalTickets";
import {
  getVercelScopeArgs,
  getVercelServerConfig,
  getSandboxCliPath,
  getSandboxCliEnvironment,
} from "./lib/vercelSandbox";
import { WebSocketServer, WebSocket } from "ws";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
const terminalWebSockets = new WebSocketServer({
  noServer: true,
  maxPayload: 4 * 1024,
});
const MAX_ACTIVE_TERMINALS = 8;
let activeTerminals = 0;

server.on("upgrade", (request, socket, head) => {
  let url: URL;
  try {
    url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
  } catch {
    socket.destroy();
    return;
  }

  const match = /^\/api\/vercel-sandboxes\/([a-z0-9][a-z0-9-]{2,47})\/terminal$/.exec(
    url.pathname,
  );
  if (!match) {
    socket.destroy();
    return;
  }

  const sandboxName = match[1];
  const ticket = url.searchParams.get("ticket");
  const ticketInfo =
    sandboxName && ticket
      ? consumeTerminalTicket(sandboxName, ticket)
      : null;
  if (!sandboxName || !ticketInfo) {
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  const config = getVercelServerConfig();
  if (!config) {
    rejectUpgrade(socket, 503, "Service Unavailable");
    return;
  }
  if (activeTerminals >= MAX_ACTIVE_TERMINALS) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }

  terminalWebSockets.handleUpgrade(request, socket, head, (webSocket) => {
    activeTerminals += 1;
    startSandboxTerminal(
      webSocket,
      sandboxName,
      ticketInfo.sudo,
      config,
      () => {
        activeTerminals = Math.max(0, activeTerminals - 1);
      },
    );
  });
});

function startSandboxTerminal(
  webSocket: WebSocket,
  sandboxName: string,
  sudo: boolean,
  config: NonNullable<ReturnType<typeof getVercelServerConfig>>,
  onClose: () => void,
): void {
  const cliArgs = [
    "connect",
    ...(sudo ? ["--sudo"] : []),
    "--no-extend-timeout",
    ...getVercelScopeArgs(config),
    sandboxName,
  ];
  const command = [process.execPath, getSandboxCliPath(), ...cliArgs]
    .map(quoteShellArg)
    .join(" ");
  const child = spawn("script", ["-qefc", `exec ${command}`, "/dev/null"], {
    detached: true,
    env: getSandboxCliEnvironment(config, true),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    onClose();
  };

  const sendOutput = (chunk: Buffer) => {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(chunk.toString("utf8"));
    }
  };

  child.stdout.on("data", sendOutput);
  child.stderr.on("data", sendOutput);
  child.once("error", (err) => {
    logger.error(
      { err, sandboxName },
      "Could not start the Vercel Sandbox terminal process",
    );
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send("\r\n[Could not start the terminal process.]\r\n");
      webSocket.close(1011, "Terminal process failed");
    }
    release();
  });
  child.once("close", (code) => {
    release();
    if (webSocket.readyState === WebSocket.OPEN) {
      if (code !== 0) {
        webSocket.send("\r\n[The sandbox shell disconnected.]\r\n");
      }
      webSocket.close(1000, "Sandbox shell ended");
    }
  });

  webSocket.on("message", (data) => {
    if (!child.stdin.destroyed) {
      child.stdin.write(Buffer.isBuffer(data) ? data : Buffer.from(data.toString()));
    }
  });
  webSocket.once("close", () => terminateProcessGroup(child));
  webSocket.once("error", (err) => {
    logger.warn({ err, sandboxName }, "Vercel Sandbox terminal WebSocket failed");
    terminateProcessGroup(child);
  });
}

function terminateProcessGroup(child: ReturnType<typeof spawn>): void {
  if (!child.pid || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // The process group has already exited.
      }
    }, 2_000).unref();
  } catch {
    child.kill("SIGTERM");
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status: number,
  reason: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
