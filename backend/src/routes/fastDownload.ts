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
