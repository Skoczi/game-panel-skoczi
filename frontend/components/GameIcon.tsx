import { Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import { GAME_ICONS } from '../../backend/src/templates/gameIcons';
import './serverListPresentation.css';

function automaticIcon(game: string) {
    const value = game.toLowerCase().replace(/[_-]/g, ' ');
    if (/\bcs2(?:server)?\b|counter\s*strike\s*2/.test(value)) return 'counter-strike-2';
    if (/\bcsgo(?:server)?\b|global offensive|counter\s*strike:?\s*go\b/.test(value)) return 'counter-strike-go';
    if (/\bcss(?:server)?\b|counter\s*strike:?\s*source/.test(value)) return 'counter-strike-source';
    if (/\b(cs|csserver|cs16|cstrike|rehlds|goldsrc)\b|counter\s*strike/.test(value)) return 'counter-strike';
    if (/\btf2(?:server)?\b|team fortress 2/.test(value)) return 'team-fortress-2';
    if (/\b(gmod|gmodserver|garrysmod)\b|garry.?s mod/.test(value)) return 'garrys-mod';
    return undefined;
}

export function GameIcon({ game, icon }: { game: string; icon?: string }) {
    const [failed, setFailed] = useState<string>();
    const id = icon || automaticIcon(game);
    const builtin = GAME_ICONS.find(item => item.id === id);
    const src = builtin ? `/game-icons/${builtin.id}.jpg`
        : icon?.startsWith('data:image/png;base64,') && icon.length < 22000 ? icon : undefined;
    return <span className="gp-game-icon" role="img" aria-label={game} title={game}>
        {src && src !== failed ? <img src={src} alt="" width={32} height={32} onError={() => setFailed(src)} /> : <Gamepad2 size={21} aria-hidden="true" />}
    </span>;
}
