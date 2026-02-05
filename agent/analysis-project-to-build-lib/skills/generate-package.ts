import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonResult {
    success: boolean;
    packageJsonPath: string;
    content: Record<string, unknown>;
    error?: string;
}

export async function generateLibPackageJson(
    libPath: string,
    libName: string,
    externalDeps?: string[]
): Promise<PackageJsonResult> {
    const packageJsonPath = path.join(libPath, 'package.json');

    try {
        // Read existing package.json if it exists to get dependency versions
        let existingDeps: Record<string, string> = {};
        const rootPackageJson = path.resolve(libPath, '../../package.json');
        if (fs.existsSync(rootPackageJson)) {
            const rootPkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf-8'));
            existingDeps = {
                ...rootPkg.dependencies,
                ...rootPkg.devDependencies
            };
        }

        // Known optional dependencies that should be marked as optional
        const knownOptionalDeps = new Set([
            '@lydell/node-pty',
            '@mozilla/readability',
            'linkedom',
            '@napi-rs/canvas',
            'pdfjs-dist',
            'sqlite-vec',
            'better-sqlite3',
            'playwright',
            'playwright-core'
        ]);

        // Build dependencies object with versions
        const dependencies: Record<string, string> = {};
        const peerDependencies: Record<string, string> = {};
        const optionalDependencies: Record<string, string> = {};

        for (const dep of externalDeps || []) {
            // Skip Node.js built-in modules (node:* prefix)
            if (dep.startsWith('node:')) {
                continue;
            }
            // Skip relative imports that were incorrectly classified
            if (dep.startsWith('.') || dep.startsWith('/')) {
                continue;
            }
            
            const version = existingDeps[dep] || '*';
            
            // Check if it's a known optional dependency
            if (knownOptionalDeps.has(dep)) {
                optionalDependencies[dep] = version;
            } else {
                dependencies[dep] = version;
            }
        }

        const packageJson = {
            name: libName,
            version: '1.0.0',
            description: `Extracted library: ${libName}`,
            type: 'module',
            main: './dist/index.js',
            types: './dist/index.d.ts',
            exports: {
                '.': {
                    types: './dist/index.d.ts',
                    import: './dist/index.js'
                }
            },
            files: ['dist'],
            scripts: {
                build: 'tsc',
                'build:watch': 'tsc --watch',
                clean: 'rm -rf dist',
                prepublishOnly: 'npm run build'
            },
            keywords: ['typescript', 'library'],
            license: 'MIT',
            dependencies,
            peerDependencies,
            optionalDependencies,
            devDependencies: {
                typescript: '^5.0.0'
            }
        };

        await fs.promises.writeFile(
            packageJsonPath,
            JSON.stringify(packageJson, null, 2),
            'utf-8'
        );

        // Also create tsconfig.json for the library
        await createLibTsConfig(libPath);

        return {
            success: true,
            packageJsonPath,
            content: packageJson
        };

    } catch (error) {
        return {
            success: false,
            packageJsonPath,
            content: {},
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

async function createLibTsConfig(libPath: string): Promise<void> {
    const tsConfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
            outDir: './dist',
            rootDir: './src',
            strict: false,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            noImplicitAny: false,
            allowImportingTsExtensions: true,
            noEmit: true
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx']
    };

    await fs.promises.writeFile(
        path.join(libPath, 'tsconfig.json'),
        JSON.stringify(tsConfig, null, 2),
        'utf-8'
    );
}
