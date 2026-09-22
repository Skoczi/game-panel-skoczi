import { execFile } from 'node:child_process';

export function runExternalBackupWorker<T>(worker: string, payload: Record<string, unknown>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      // Hard NFS I/O can outlive SIGKILL. Report failure without waiting for exit.
      reject(new Error('External storage timed out. Check its connection before retrying.'));
    }, timeout);
    const child = execFile(process.execPath, [worker], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const response = JSON.parse(stdout);
        if (error || response.error) reject(new Error(response.error || 'External storage failed'));
        else resolve(response.result);
      } catch { reject(new Error('External storage worker did not return a confirmed result')); }
    });
    child.stdin?.on('error', () => { /* execFile callback reports failed workers */ });
    child.stdin?.end(JSON.stringify(payload));
  });
}
