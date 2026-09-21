import { Router } from "express";
import {
  requireServerPermission,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { PERMISSIONS } from "../permissions.js";
import {
  fastDownloadStatus,
  updateFastDownload,
  queueFastDownloadSync,
  applyFastDownloadConfig,
  resolveFastDownload,
} from "../services/fastDownload.js";
import { sendRouteError } from "../utils/routeErrors.js";

export const fastDownloadRoutes = Router({ mergeParams: true });
fastDownloadRoutes.use(requireServerPermission(PERMISSIONS.server.edit));
fastDownloadRoutes.get("/", async (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(await fastDownloadStatus(Number(req.params.id)));
  } catch (error) {
    sendRouteError(res, error, {
      route: "FDL:READ",
      fallbackMessage: "Cannot read FastDownload settings",
    });
  }
});
fastDownloadRoutes.patch("/", async (req: AuthenticatedRequest, res) => {
  try {
    res.json(
      await updateFastDownload(
        Number(req.params.id),
        req.body,
        req.user?.username || "Unknown",
      ),
    );
  } catch (error) {
    sendRouteError(res, error, {
      route: "FDL:UPDATE",
      fallbackMessage: "Cannot save FastDownload settings",
    });
  }
});
fastDownloadRoutes.post("/sync", async (req: AuthenticatedRequest, res) => {
  try {
    const state = await fastDownloadStatus(Number(req.params.id));
    if (!state.enabled)
      return res.status(409).json({ error: "Enable FastDownload first" });
    queueFastDownloadSync(Number(req.params.id));
    res.status(202).json({ queued: true });
  } catch (error) {
    sendRouteError(res, error, {
      route: "FDL:SYNC",
      fallbackMessage: "Cannot synchronize FastDownload",
    });
  }
});
fastDownloadRoutes.post(
  "/configure",
  requireServerPermission(PERMISSIONS.fs.write),
  async (req: AuthenticatedRequest, res) => {
    try {
      res.json(
        await applyFastDownloadConfig(
          Number(req.params.id),
          req.user?.username || "Unknown",
        ),
      );
    } catch (error) {
      sendRouteError(res, error, {
        route: "FDL:CONFIGURE",
        fallbackMessage: "Cannot set FastDownload URL",
      });
    }
  },
);
// Deliberately separate public, read-only asset route, mounted before the agent gate.
// Bytes are served by node-local Nginx through an internal redirect, never by FRA.
export const fastDownloadPublic = Router();
fastDownloadPublic.use((req, res, next) => {
  res.type("text/plain");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (!["GET", "HEAD"].includes(req.method)) return res.status(405).end();
  next();
});
fastDownloadPublic.get(
  /^\/srv([1-9][0-9]{0,9})\/(.+)$/,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (process.env.GAMEPANEL_FASTDL_ACCEL !== "1")
        return res.status(404).end();
      // The base URL is entered in game settings and is often opened in a browser.
      // Return a real HTML status page, not an empty response Safari treats as a download.
      if (req.params[1].endsWith("/") || !req.params[1].includes("/")) {
        const status = await fastDownloadStatus(Number(req.params[0]));
        if (
          status.enabled &&
          (req.params[1] === status.game || req.params[1] === status.game + "/")
        ) {
          return res.status(200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FastDownload · Game Panel</title>
<style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font:16px/1.6 system-ui,sans-serif}main{box-sizing:border-box;width:min(560px,calc(100% - 40px));padding:36px;border:1px solid #334155;border-radius:24px;background:#101c2d}small{color:#00c8df;letter-spacing:.12em;font-weight:700}h1{font-size:28px;margin:16px 0}p{color:#a5b4c8;margin:12px 0}.status{display:inline-block;padding:6px 12px;border-radius:10px;background:#063c32;color:#4ade80;font-size:14px}</style></head>
<body><main><small>GAME PANEL</small><h1>FastDownload</h1><span class="status">Active</span><p>This address is ready for your game server’s download URL.</p><p>Game clients download individual maps, models and sounds from here. To browse or upload files, use the file manager in Game Panel.</p></main></body></html>`);
        }
      }
      const relative = await resolveFastDownload(
        Number(req.params[0]),
        req.params[1],
      );
      if (!relative) return res.status(404).end();
      res.setHeader(
        "X-Accel-Redirect",
        "/_gamepanel_fdl/" +
          relative.split("/").map(encodeURIComponent).join("/"),
      );
      res.setHeader("Content-Type", "application/octet-stream");
      return res.status(200).end();
    } catch {
      return res.status(404).end();
    }
  },
);
fastDownloadPublic.use((_req, res) => res.status(404).end());
