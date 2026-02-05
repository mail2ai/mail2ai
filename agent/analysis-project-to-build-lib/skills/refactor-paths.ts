import type { Project as TsMorphProject, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface RefactorResult {
    modifiedFiles: string[];
    unresolvedImports: Array<{ file: string; import: string }>;
    errors: Array<{ file: string; error: string }>;
}

export async function refactorImportPaths(
    libPath: string,
    customMappings?: Record<string, string>
): Promise<RefactorResult> {
    const result: RefactorResult = {
        modifiedFiles: [],
        unresolvedImports: [],
        errors: []
    };

    const srcPath = path.join(libPath, 'src');
    if (!fs.existsSync(srcPath)) {
        result.errors.push({ file: srcPath, error: 'Source directory not found' });
        return result;
    }

    // Check if stubs directory exists (for redirecting missing imports)
    const stubsPath = path.join(srcPath, 'stubs');
    const hasStubs = fs.existsSync(stubsPath);

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

    // Build a map of stub files for quick lookup
    const stubFiles = new Set<string>();
    if (hasStubs) {
        collectFiles(stubsPath, stubFiles);
    }

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

                // Handle relative imports that go outside the library (e.g., ../config/)
                if (moduleSpecifier.includes('../') && !moduleSpecifier.includes('../stubs/')) {
                    const currentFileDir = path.dirname(sourceFile.getFilePath());
                    const resolvedPath = path.resolve(currentFileDir, moduleSpecifier.replace(/\.js$/, '.ts'));
                    
                    // Check if the file doesn't exist in the library
                    if (!allFilePaths.has(resolvedPath) && !allFilePaths.has(resolvedPath.replace(/\.ts$/, '.tsx'))) {
                        // Try to redirect to stubs if available
                        if (hasStubs) {
                            const stubPath = findStubForImport(moduleSpecifier, stubsPath, stubFiles, currentFileDir);
                            if (stubPath) {
                                let relativePath = path.relative(currentFileDir, stubPath);
                                relativePath = relativePath.replace(/\\/g, '/');
                                if (!relativePath.startsWith('.')) {
                                    relativePath = './' + relativePath;
                                }
                                relativePath = relativePath.replace(/\.tsx?$/, '.js');
                                importDecl.setModuleSpecifier(relativePath);
                                modified = true;
                                continue;
                            }
                        }
                        
                        // Track unresolved import
                        result.unresolvedImports.push({
                            file: sourceFile.getFilePath(),
                            import: moduleSpecifier
                        });
                    }
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

                    let found = false;
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
                            found = true;
                            break;
                        }
                    }
                    
                    // If still not found, add to unresolved
                    if (!found && !result.unresolvedImports.some(u => u.file === sourceFile.getFilePath() && u.import === moduleSpecifier)) {
                        result.unresolvedImports.push({
                            file: sourceFile.getFilePath(),
                            import: moduleSpecifier
                        });
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

    // Log unresolved imports
    if (result.unresolvedImports.length > 0) {
        console.log(`  ⚠️ ${result.unresolvedImports.length} unresolved import(s):`);
        const byImport = new Map<string, string[]>();
        for (const u of result.unresolvedImports) {
            if (!byImport.has(u.import)) {
                byImport.set(u.import, []);
            }
            byImport.get(u.import)!.push(path.basename(u.file));
        }
        for (const [imp, files] of byImport.entries()) {
            console.log(`      ${imp} (${files.length} file${files.length > 1 ? 's' : ''})`);
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

/**
 * Collect all file paths in a directory recursively.
 */
function collectFiles(dir: string, files: Set<string>): void {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                collectFiles(fullPath, files);
            } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
                files.add(fullPath);
            }
        }
    } catch {
        // Ignore errors
    }
}

/**
 * Find a stub file that corresponds to a missing import.
 */
function findStubForImport(
    importSpec: string,
    stubsPath: string,
    stubFiles: Set<string>,
    currentFileDir: string
): string | null {
    // Extract the path from the import specifier
    // e.g., ../config/config.js -> config/config
    // e.g., ../../media/store.js -> media/store
    let cleanImport = importSpec
        .replace(/\.js$/, ''); // Remove .js extension
    
    // Remove all leading ../ or ./
    while (cleanImport.startsWith('../') || cleanImport.startsWith('./')) {
        cleanImport = cleanImport.replace(/^\.\.?\//, '');
    }
    
    // Look for matching stub - try multiple patterns
    const candidates = [
        path.join(stubsPath, cleanImport + '.ts'),
        path.join(stubsPath, cleanImport + '/index.ts'),
        // Also try with 'src/' prefix removed if it's there
        path.join(stubsPath, cleanImport.replace(/^src\//, '') + '.ts'),
        path.join(stubsPath, cleanImport.replace(/^src\//, '') + '/index.ts'),
        // Try adding 'src/' directory for top-level imports
        path.join(stubsPath, 'src', cleanImport + '.ts')
    ];
    
    for (const candidate of candidates) {
        if (stubFiles.has(candidate)) {
            return candidate;
        }
    }
    
    return null;
}
