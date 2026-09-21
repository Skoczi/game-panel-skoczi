import tar from 'tar-stream';

// In-memory archive: script source never touches a host data directory or process argv.
export async function nativeScriptArchive(name: string, script: string, uid: number, gid: number): Promise<Buffer> {
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    const completed = (async () => {
        for await (const chunk of pack) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    })();
    pack.entry({ name, mode: 0o400, uid, gid, type: 'file' }, script);
    pack.finalize();
    return completed;
}
