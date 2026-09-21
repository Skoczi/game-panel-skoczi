import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { getConfig } from "../config.js";
import { serverRepository, actionsRepository } from "../database/index.js";
import { getServerStoragePaths } from "../utils/storage.js";
import { nativeServerTemplate } from "./nativeBackups.js";
import { enterServerMutation } from "./nativeOperationLock.js";
import {
  inDirectory,
  openAsset,
  fileHash,
  atomicAsset,
  copyAsset,
  removeAsset,
  signature,
  parts,
} from "./fastDownloadFs.js";
import type { GameServerRow } from "../types/gameServer.js";

type Asset = {
  source: string;
  outputs: Record<string, string>;
  signatures?: Record<string, string>;
};
type State = {
  enabled: boolean;
  compression: boolean;
  assets: Record<string, Asset>;
  lastSync: string | null;
  error: string | null;
  published: number;
  configuration?: string;
};
const busy = new Set<number>();
const queued = new Set<number>();
const empty = (): State => ({
  enabled: true,
  compression: true,
  assets: {},
  lastSync: null,
  error: null,
  published: 0,
});
const extensions =
  /\.(bsp|nav|res|wad|mdl|spr|wav|mp3|ogg|vmt|vtf|vtx|vvd|phy|pcf|raw|tga|bmp|png|jpg|jpeg|dds|ain)$/i;
export function allowedAsset(relative: string) {
  try {
    parts(relative);
  } catch {
    return false;
  }
  if (
    /(^|\/)(addons|cfg|logs?|bin|platform|steam|steamcmd|steamapps|sdk_content|vpks)(\/|$)/i.test(
      relative,
    )
  )
    return false;
  return extensions.test(relative) || /^maps\/[^/]+\.txt$/i.test(relative);
}
export function fastDownloadProfile(server: GameServerRow) {
  const template = nativeServerTemplate(server);
  if (
    !template ||
    !template.mounts.some(
      (m) => m.key === "data" && m.containerPath === "/data",
    )
  )
    return null;
  const f = template.fastDownload;
  if (!f?.enabled || !f.gameRoot || !f.folders?.length) return null;
  return {
    game: f.gameRoot.slice("serverfiles/".length),
    source: f.gameRoot,
    folders: f.folders,
    compression: f.compression === "bzip2",
    config: f.configFile,
    uid: template.runtime.identity?.uid ?? 1000,
    gid: template.runtime.identity?.gid ?? 1000,
  };
}
const stateDirectory = () =>
  path.join(getConfig().gamepanelDataDir, "fastdownload");
