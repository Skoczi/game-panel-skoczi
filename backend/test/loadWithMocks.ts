// Execute our own compiled module with explicit test doubles; no database or daemon access.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
export function loadWithMocks(relativePath: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): any {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, {
        ...globals,
        exports: module.exports, module,
        require: (name: string) => {
            if (!(name in mocks)) throw new Error(`Unexpected test dependency: ${name}`);
            return mocks[name];
        },
    }, { filename: relativePath });
    return module.exports;
}
