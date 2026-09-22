import { AppToggle } from '../src/ui/components';
import { AppSelect } from '../src/ui/components/AppSelect';
import type { GameTemplate } from '../utils/gameTemplates';
const field =
  'mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-600';
export function TemplateFastDownloadEditor({
  draft,
  change,
}: {
  draft: GameTemplate;
  change: (patch: Partial<GameTemplate>) => void;
}) {
  const f = draft.fastDownload;
  const update = (patch: Partial<NonNullable<GameTemplate['fastDownload']>>) =>
    change({ fastDownload: { enabled: true, ...f, ...patch } });
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">FastDownload</h3>
        <p className="mt-2 text-sm text-slate-500">
          Choose whether this game uses FastDownload and which folders are published automatically.
          Each installed server receives this version’s configuration.
        </p>
      </div>
      <AppToggle
        checked={!!f?.enabled}
        disabled={draft.schemaVersion !== 2}
        label="This game uses FastDownload"
        onChange={(enabled) =>
          change({
            fastDownload: enabled
              ? {
                  enabled: true,
                  gameRoot: 'serverfiles/cstrike',
                  folders: ['maps', 'models', 'sound', 'sprites', 'gfx', 'overviews'],
                  compression: 'none',
                  configFile: 'serverfiles/cstrike/server.cfg',
                }
              : { enabled: false },
          })
        }
      />
      {draft.schemaVersion !== 2 && (
        <p className="text-sm text-slate-500">
          Requires a Native Runtime template with a /data mount.
        </p>
      )}
      {f?.enabled && (
        <>
          <label className="block text-sm">
            Game directory inside /data
            <input
              className={field}
              value={f.gameRoot || ''}
              placeholder="serverfiles/cstrike"
              onChange={(e) => update({ gameRoot: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Automatic folders · one per line
            <textarea
              className={`${field} font-mono`}
              rows={7}
              value={(f.folders || []).join('\n')}
              onChange={(e) => update({ folders: e.target.value.split('\n') })}
            />
          </label>
          <p className="text-sm text-slate-500">
            Paths are relative to the game directory. Only supported asset files are published.
            Configuration files, plugins, logs and links stay private.
          </p>
          <AppSelect
            controlLabel="Default compression"
            value={f.compression || 'none'}
            options={[
              { value: 'none', label: 'Direct game files · GoldSrc / CS 1.6' },
              { value: 'bzip2', label: '.bz2 files only · Source' },
            ]}
            onChange={(value) => update({ compression: value as 'none' | 'bzip2' })}
          />
          <label className="block text-sm">
            Configuration file for sv_downloadurl · optional
            <input
              className={field}
              value={f.configFile || ''}
              placeholder="serverfiles/cstrike/server.cfg"
              onChange={(e) => update({ configFile: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
