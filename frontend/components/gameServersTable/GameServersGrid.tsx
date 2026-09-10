import { Plus } from 'lucide-react';
import type { GameServer } from '../../types/gameServer';
import { GameServerCard, type GameServerCardActions } from './GameServerCard';

interface GameServersGridProps extends GameServerCardActions {
  filteredAndSortedServers: GameServer[];
  canOpenInstallModal: boolean;
  canInstall: boolean;
  onOpenInstallModal?: () => void;
}

export function GameServersGrid({
  filteredAndSortedServers,
  canOpenInstallModal,
  canInstall,
  onOpenInstallModal,
  ...cardActions
}: GameServersGridProps) {
  return (
    <div className="gp-game-servers-grid space-y-3 pb-4 md:pb-6">
      {filteredAndSortedServers.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-400">No game servers yet.</p>
          <p className="mt-1 text-xs text-gray-500">Use “Add Game Server” to install your first one.</p>
        </div>
      )}

      <div
        className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        role="list"
      >
        {filteredAndSortedServers.map((server) => (
          <GameServerCard key={server.id} server={server} variant="grid" {...cardActions} />
        ))}

        <button
          type="button"
          onClick={() => {
            if (!canOpenInstallModal) return;
            onOpenInstallModal?.();
          }}
          disabled={!canOpenInstallModal}
          title={canInstall ? 'Install game server' : 'Missing permission: server.install'}
          className={`group flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 font-semibold transition-all ${
            canOpenInstallModal
              ? 'border-[var(--color-cyan-400)]/40 bg-[#0050D7]/5 text-[var(--color-cyan-400)] hover:border-[var(--color-cyan-400)] hover:bg-[#157EEA]/15 hover:text-white'
              : 'cursor-not-allowed border-gray-700 bg-gray-800/40 text-gray-500'
          }`}
        >
          <span className="inline-flex h-8 w-8 items-center justify-center text-current transition-colors">
            <Plus className="h-6 w-6 stroke-[3]" />
          </span>
          <span>Add Game Server</span>
        </button>
      </div>
    </div>
  );
}