async function readState(id: number, compression = true): Promise<State> {
  try {
    return {
      ...empty(),
      ...JSON.parse(
        await fs.readFile(path.join(stateDirectory(), `${id}.json`), "utf8"),
      ),
    };
  } catch (e: any) {
    if (e.code === "ENOENT") return { ...empty(), compression };
    throw e;
  }
}
async function saveState(id: number, state: State) {
  await fs.mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const file = path.join(stateDirectory(), `${id}.json`),
    temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(state), {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
export function fastDownloadOrigin() {
  const raw = process.env.GAMEPANEL_FASTDL_ORIGIN;
  if (!raw) return null;
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid FastDownload origin");
  return url.origin;
}
async function serverFor(id: number) {
  const server = await serverRepository.findById(id);
  if (!server)
    throw Object.assign(new Error("Server not found"), { statusCode: 404 });
  return server;
}
export async function fastDownloadStatus(id: number) {
  const server = await serverFor(id),
    profile = fastDownloadProfile(server),
    state = await readState(id, profile?.compression),
    origin = fastDownloadOrigin();
  return {
    supported: !!profile,
    available: !!origin,
    enabled: state.enabled && !!profile && !!origin,
    compression: state.compression,
    busy: busy.has(id) || queued.has(id),
    url: profile && origin ? `${origin}/fdl/srv${id}/${profile.game}/` : null,
    directory: profile ? `/fastdownload/${profile.game}` : null,
    lastSync: state.lastSync,
    error: state.error,
    published: state.published,
    game: profile?.game ?? null,
    folders: profile?.folders ?? [],
    canApplyConfig: !!profile?.config,
    configuration: state.configuration ?? "Not configured",
  };
}
export async function updateFastDownload(
  id: number,
  input: unknown,
  actor: string,
) {
  const server = await serverFor(id);
  if (!fastDownloadProfile(server) || !fastDownloadOrigin())
    throw Object.assign(
      new Error("FastDownload is not available for this server"),
      { statusCode: 409 },
    );
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.entries(input).some(
      ([k, v]) =>
        !["enabled", "compression"].includes(k) || typeof v !== "boolean",
    )
  )
    throw Object.assign(
      new Error("Expected enabled and/or compression booleans"),
      { statusCode: 400 },
    );
  const state = await readState(id);
  Object.assign(state, input);
  await saveState(id, state);
  await actionsRepository.create(
    id,
    "info",
    `FastDownload ${state.enabled ? "enabled" : "disabled"}; compression ${state.compression ? "enabled" : "disabled"}`,
    actor,
  );
  return fastDownloadStatus(id);
}
async function scan(root: string, folders: string[]) {
  const files = new Map<string, string>();
  let count = 0;
  async function walk(relative: string[]) {
    await inDirectory(root, relative, false, async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (++count > 100000)
          throw new Error("FastDownload scan exceeds 100,000 entries");
        if (entry.name.startsWith(".") || /[\\\x00-\x1f\x7f]/.test(entry.name))
          continue;
        const next = [...relative, entry.name],
          name = next.join("/");
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (
            !folders.some(
              (f) =>
                name === f ||
                name.startsWith(f + "/") ||
                f.startsWith(name + "/"),
            )
          )
            continue;
          if (
            /^(addons|cfg|logs?|bin|platform|steam|steamcmd|steamapps|sdk_content|vpks)$/i.test(
              entry.name,
            )
          )
            continue;
          if (next.length > 16)
            throw new Error("FastDownload directory nesting exceeds 16 levels");
          await walk(next);
        } else if (
          entry.isFile() &&
          allowedAsset(name) &&
          folders.some((f) => name.startsWith(f + "/"))
        ) {
          const handle = await openAsset(root, name);
          try {
            const st = await handle.stat();
            if (st.size > 1024 ** 3)
              throw new Error("FastDownload asset exceeds 1 GiB");
            files.set(name, signature(st));
          } finally {
            await handle.close();
          }
        }
      }
    });
  }
  await walk([]);
  return files;
}
async function compress(
  source: Awaited<ReturnType<typeof openAsset>>,
  filename: string,
) {
  const output = await fs.open(filename, "wx", 0o600);
  const child = spawn("nice", ["-n", "19", "bzip2", "-6", "-c"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("FastDownload compression failed")),
    );
  });
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
  try {
    const input = async () => {
      const buffer = Buffer.alloc(65536);
      let position = 0;
      for (;;) {
        const { bytesRead } = await source.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        if (!bytesRead) break;
        const chunk = Buffer.from(buffer.subarray(0, bytesRead));
        if (!child.stdin.write(chunk)) await once(child.stdin, "drain");
        position += bytesRead;
      }
      child.stdin.end();
    };
    const result = async () => {
      for await (const chunk of child.stdout) await output.writeFile(chunk);
    };
    await Promise.all([done, input(), result()]);
    await output.sync();
  } finally {
    clearTimeout(timer);
    child.kill();
    await output.close();
  }
}
export async function synchronizeFastDownload(id: number, requestHeld = false) {
  if (busy.has(id)) return;
  const release = requestHeld ? () => {} : enterServerMutation(id);
  busy.add(id);
  let state: State | undefined;
  try {
    const server = await serverFor(id),
      profile = fastDownloadProfile(server);
    if (
      !profile ||
      !fastDownloadOrigin() ||
      ["installing", "updating", "restoring"].includes(server.status)
    )
      return;
    state = await readState(id, profile.compression);
    if (!state.enabled) return;
    const data = getServerStoragePaths(id).dataDir,
      sourceRoot = path.join(data, profile.source),
      targetRoot = path.join(data, "fastdownload", profile.game);
    // Complete scan first: failures and missing game roots must never mean deletions.
    const sources = await scan(sourceRoot, profile.folders);
    await inDirectory(
      data,
      ["fastdownload", ...profile.game.split("/")],
      true,
      async (dir) => {
        if (process.getuid?.() === 0)
          await fs.chown(dir, profile.uid, profile.gid);
      },
    );
    for (const key of Object.keys(state.assets)) {
      if (!allowedAsset(key)) throw new Error("Invalid FastDownload manifest");
      if (!sources.has(key)) {
        // A symlink or unreadable replacement is not proof that the source was deleted.
        try {
          const h = await openAsset(sourceRoot, key);
          await h.close();
          continue;
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        for (const suffix of ["", ".bz2"])
          await removeAsset(targetRoot, key + suffix);
        delete state.assets[key];
      }
    }
    // Persist deletion ownership before creating outputs. Recovery treats unknown files as manual.
    await saveState(id, state);
    let bytes = 0,
      completed = 0;
    for (const [key, sig] of sources) {
      const previous = state.assets[key];
      const asset: Asset = previous ?? { source: "", outputs: {} };
      const handle = await openAsset(sourceRoot, key);
      try {
        const st = await handle.stat();
        if (signature(st) !== sig) continue;
        // Let uploads settle; never publish an in-progress transfer.
        if (Date.now() - st.mtimeMs < 2000) continue;
        const currentSignatures: Record<string, string> = {};
        for (const suffix of ["", ".bz2"]) {
          try {
            const output = await openAsset(targetRoot, key + suffix);
            try {
              currentSignatures[suffix] = signature(await output.stat());
            } finally {
              await output.close();
            }
          } catch (e: any) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        if (
          previous?.source === sig &&
          asset.signatures &&
          JSON.stringify(currentSignatures) ===
            JSON.stringify(asset.signatures) &&
          (!!asset.outputs[".bz2"] === state.compression || !asset.outputs[""])
        )
          continue;
        for (const suffix of ["", ".bz2"]) {
          const name = key + suffix;
          const existing = await fileHash(targetRoot, name);
          const owned = existing !== null && existing === asset.outputs[suffix];
          if (!state.compression && suffix) {
            if (owned) await removeAsset(targetRoot, name);
            delete asset.outputs[suffix];
            continue;
          }
          if (existing !== null && !owned) {
            delete asset.outputs[suffix];
            continue;
          }

          // Do not retain generated compression over a manually replaced original.
          if (
            suffix &&
            (await fileHash(targetRoot, key)) !== asset.outputs[""]
          ) {
            if (owned) await removeAsset(targetRoot, name);
            delete asset.outputs[suffix];
            continue;
          }
          if (previous?.source === sig && owned) continue;
          const space = await fs.statfs(targetRoot);
          if (
            Number(space.bavail) * Number(space.bsize) <
            st.size * 2 + 64 * 1024 * 1024
          )
            throw new Error(
              "Not enough free space to publish FastDownload assets",
            );
          bytes += st.size;
          if (bytes > 4 * 1024 ** 3)
            throw new Error(
              "Publication batch reached 4 GiB; synchronize again to continue",
            );
          await atomicAsset(
            targetRoot,
            name,
            existing,
            async (temporary) => {
              if (suffix) await compress(handle, temporary);
              else await copyAsset(handle, temporary);
              const current = await openAsset(sourceRoot, key);
              try {
                if (
                  signature(await current.stat()) !== sig ||
                  signature(await handle.stat()) !== sig
                )
                  throw new Error(
                    "Source changed during publication; retry synchronization",
                  );
              } finally {
                await current.close();
              }
            },
            profile,
          );
          asset.outputs[suffix] = (await fileHash(targetRoot, name))!;
        }
        asset.signatures = {};
        for (const suffix of ["", ".bz2"]) {
          try {
            const output = await openAsset(targetRoot, key + suffix);
            try {
              asset.signatures[suffix] = signature(await output.stat());
            } finally {
              await output.close();
            }
          } catch (e: any) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        asset.source = sig;
        state.assets[key] = asset;
        if (++completed % 20 === 0) await saveState(id, state);
      } finally {
        await handle.close();
      }
    }
    if (!state.lastSync && profile.config) {
      const cfg = await openAsset(data, profile.config);
      let content = "";
      try {
        if ((await cfg.stat()).size <= 1024 * 1024)
          content = await cfg.readFile("utf8");
      } finally {
        await cfg.close();
      }
      const existing = content.match(
        /^\s*sv_downloadurl\s+(?:"([^"\r\n]*)"|([^\s;\r\n]+))/m,
      );
      const value = existing?.[1] ?? existing?.[2];
      if (!value) {
        await applyFastDownloadConfig(id, "fastdownload");
        state.configuration = "Saved in server.cfg · applies on config reload";
      } else
        state.configuration =
          value === `${fastDownloadOrigin()}/fdl/srv${id}/${profile.game}/`
            ? "Saved in server.cfg"
            : "Existing download URL retained · use Set URL to replace it";
    }
    state.lastSync = new Date().toISOString();
    state.error = null;
    state.published = sources.size;
    await saveState(id, state);
  } catch (e: any) {
    if (state) {
      state.error = e.message || "FastDownload synchronization failed";
      await saveState(id, state);
    }
    throw e;
  } finally {
    busy.delete(id);
    release();
  }
}
export function queueFastDownloadSync(id: number) {
  if (queued.has(id) || busy.has(id)) return;
  queued.add(id);
  setTimeout(() => {
    queued.delete(id);
    void synchronizeFastDownload(id).catch(() => {});
  }, 0);
}
export function startFastDownloadWorker() {
  let stopped = false,
    running = false;
  const run = async () => {
    if (stopped || running || !fastDownloadOrigin()) return;
    running = true;
    try {
      for (const server of await serverRepository.listAll()) {
        if (stopped) break;
        try {
          await synchronizeFastDownload(server.id);
        } catch {
          /* Status is visible in settings; never take down the runner. */
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 60000);
  timer.unref();
  void run();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
export async function applyFastDownloadConfig(id: number, actor: string) {
  const server = await serverFor(id),
    profile = fastDownloadProfile(server),
    status = await fastDownloadStatus(id);
  if (!profile?.config || !status.enabled || !status.url)
    throw Object.assign(new Error("Enable FastDownload first"), {
      statusCode: 409,
    });
  const root = getServerStoragePaths(id).dataDir,
    previous = await fileHash(root, profile.config);
  const file = await openAsset(root, profile.config);
  let content: string;
  try {
    if ((await file.stat()).size > 1024 * 1024)
      throw new Error("Server configuration exceeds 1 MiB");
    content = await file.readFile("utf8");
  } finally {
    await file.close();
  }
  const command = `sv_downloadurl "${status.url}"`;
  const pattern =
    /^[ \t]*sv_downloadurl[ \t]+(?:"[^"\r\n]*"|[^\s;\r\n]+)[ \t]*(?=;|\/\/|$)/gm;
  content = pattern.test(content)
    ? content.replace(pattern, command + " ")
    : content.trimEnd() + `\n${command}\n`;
  await atomicAsset(
    root,
    profile.config,
    previous,
    (temporary) =>
      fs.writeFile(temporary, content, { flag: "wx", mode: 0o644 }),
    profile,
  );
  if (!busy.has(id)) {
    const state = await readState(id, profile.compression);
    state.configuration = "Saved in server.cfg · applies on config reload";
    await saveState(id, state);
  }
  await actionsRepository.create(
    id,
    "info",
    "FastDownload URL saved in server.cfg; applied on next config reload",
    actor,
  );
  return {
    message:
      "Saved in server.cfg. Applies on the next config reload or server restart.",
  };
}
export async function resolveFastDownload(id: number, relative: string) {
  const server = await serverFor(id),
    profile = fastDownloadProfile(server),
    state = await readState(id);
  if (
    !profile ||
    !state.enabled ||
    !fastDownloadOrigin() ||
    !relative.startsWith(profile.game + "/")
  )
    return null;
  const asset = relative.slice(profile.game.length + 1),
    source = asset.replace(/\.bz2$/i, "");
  if (!allowedAsset(source)) return null;
  const root = path.join(getServerStoragePaths(id).dataDir, "fastdownload");
  const handle = await openAsset(root, relative);
  await handle.close();
  return `${id}/data/fastdownload/${relative}`;
}
