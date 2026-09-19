import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type Dockerode from 'dockerode';
import { docker } from '../utils/docker/client.js';
import { getDatabase } from '../database/init.js';
import { bus } from '../realtime/bus.js';

const MAX_LINES = 2000;
const MAX_LINE = 4096;
const MAX_BYTES = 512 * 1024;

export function redactNativeLog(line: string, secrets: string[]): string {
    let safe = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/((?:password|passwd|token|secret|rcon_password)\s*[:=]\s*)\S+/gi, '$1[REDACTED]').slice(0, MAX_LINE);
}

export async function nativeLogHistory(serverId: number): Promise<string[]> {
    const db = await getDatabase();
    const row = await db.get<{ lines_json: string }>('SELECT lines_json FROM native_operation_logs WHERE server_id = ?', serverId);
    return row ? JSON.parse(row.lines_json) : [];
}

// One capture per maintenance container; independent of browser connections.
// Retain a bounded redacted tail before deleting the temporary container.
export async function captureNativeLogs(container: Dockerode.Container, serverId: number, secrets: string[]) {
    const lines = await nativeLogHistory(serverId);
    let bytes = lines.reduce((n, line) => n + Buffer.byteLength(line), 0);
    let pending: string[] = [];
    let dirty = false;
    let save = Promise.resolve();
    let saving = false;
    let persistenceError: unknown;
    let stream: NodeJS.ReadableStream | undefined;
    const outputs = [new PassThrough(), new PassThrough()];
    const add = (line: string) => {
        const safe = redactNativeLog(line, secrets);
        if (!safe) return;
        lines.push(safe);
        bytes += Buffer.byteLength(safe);
        while (lines.length > MAX_LINES || bytes > MAX_BYTES) bytes -= Buffer.byteLength(lines.shift()!);
        pending.push(safe);
        if (pending.length > MAX_LINES) pending.shift();
        dirty = true;
    };
    const flush = () => {
        if (!dirty || saving || persistenceError) return;
        dirty = false;
        saving = true;
        const snapshot = JSON.stringify(lines);
        const batch = pending; pending = [];
        save = (async () => {
            const db = await getDatabase();
            await db.run('INSERT INTO native_operation_logs(server_id, lines_json) VALUES (?, ?) ON CONFLICT(server_id) DO UPDATE SET lines_json = excluded.lines_json', serverId, snapshot);
            bus.emit('server.native.logs', { serverId, lines: batch });
        })().catch(error => { persistenceError = error; }).finally(() => { saving = false; });
    };
    const finishLines: Array<() => void> = [];
    for (const output of outputs) {
        const decoder = new StringDecoder('utf8');
        let buffer = '';
        output.on('data', (chunk: Buffer) => {
            buffer += decoder.write(chunk);
            const parts = buffer.split(/\r\n|\r|\n/);
            buffer = parts.pop() || '';
            for (const part of parts) add(part);
            // Do not emit partial lines: secrets may straddle chunks.
            if (buffer.length > 65536) buffer = '[Oversized installer line omitted]';
        });
        finishLines.push(() => { buffer += decoder.end(); if (buffer) add(buffer); buffer = ''; });
    }
    stream = await container.logs({ follow: true, stdout: true, stderr: true, timestamps: true }) as unknown as NodeJS.ReadableStream;
    const ended = new Promise<void>((resolve) => {
        stream!.once('end', resolve);
        stream!.once('close', resolve);
        stream!.once('error', resolve);
    });
    docker.modem.demuxStream(stream, outputs[0], outputs[1]);
    const timer = setInterval(flush, 500);
    return {
        async finish() {
            let drainTimer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([ended, new Promise<void>(resolve => { drainTimer = setTimeout(resolve, 2000); })]);
            if (drainTimer) clearTimeout(drainTimer);
            clearInterval(timer);
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            for (const finish of finishLines) finish();
            for (const output of outputs) output.destroy();
            await save;
            flush();
            await save;
            if (persistenceError) throw persistenceError;
        },
    };
}
