import { docker } from '../utils/docker/client.js';
import type { GameTemplate } from '../templates/types.js';
import { TemplateError } from '../templates/schema.js';

// Resolve tags once, before creating a server/reserving ports. No implicit registry pull.
export async function inspectNativeImage(reference: string, role: string): Promise<string> {
    try {
        const image = await docker.getImage(reference).inspect();
        if (!/^sha256:[a-f0-9]{64}$/.test(image.Id)) throw new Error('Invalid image identity');
        const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
        if (image.Os !== 'linux' || image.Architecture !== architecture) {
            throw new TemplateError(`${role} image must be Linux ${architecture} on this node`, 409);
        }
        return image.Id;
    } catch (error: any) {
        if (error instanceof TemplateError) throw error;
        if (error?.statusCode === 404) throw new TemplateError(`${role} image is missing on this node: ${reference}. Load the reviewed image first; no installation was started.`, 409);
        throw new TemplateError(`Cannot verify ${role.toLowerCase()} image on this node. Check Docker and retry.`, 503);
    }
}

export async function resolveNativeImages(template: GameTemplate) {
    const nativeRuntimeImage = await inspectNativeImage(template.runtime.image, 'Runtime');
    const installer = template.lifecycle?.installerImage;
    const nativeInstallerImage = !installer || installer === template.runtime.image
        ? nativeRuntimeImage : await inspectNativeImage(installer, 'Installer');
    return { nativeRuntimeImage, nativeInstallerImage };
}
