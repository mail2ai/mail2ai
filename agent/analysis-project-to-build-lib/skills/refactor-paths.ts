import type { Project as TsMorphProject, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface RefactorResult {
    modifiedFiles: string[];
    errors: Array<{ file: string; error: string }>;
}

export async function refactorImportPaths(
    libPath: string,
    customMappings?: Record<string, string>
): Promise<RefactorResult> {
    const result: RefactorResult = {
        modifiedFiles: [],
        errors: []
    };

    const srcPath = path.join(libPath, 'src');
    if (!fs.existsSync(srcPath)) {
        result.errors.push({ file: srcPath, error: 'Source directory not found' });
        return result;
    }

    // Dynamic import ts-morph
    const { Project } = await import('ts-morph');

    // Create a new ts-morph project for the migrated library
    const project = new Project({
        compilerOptions: {
            declaration: true,
            strict: true,
            esModuleInterop: true,
            moduleResolution: 2, // NodeJs
            target: 9, // ES2022
            module: 199 // NodeNext
        }
    });

    // Add all TypeScript files from the library
    project.addSourceFilesAtPaths(path.join(srcPath, '**/*.ts'));

    const allSourceFiles = project.getSourceFiles();
    const allFilePaths = new Set<string>(allSourceFiles.map((sf: SourceFile) => sf.getFilePath()));

    for (const sourceFile of allSourceFiles) {
        try {
            let modified = false;

            // Process import declarations
            for (const importDecl of sourceFile.getImportDeclarations()) {
                const moduleSpecifier = importDecl.getModuleSpecifierValue();

                // Skip external modules (node_modules)
                if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('@/')) {
                    continue;
                }

                // Check for path alias patterns (like @/...)
                if (moduleSpecifier.startsWith('@/')) {
                    // Convert alias to relative path
                    const aliasPath = moduleSpecifier.replace('@/', '');
                    const currentFileDir = path.dirname(sourceFile.getFilePath());
                    const targetPath = findMatchingFile(srcPath, aliasPath, allFilePaths);

                    if (targetPath) {
                        let relativePath = path.relative(currentFileDir, targetPath);
                        relativePath = relativePath.replace(/\\/g, '/');
                        if (!relativePath.startsWith('.')) {
                            relativePath = './' + relativePath;
                        }
                        // Remove .ts extension for imports
                        relativePath = relativePath.replace(/\.tsx?$/, '.js');

                        importDecl.setModuleSpecifier(relativePath);
                        modified = true;
                    }
                    continue;
                }

                // Handle relative imports - ensure they resolve correctly
                const resolvedSourceFile = importDecl.getModuleSpecifierSourceFile();
                if (resolvedSourceFile) {
                    // File exists and resolves, might just need extension update
                    const currentPath = importDecl.getModuleSpecifierValue();
                    if (!currentPath.endsWith('.js')) {
                        // Update to use .js extension for ESM compatibility
                        const newPath = currentPath + '.js';
                        importDecl.setModuleSpecifier(newPath);
                        modified = true;
                    }
                } else {
                    // Try to find the file and fix the path
                    const currentFileDir = path.dirname(sourceFile.getFilePath());
                    const possiblePaths = [
                        moduleSpecifier + '.ts',
                        moduleSpecifier + '/index.ts',
                        moduleSpecifier + '.tsx',
                        moduleSpecifier + '/index.tsx'
                    ];

                    for (const possiblePath of possiblePaths) {
                        const fullPath = path.resolve(currentFileDir, possiblePath);
                        if (allFilePaths.has(fullPath)) {
                            let relativePath = path.relative(currentFileDir, fullPath);
                            relativePath = relativePath.replace(/\\/g, '/');
                            if (!relativePath.startsWith('.')) {
                                relativePath = './' + relativePath;
                            }
                            relativePath = relativePath.replace(/\.tsx?$/, '.js');

                            importDecl.setModuleSpecifier(relativePath);
                            modified = true;
                            break;
                        }
                    }
                }
            }

            // Process export declarations with module specifiers
            for (const exportDecl of sourceFile.getExportDeclarations()) {
                const moduleSpecifier = exportDecl.getModuleSpecifierValue();
                if (!moduleSpecifier) continue;

                if (moduleSpecifier.startsWith('@/')) {
                    const aliasPath = moduleSpecifier.replace('@/', '');
                    const currentFileDir = path.dirname(sourceFile.getFilePath());
                    const targetPath = findMatchingFile(srcPath, aliasPath, allFilePaths);

                    if (targetPath) {
                        let relativePath = path.relative(currentFileDir, targetPath);
                        relativePath = relativePath.replace(/\\/g, '/');
                        if (!relativePath.startsWith('.')) {
                            relativePath = './' + relativePath;
                        }
                        relativePath = relativePath.replace(/\.tsx?$/, '.js');

                        exportDecl.setModuleSpecifier(relativePath);
                        modified = true;
                    }
                }
            }

            if (modified) {
                result.modifiedFiles.push(sourceFile.getFilePath());
            }

        } catch (error) {
            result.errors.push({
                file: sourceFile.getFilePath(),
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Save all changes
    await project.save();

    return result;
}

function findMatchingFile(srcPath: string, aliasPath: string, allFilePaths: Set<string>): string | null {
    const candidates = [
        path.join(srcPath, aliasPath + '.ts'),
        path.join(srcPath, aliasPath + '.tsx'),
        path.join(srcPath, aliasPath, 'index.ts'),
        path.join(srcPath, aliasPath, 'index.tsx')
    ];

    for (const candidate of candidates) {
        if (allFilePaths.has(candidate)) {
            return candidate;
        }
    }

    return null;
}
