# Node-local FastDownload

FastDownload is available in 2.0.55 for Native Runtime templates with a `data` mount at `/data`. Configure hosting on each participating node before enabling a template profile. This is an optional hosting integration; the standard installer/updater does not rewrite existing reverse proxies.

## Publication profiles

For GoldSrc / Counter-Strike 1.6, add this profile in **Game Templates → FastDownload** (or the template JSON):

```json
"fastDownload": {
  "enabled": true,
  "gameRoot": "serverfiles/cstrike",
  "folders": ["maps", "models", "sound", "sprites", "gfx", "overviews"],
  "compression": "none",
  "configFile": "serverfiles/cstrike/server.cfg"
}
```

`none` means direct, read-only serving of approved game assets: no copies or links. For a Source game, choose `bzip2` and set the appropriate game root, folders and config path. Only `.bz2` outputs are generated in `data/fastdownload/<game>`. The original stays in `serverfiles`. Compression is a template default, with a per-server override in Settings; keep the mode compatible with the game's download client.

Profiles are included in immutable installed-template snapshots. Publishing a changed template only affects installations using that version; do not silently mutate existing snapshots. Templates without an enabled profile do not expose assets.

## Hosting example: existing Nginx reverse proxy

The backend authorizes each public asset path. A separate node-local Nginx container reads the asset bytes through an **internal** proxy location. Do not point a public `alias` at the whole server data directory.

1. Upgrade the panel/agents to 2.0.55. Add these environment values to the node's backend/agent service, replacing the example origin:

   ```text
   GAMEPANEL_FASTDL_ORIGIN=https://node.example.com
   GAMEPANEL_FASTDL_ACCEL=1
   ```

2. Copy [the asset-service configuration](../../deploy/fastdownload/nginx.conf) to a persistent host path. Add this service to the node's existing Compose configuration, replacing the two host paths. `/srv/gamepanel/servers` must be the **actual** storage root used by `getServerStoragePaths`, not an unrelated directory.

   ```yaml
   services:
     fastdownload:
       image: nginxinc/nginx-unprivileged@sha256:e75f89810bf5bfbcf58a1cfb32a1a11de55b7623d732e67735d513b720d7436a
       restart: unless-stopped
       user: "0:0"
       entrypoint: ["nginx", "-g", "daemon off;"]
       read_only: true
       cap_drop: [ALL]
       security_opt: ["no-new-privileges:true"]
       ports: ["127.0.0.1:18083:8080"]
       volumes:
         - /srv/gamepanel/servers:/servers:ro
         - /etc/gamepanel/fastdownload-nginx.conf:/etc/nginx/nginx.conf:ro
       tmpfs: ["/tmp:rw,nosuid,noexec,size=32m"]
       pids_limit: 64
       mem_limit: 128m
       cpus: 0.5
       networks: [fastdownload]
   networks:
     fastdownload:
       driver: bridge
   ```

   The single Nginx process uses UID 0 to traverse existing private root-owned storage directories without changing their permissions. All capabilities are dropped, the game mount and root filesystem are read-only, symlinks are disabled and the listener is bound to loopback. Do not expose port 18083 publicly.

3. Add these locations to the public node virtual host. Substitute the node's actual backend port (`18082` below is an example). Install the same routes in the HTTP virtual host if HTTP clients are supported; do not rely on game clients following HTTPS redirects.

   ```nginx
   location ^~ /fdl/ {
     proxy_pass http://127.0.0.1:18082;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $remote_addr;
     proxy_set_header X-Forwarded-Proto $scheme;
   }
   location ^~ /_gamepanel_fdl/ {
     internal;
     proxy_pass http://127.0.0.1:18083/;
     proxy_set_header Host localhost;
     proxy_set_header Authorization "";
     proxy_set_header Cookie "";
     proxy_force_ranges on;
     proxy_buffering off;
     proxy_read_timeout 300s;
   }
   ```

   Validate the asset container and host Nginx configurations before reloading them. Recreate only the backend/agent whose environment changed and start the new asset service. Existing frontend, game containers and unrelated services need no changes. If using Traefik or another public proxy, place an Nginx gateway with these validation/internal-serving routes behind it; forwarding `/fdl/` directly to the asset service bypasses the authorization checks and is unsupported.

4. Enable the game template/profile. In **Settings → FastDownload**, check the URL, choose the correct publication mode and synchronize. Use **Set URL in server.cfg** where supported. An unrelated existing `sv_downloadurl` is preserved until explicitly replaced.

5. Verify the server root, game root and an actual file URL, e.g. `/fdl/srv8/cstrike/maps/custom.bsp`. Confirm private configuration paths and `/_gamepanel_fdl/…` return 404, file downloads/ranges work, and a real game client can download a custom asset. HTTP success alone is not a client-compatibility check.

## Files, ownership and recovery

- Direct mode exposes only supported assets under the template's folders. Removing or changing the source affects the public URL immediately. It never creates a FastDownload folder.
- BZIP2 mode synchronizes every minute or on demand. Upload extra assets to `data/fastdownload/<game>` through the file manager. Automatically generated files do not overwrite manual replacements. A linked source deletion removes both linked variants, including a manual replacement; standalone manual uploads survive.
- Switching to direct mode removes only files still matching the publication manifest and prunes empty directories. Manual files are retained on disk but are not served by direct mode; manage them explicitly through the file manager.
- Active asynchronous uploads/imports pause synchronization. Unsafe paths, symlinks, hardlinks, configuration files, logs and technical directories are excluded. A failed/incomplete source scan never triggers bulk deletion.
- The private ownership manifest resides in backend data, outside the public asset tree. Native backups include `fastdownload` when present; archives without it preserve existing FDL files. Keep backend state and game data together in a complete host recovery plan.
- Public listings are read-only, bounded and paginated. They list supported content, not the host filesystem or all servers on a node. Unknown/private paths show a styled 404.
