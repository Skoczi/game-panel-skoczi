// Legacy local runtimes own unscoped containers. Agents always own an explicit UUID.
export const NODE_LABEL = 'gamepanel.node';
export function runtimeNodeId(): string | undefined {
    return process.env.GAMEPANEL_NODE_ID || undefined;
}
export function runtimeLabels(): Record<string, string> {
    const id = runtimeNodeId();
    return id ? { [NODE_LABEL]: id } : {};
}
export function ownsContainer(labels: Record<string, string> = {}): boolean {
    return (
        labels['gamepanel.managed'] === 'true' &&
        (labels[NODE_LABEL] || undefined) === runtimeNodeId()
    );
}
