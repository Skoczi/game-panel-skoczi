import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsModule from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as crypto from "node:crypto";
import * as childProcess from "node:child_process";
import * as events from "node:events";
import { tmpdir } from "node:os";
import * as safeFs from "../src/services/fastDownloadFs.js";
import { loadWithMocks } from "./loadWithMocks.js";
import { validateTemplate, templateHash } from "../src/templates/schema.js";
import { NATIVE_CS16_TEMPLATE } from "../src/templates/nativeCs16.js";

const profile = {
  enabled: true,
  gameRoot: "serverfiles/cstrike",
  folders: ["maps", "models"],
  compression: "bzip2",
  configFile: "serverfiles/cstrike/server.cfg",
};
test("template FastDownload profile is explicit, validated and does not change legacy snapshot hashes", () => {
  const before = validateTemplate(NATIVE_CS16_TEMPLATE);
  assert.equal(templateHash(before), templateHash(validateTemplate(before)));
  assert.equal(before.fastDownload, undefined);
  const enabled = validateTemplate({ ...before, fastDownload: profile });
  assert.deepEqual(enabled.fastDownload, profile);
  for (const patch of [
    { gameRoot: "../data" },
    { folders: ["maps", "../cfg"] },
    { folders: ["cfg"] },
    { configFile: "serverfiles/cstrike/../secret.cfg" },
  ])
    assert.throws(() =>
      validateTemplate({ ...before, fastDownload: { ...profile, ...patch } }),
    );
  assert.equal(
    validateTemplate({ ...before, fastDownload: { enabled: false } })
      .fastDownload?.enabled,
    false,
  );
});
test("publishes originals/compression; preserves manual updates; deletes linked variants; rejects unsafe paths and retains files on scan errors", async () => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "gp-fdl-")),
  );
  const data = path.join(directory, "servers/8/data"),
    source = path.join(data, "serverfiles/cstrike"),
    target = path.join(data, "fastdownload/cstrike");
  const env = {
    ...process.env,
    GAMEPANEL_FASTDL_ORIGIN: "https://waw2.example.test",
    GAMEPANEL_FASTDL_ACCEL: "1",
  };
  const server = { id: 8, status: "running", docker_container_id: "test" };
  const commands: string[] = [];
  const module = loadWithMocks(
    "../src/services/fastDownload.ts",
    {
      "node:fs": fsModule,
      "./gameConsole.js": {
        sendGameConsoleCommand: async (_server: unknown, command: string) => { commands.push(command); return {ok:true}; },
      },
      "node:path": path,
      "node:crypto": crypto,
      "node:child_process": childProcess,
      "node:events": events,
      "../config.js": {
        getConfig: () => ({
          gamepanelDataDir: path.join(directory, "private"),
        }),
      },
      "../database/index.js": {
        serverRepository: {
          findById: async (id: number) => (id === 8 ? server : null),
          listAll: async () => [server],
        },
        actionsRepository: { create: async () => {} },
      },
      "../utils/storage.js": {
        getServerStoragePaths: () => ({ dataDir: data }),
      },
      "./nativeBackups.js": {
        nativeServerTemplate: () => ({
          runtime: {},
          mounts: [{ key: "data", containerPath: "/data" }],
          fastDownload: profile,
        }),
      },
      "./nativeOperationLock.js": { enterServerMutation: () => () => {} },
      "./fastDownloadFs.js": safeFs,
    },
    {
      process: { ...process, env },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      Buffer,
    },
  );
  const write = async (relative: string, value: string) => {
    const file = path.join(source, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
    await fs.utimes(file, new Date(1000), new Date(1000));
  };
  try {
    await write("maps/test.bsp", "map data ".repeat(100));
    await write("server.cfg", 'hostname "test"\n');
    await write("addons/private.mdl", "private");
    await module.synchronizeFastDownload(8);
    assert.deepEqual(commands, ['sv_downloadurl "https://waw2.example.test/fdl/srv8/cstrike/"']);
    assert.equal(
      await fs.readFile(path.join(target, "maps/test.bsp"), "utf8"),
      "map data ".repeat(100),
    );
    assert.equal(
      (await fs.readFile(path.join(target, "maps/test.bsp.bz2")))
        .subarray(0, 3)
        .toString(),
      "BZh",
    );
    assert.equal(
      await module.resolveFastDownload(8, "cstrike/maps/test.bsp"),
      "8/data/fastdownload/cstrike/maps/test.bsp",
    );
    for (const name of [
      "cstrike/server.cfg",
      "cstrike/maps/../../server.cfg",
      "cstrike/addons/private.mdl",
      "cstrike/maps/.hidden.bsp",
    ])
      assert.equal(await module.resolveFastDownload(8, name), null);
    await fs.writeFile(path.join(target, "maps/manual.bsp"), "standalone");
    await fs.writeFile(path.join(target, "maps/test.bsp"), "manual override");
    await module.synchronizeFastDownload(8);
    assert.equal(
      await fs.readFile(path.join(target, "maps/test.bsp"), "utf8"),
      "manual override",
    );
    await assert.rejects(fs.stat(path.join(target, "maps/test.bsp.bz2")));
    await fs.writeFile(
      path.join(target, "maps/test.bsp.bz2"),
      "manual compressed override",
    );
    await fs.rename(source, source + "-offline");
    await assert.rejects(module.synchronizeFastDownload(8));
    assert.equal(
      await fs.readFile(path.join(target, "maps/test.bsp"), "utf8"),
      "manual override",
    );
    await fs.rename(source + "-offline", source);
    await fs.unlink(path.join(source, "maps/test.bsp"));
    await module.synchronizeFastDownload(8);
    await assert.rejects(fs.stat(path.join(target, "maps/test.bsp")));
    await assert.rejects(fs.stat(path.join(target, "maps/test.bsp.bz2")));
    assert.equal(
      await fs.readFile(path.join(target, "maps/manual.bsp"), "utf8"),
      "standalone",
    );
    await fs.symlink(
      path.join(source, "server.cfg"),
      path.join(target, "maps/leak.bsp"),
    );
    await assert.rejects(
      module.resolveFastDownload(8, "cstrike/maps/leak.bsp"),
    );
    await module.updateFastDownload(8, { enabled: false }, "test");
    assert.equal(
      await module.resolveFastDownload(8, "cstrike/maps/manual.bsp"),
      null,
    );
    assert.equal((await module.fastDownloadStatus(8)).enabled, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
