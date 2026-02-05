import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonResult {
    success: boolean;
    packageJsonPath: string;
    content: Record<string, unknown>;
    error?: string;
}

// Packages that need @types/* declarations
const PACKAGES_NEEDING_TYPES = new Set([
    'ws',
    'express',
    'node',
    'lodash',
    'debug',
    'cors',
    'body-parser',
    'compression',
    'cookie-parser',
    'morgan',
    'multer',
    'cheerio',
    'glob'
]);

export async function generateLibPackageJson(
    libPath: string,
    libName: string,
    externalDeps?: string[]
): Promise<PackageJsonResult> {
    const packageJsonPath = path.join(libPath, 'package.json');

    try {
        // Read existing package.json if it exists to get dependency versions
        let existingDeps: Record<string, string> = {};
        let existingDevDeps: Record<string, string> = {};
        const rootPackageJson = path.resolve(libPath, '../../package.json');
        if (fs.existsSync(rootPackageJson)) {
            const rootPkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf-8'));
            existingDeps = {
                ...rootPkg.dependencies,
                ...rootPkg.devDependencies
            };
            existingDevDeps = rootPkg.devDependencies || {};
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
        const devDependencies: Record<string, string> = {
            typescript: '^5.0.0',
            '@types/node': '^20.0.0'
        };

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
            
            // Add @types package if needed
            const baseDep = dep.startsWith('@') ? dep : dep.split('/')[0];
            if (PACKAGES_NEEDING_TYPES.has(baseDep)) {
                const typesPackage = `@types/${baseDep}`;
                const typesVersion = existingDevDeps[typesPackage] || existingDeps[typesPackage] || '*';
                devDependencies[typesPackage] = typesVersion;
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
            devDependencies
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
            lib: ['ES2023', 'DOM', 'DOM.Iterable', 'ScriptHost'],
            outDir: './dist',
            rootDir: './src',
            strict: true,  // Match source project strict mode
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            allowImportingTsExtensions: true,
            allowSyntheticDefaultImports: true,
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
