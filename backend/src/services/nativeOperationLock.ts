const operations = new Set<number>();
const mutations = new Set<number>();
export function assertNativeIdle(id: number) {
    if (operations.has(id)) throw Object.assign(new Error('A native install or update is running; wait for it to finish before changing this server'), { statusCode: 409 });
}
export function acquireNativeOperation(id: number, fromRequest = false): () => void {
    assertNativeIdle(id);
    if (!fromRequest && mutations.has(id)) throw Object.assign(new Error('Another server change is in progress'), { statusCode: 409 });
    operations.add(id);
    let released = false;
    return () => { if (!released) { released = true; operations.delete(id); } };
}
export function enterServerMutation(id: number): () => void {
    assertNativeIdle(id);
    if (mutations.has(id)) throw Object.assign(new Error('Another server change is in progress'), { statusCode: 409 });
    mutations.add(id);
    let released = false;
    return () => { if (!released) { released = true; mutations.delete(id); } };
}
export const nativeOperationRunning = (id: number) => operations.has(id);
