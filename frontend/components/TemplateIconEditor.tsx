import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { GAME_ICONS, MAX_GAME_ICON_BYTES } from '../../backend/src/templates/gameIcons';
import { GameIcon } from './GameIcon';
import type { GameTemplate } from '../utils/gameTemplates';
import './templateIconEditor.css';

export function TemplateIconEditor({ draft, change }: { draft: GameTemplate; change: (patch: Partial<GameTemplate>) => void }) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const request = useRef(0);
    const choose = (icon?: string) => { request.current++; setBusy(false); setError(''); change({ icon }); };
    const upload = async (file: File) => {
        const current = ++request.current;
        setError(''); setBusy(true);
        try {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)
                throw new Error('Choose a PNG, JPEG or WebP image up to 2 MiB.');
            const bitmap = await createImageBitmap(file);
            try {
                if (!bitmap.width || !bitmap.height) throw new Error('The image could not be read.');
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 64;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Image processing is unavailable.');
                const scale = Math.min(64 / bitmap.width, 64 / bitmap.height);
                const w = bitmap.width * scale, h = bitmap.height * scale;
                ctx.drawImage(bitmap, (64 - w) / 2, (64 - h) / 2, w, h);
                const icon = canvas.toDataURL('image/png');
                if (atob(icon.split(',')[1]).length > MAX_GAME_ICON_BYTES) throw new Error('This image is too complex. Choose a simpler icon.');
                if (current === request.current) change({ icon });
            } finally { bitmap.close(); }
        } catch (e) {
            if (current === request.current) setError(e instanceof Error ? e.message : 'Could not read this image.');
        } finally { if (current === request.current) setBusy(false); }
    };
    return <fieldset className="gp-template-icon">
        <legend>Game icon</legend>
        <div className="gp-template-icon-preview"><GameIcon game={draft.name} icon={draft.icon} /><span>Shown beside the server name in list view.</span></div>
        <div className="gp-template-icon-library" role="group" aria-label="Game icon library">
            <button type="button" aria-pressed={!draft.icon} onClick={() => choose()}>Automatic</button>
            {GAME_ICONS.map(item => <button type="button" key={item.id} aria-label={item.label} aria-pressed={draft.icon === item.id} onClick={() => choose(item.id)}>
                <GameIcon game={item.label} icon={item.id} /><span>{item.label}</span>
            </button>)}
        </div>
        <label className="gp-template-icon-upload"><Upload size={16} aria-hidden="true" />Upload your own icon
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => {
                const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void upload(file);
            }} />
        </label>
        <small>PNG, JPEG or WebP · up to 2 MiB. Saved with this template as a 64 × 64 icon.</small>
        {draft.icon?.startsWith('data:') && <span role="status">Custom icon selected</span>}
        {busy && <span role="status">Preparing icon…</span>}
        {error && <span role="alert">{error}</span>}
    </fieldset>;
}
