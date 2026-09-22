import { createSocket } from 'node:dgram';
import { isIP } from 'node:net';
import type { GameQueryInfo } from '../templates/types.js';

// A2S_INFO, including the challenge used by current Steam game servers.
const request = Buffer.concat([Buffer.from([255, 255, 255, 255, 0x54]), Buffer.from('Source Engine Query\0')]);
export function parseGameInfo(packet: Buffer): GameQueryInfo {
    let offset = 5;
    const byte = () => {
        if (offset >= packet.length) throw new Error('Truncated A2S response');
        return packet[offset++];
    };
    const text = () => {
        const end = packet.indexOf(0, offset);
        if (end < 0 || end - offset > 4096) throw new Error('Invalid A2S string');
        const value = packet.toString('utf8', offset, end).replace(/[\x00-\x1f\x7f]/g, '');
        offset = end + 1;
        return value;
    };
    if (packet.length < 6 || packet.readInt32LE(0) !== -1) throw new Error('Invalid A2S response');
    if (packet[4] === 0x49) {
        byte(); // Protocol version
        const name = text(), map = text(); text(); text(); // Folder and game
        byte(); byte(); // App ID
        const players = byte(), maxPlayers = byte(), bots = byte();
        byte(); byte(); byte(); byte(); text(); // Type, environment, password, VAC, version
        return { name, map, players, maxPlayers, bots };
    }
    if (packet[4] === 0x6d) {
        text(); // GoldSrc address
        const name = text(), map = text(); text(); text();
        const players = byte(), maxPlayers = byte();
        byte(); byte(); byte(); byte();
        if (byte()) { text(); text(); byte(); for (let i = 0; i < 10; i++) byte(); }
        byte(); const bots = byte();
        return { name, map, players, maxPlayers, bots };
    }
    throw new Error('Unsupported A2S response type');
}

export function queryGame(host: string, port: number, timeoutMs = 2500): Promise<{ info: GameQueryInfo; latencyMs: number }> {
    if (isIP(host) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('Invalid game query endpoint'));
    return new Promise((resolve, reject) => {
        const socket = createSocket('udp4');
        const started = Date.now();
        let done = false, challenges = 0, splitId: number | undefined, count = 0, bytes = 0;
        const fragments = new Map<number, Buffer>();
        const finish = (error?: Error, info?: GameQueryInfo) => {
            if (done) return;
            done = true; clearTimeout(timer);
            try { socket.close(); } catch { /* Not bound yet. */ }
            if (error) reject(error);
            else resolve({ info: info!, latencyMs: Date.now() - started });
        };
        const timer = setTimeout(() => finish(new Error('Game query timed out')), timeoutMs);
        const send = (data: Buffer) => { socket.send(data, error => { if (error) finish(error); }); };
        socket.on('error', finish);
        socket.on('message', (data) => {
            try {
                if (data.length < 5) throw new Error('Truncated A2S response');
                if (data.readInt32LE(0) === -1 && data[4] === 0x41) {
                    if (data.length !== 9 || ++challenges > 2) throw new Error('Invalid A2S challenge');
                    send(Buffer.concat([request, data.subarray(5)])); return;
                }
                if (data.readInt32LE(0) === -2) {
                    if (data.length < 9) throw new Error('Truncated split A2S response');
                    const id = data.readUInt32LE(4);
                    if (id & 0x80000000) throw new Error('Compressed A2S responses are not supported');
                    // Source has separate count/index bytes; GoldSrc packs both into one.
                    const source = data.length >= 12 && data[8] >= 2 && data[8] <= 16 && data[9] < data[8];
                    const total = source ? data[8] : data[8] & 15;
                    const index = source ? data[9] : data[8] >> 4;
                    if (total < 2 || total > 16 || index >= total || (splitId !== undefined && (id !== splitId || count !== total))) throw new Error('Invalid split A2S response');
                    splitId = id; count = total;
                    if (!fragments.has(index)) {
                        const part = data.subarray(source ? 12 : 9);
                        bytes += part.length;
                        if (bytes > 65536) throw new Error('A2S response too large');
                        fragments.set(index, part);
                    }
                    if (fragments.size !== count) return;
                    data = Buffer.concat(Array.from({ length: count }, (_, i) => fragments.get(i)!));
                }
                finish(undefined, parseGameInfo(data));
            } catch (error) { finish(error as Error); }
        });
        // Connected UDP accepts responses only from this exact endpoint.
        socket.connect(port, host, () => { if (!done) send(request); });
    });
}
