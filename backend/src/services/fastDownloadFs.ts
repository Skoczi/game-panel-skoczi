import { promises as fs, constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

export function parts(relative: string) {
  const result = relative.split("/");
  if (
    !relative ||
    relative.length > 1024 ||
    result.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        p.startsWith(".") ||
        /[\\\x00-\x1f\x7f]/.test(p),
    )
  )
    throw new Error("Invalid asset path");
  return result;
}
const fdPath = (h: FileHandle, fallback: string) =>
  process.platform === "linux" ? `/proc/self/fd/${h.fd}` : fallback;
// Hold each directory open: renaming or replacing a parent cannot redirect writes.
export async function inDirectory<T>(
  root: string,
  relative: string[],
  create: boolean,
  callback: (dir: string) => Promise<T>,
): Promise<T> {
  const handles: FileHandle[] = [];
  try {
    let current = "/";
    for (const component of [
      ...path.resolve(root).split("/").filter(Boolean),
      ...relative,
    ]) {
      if (
        !component ||
        component === "." ||
        component === ".." ||
        component.includes("/") ||
        component.includes("\\")
      )
        throw new Error("Invalid directory");
      const next = path.join(current, component);
      if (create)
        await fs.mkdir(next, { mode: 0o755 }).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      const handle = await fs.open(
        next,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      handles.push(handle);
      current = fdPath(handle, next);
    }
    return await callback(current);
  } finally {
    for (const handle of handles.reverse()) await handle.close();
  }
}
export async function openAsset(root: string, relative: string) {
  const names = parts(relative),
    name = names.pop()!;
  return inDirectory(root, names, false, async (dir) => {
    const handle = await fs.open(
      path.join(dir, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      await handle.close();
      throw new Error("Asset must be a regular file without hard links");
    }
    return handle;
  });
}
export const signature = (stat: {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}) => `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
export async function fileHash(
  root: string,
  relative: string,
): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await openAsset(root, relative);
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try {
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
export async function removeAsset(root: string, relative: string) {
  const names = parts(relative),
    name = names.pop()!;
  await inDirectory(root, names, false, async (dir) => {
    await fs.unlink(path.join(dir, name)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}
export async function atomicAsset(
  root: string,
  relative: string,
  expected: string | null,
  write: (file: string) => Promise<void>,
  owner?: { uid: number; gid: number },
) {
  const names = parts(relative),
    name = names.pop()!;
  if (owner)
    for (let i = 0; i <= names.length; i++)
      await inDirectory(root, names.slice(0, i), true, async (dir) => {
        if (process.getuid?.() === 0) await fs.chown(dir, owner.uid, owner.gid);
      });
  return inDirectory(root, names, true, async (dir) => {
    const temporary = path.join(dir, `.fdl-${randomUUID()}`);
    try {
      await write(temporary);
      if ((await fileHash(root, relative)) !== expected)
        throw new Error(
          "FastDownload file changed during publication; retry synchronization",
        );
      await fs.chmod(temporary, 0o644);
      if (owner && process.getuid?.() === 0)
        await fs.chown(temporary, owner.uid, owner.gid);
      await fs.rename(temporary, path.join(dir, name));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  });
}
export async function copyAsset(source: FileHandle, destination: string) {
  const target = await fs.open(destination, "wx", 0o600);
  try {
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
      await target.writeFile(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await target.sync();
  } finally {
    await target.close();
  }
}
