
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { timingSafeEqual } from "node:crypto";
import { loadConfig, type AppConfig } from "./config.js";
import { InstagramClient } from "./instagram/client.js";
import { createInstagramMcpServer } from "./mcp-server.js";

let cachedConfig: AppConfig | undefined;
let cachedClient: InstagramClient | undefined;

function getConfig(): AppConfig {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

function getInstagramClient(): InstagramClient {
  if (!cachedClient) cachedClient = new InstagramClient(getConfig());
  return cachedClient;
}

function safeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createApp(): express.Express {
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Mandatory authentication for every MCP request.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    let config: AppConfig;

    try {
      config = getConfig();
    } catch {
      res.status(503).json({ error: "Server configuration unavailable" });
      return;
    }

    if (!config.mcpAuthToken) {
      res.status(503).json({ error: "MCP authentication is not configured" });
      return;
    }

    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : "";

    if (!provided || !safeTokenMatch(provided, config.mcpAuthToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  });

  async function handleMcp(req: Request, res: Response): Promise<void> {
    let client: InstagramClient;

    try {
      client = getInstagramClient();
    } catch {
      res.status(503).json({ error: "Instagram service unavailable" });
      return;
    }

    const server = createInstagramMcpServer(client);
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      console.error("MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }

  app.post("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  app.get("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  app.delete("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  return app;
}

const app = createApp();
export default app;
