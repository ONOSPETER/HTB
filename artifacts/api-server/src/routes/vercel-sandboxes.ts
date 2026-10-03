import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateVercelSandboxBody,
  CreateVercelSandboxResponse,
  CreateVercelSandboxTerminalTicketBody,
  CreateVercelSandboxTerminalTicketParams,
  CreateVercelSandboxTerminalTicketResponse,
  StopVercelSandboxParams,
  type VercelSandboxInfo,
} from "@workspace/api-zod";
import { issueTerminalTicket } from "../lib/terminalTickets";
import {
  getVercelScopeArgs,
  getVercelServerConfig,
  runSandboxCli,
  safeCliMessage,
  type VercelSandboxImage,
} from "../lib/vercelSandbox";

const router: IRouter = Router();

const requireGatewayToken: RequestHandler = (req, res, next) => {
  const expected = process.env["TERMINAL_GATEWAY_TOKEN"];
  if (!expected) {
    res.status(503).json({ message: "The terminal gateway is not configured." });
    return;
  }

  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const supplied = match?.[1];
  if (!supplied || !safeEqual(supplied, expected)) {
    res.status(401).json({ message: "Missing or invalid terminal gateway token." });
    return;
  }

  next();
};

router.use(requireGatewayToken);

router.post("/vercel-sandboxes", async (req, res): Promise<void> => {
  const parsed = CreateVercelSandboxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Provide a valid sandbox name and supported image." });
    return;
  }

  const config = getVercelServerConfig();
  if (!config) {
    res.status(503).json({
      message: "The API server needs VERCEL_TOKEN and VERCEL_PROJECT_ID before it can create sandboxes.",
    });
    return;
  }

  const { name, image } = parsed.data;
  const args = [
    "create",
    "--silent",
    "--name",
    name,
    "--image",
    image,
    "--timeout",
    "1h",
    ...getVercelScopeArgs(config),
  ];

  try {
    const result = await runSandboxCli(args, config);
    if (result.exitCode !== 0) {
      const detail = safeCliMessage(result.stderr || result.stdout, config.token);
      req.log.warn({ sandboxName: name, exitCode: result.exitCode }, "Vercel Sandbox creation failed");
      res.status(502).json({
        message: detail || "Vercel Sandbox could not create the sandbox. Check the API server logs.",
      });
      return;
    }

    const response: VercelSandboxInfo = CreateVercelSandboxResponse.parse({
      name,
      image: image as VercelSandboxImage,
      timeout: "1h",
    });
    res.status(201).json(response);
  } catch (error) {
    const detail = safeCliMessage(
      error instanceof Error ? error.message : "Unknown CLI error",
      config.token,
    );
    req.log.error({ sandboxName: name }, "Vercel Sandbox CLI could not be started");
    res.status(502).json({
      message: detail || "Vercel Sandbox could not be created. Check the API server logs.",
    });
  }
});

router.delete("/vercel-sandboxes/:name", async (req, res): Promise<void> => {
  const parsed = StopVercelSandboxParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid Vercel Sandbox name." });
    return;
  }

  const config = getVercelServerConfig();
  if (!config) {
    res.status(503).json({
      message: "The API server needs VERCEL_TOKEN and VERCEL_PROJECT_ID before it can stop sandboxes.",
    });
    return;
  }

  try {
    const result = await runSandboxCli(
      ["stop", parsed.data.name, ...getVercelScopeArgs(config)],
      config,
    );
    if (result.exitCode !== 0) {
      const detail = safeCliMessage(result.stderr || result.stdout, config.token);
      req.log.warn(
        { sandboxName: parsed.data.name, exitCode: result.exitCode },
        "Vercel Sandbox stop failed",
      );
      res.status(502).json({
        message: detail || "Vercel Sandbox could not be stopped. Check the API server logs.",
      });
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    const detail = safeCliMessage(
      error instanceof Error ? error.message : "Unknown CLI error",
      config.token,
    );
    req.log.error({ sandboxName: parsed.data.name }, "Vercel Sandbox CLI could not be started");
    res.status(502).json({
      message: detail || "Vercel Sandbox could not be stopped. Check the API server logs.",
    });
  }
});

router.post(
  "/vercel-sandboxes/:name/terminal-ticket",
  (req, res): void => {
    const params = CreateVercelSandboxTerminalTicketParams.safeParse(req.params);
    const body = CreateVercelSandboxTerminalTicketBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ message: "Invalid sandbox terminal request." });
      return;
    }

    if (!getVercelServerConfig()) {
      res.status(503).json({
        message: "The API server needs VERCEL_TOKEN and VERCEL_PROJECT_ID before it can connect.",
      });
      return;
    }

    const response = CreateVercelSandboxTerminalTicketResponse.parse({
      ticket: issueTerminalTicket(params.data.name, body.data.sudo),
    });
    res.status(200).json(response);
  },
);

function safeEqual(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export default router;