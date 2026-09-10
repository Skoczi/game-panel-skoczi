import { ArrowRight, X } from 'lucide-react';
import { AppButton } from '../src/ui/components';
import type { OvhcloudImage } from '../utils/ovhcloudCatalog';

const MC_SERVER_TYPES: { key: string; label: string }[] = [
  { key: 'vanilla',  label: 'Java Edition' },
  { key: 'bedrock',  label: 'Bedrock Edition' },
  { key: 'paper',    label: 'Paper' },
  { key: 'fabric',   label: 'Fabric' },
  { key: 'neoforge', label: 'NeoForge' },
  { key: 'forge',    label: 'Forge' },
];

function getMcServerType(imageId: string): string {
  if (imageId.includes('paper'))        return 'paper';
  if (imageId.includes('java-edition')) return 'vanilla';
  if (imageId.includes('fabric'))       return 'fabric';
  if (imageId.includes('neoforge'))     return 'neoforge';   // must stay ABOVE 'forge'
  if (imageId.includes('forge'))        return 'forge';
  if (imageId.includes('bedrock'))      return 'bedrock';
  return 'unknown';
}

interface GameVersionModalProps {
  images: OvhcloudImage[];
  onSelect: (image: OvhcloudImage) => void;
  onClose: () => void;
}

export function GameVersionModal({ images, onSelect, onClose }: GameVersionModalProps) {
  const availableTypes = MC_SERVER_TYPES.filter(t =>
    images.some(img => getMcServerType(img.imageId) === t.key)
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gradient-to-br dark:from-[#1f2937] dark:to-[#111827] border border-gray-200 dark:border-gray-700/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-700/50">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Minecraft</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Select server type and version</p>
          </div>
          <AppButton tone="ghost" onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </AppButton>
        </div>

        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Server Type
          </p>
          <div className="grid grid-cols-1 gap-2">
            {availableTypes.map(({ key, label }) => {
              const typeImages = images.filter(img => getMcServerType(img.imageId) === key);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(typeImages[0])}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all border-gray-200 dark:border-gray-700/40 hover:border-gray-300 dark:hover:border-gray-600/50 bg-gp-surface-elevated"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 flex-shrink-0 text-gray-300 dark:text-gray-600" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
