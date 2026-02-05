import type { Project as TsMorphProject, SourceFile } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import type { AnalysisInput, AnalysisResult, DependencyInfo, ImportInfo, ExportInfo, LibStructure, FileToMigrate, MissingDependency } from '../types.js';

// Dynamic import for ts-morph
let Project: typeof TsMorphProject;

async function loadTsMorph() {
    if (!Project) {
        const tsMorph = await import('ts-morph');
        Project = tsMorph.Project;
    }
    return Project;
}

const processedFiles = new Set<string>();
const internalDependencies: DependencyInfo[] = [];
const externalDependencies = new Set<string>();
const fileGraph = new Map<string, string[]>();
// Track missing dependencies (files referenced but not included due to focus restrictions)
const missingDependencies = new Map<string, MissingDependency>();

function analyzeSourceFile(sourceFile: SourceFile, projectRoot: string): DependencyInfo {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(projectRoot, filePath);

    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    // Analyze static imports
    for (const importDecl of sourceFile.getImportDeclarations()) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const dependencySourceFile = importDecl.getModuleSpecifierSourceFile();
        const isExternal = !dependencySourceFile || dependencySourceFile.isInNodeModules();

        const namedImports = importDecl.getNamedImports().map((ni: { getName: () => string }) => ni.getName());
        const defaultImport = importDecl.getDefaultImport()?.getText();

        if (isExternal && !moduleSpecifier.startsWith('.')) {
            // Extract package name from module specifier
            const pkgName = moduleSpecifier.startsWith('@')
                ? moduleSpecifier.split('/').slice(0, 2).join('/')
                : moduleSpecifier.split('/')[0];
            externalDependencies.add(pkgName);
        }

        imports.push({
            moduleSpecifier,
            namedImports,
            defaultImport,
            isExternal,
            resolvedPath: dependencySourceFile?.getFilePath()
        });
    }

    // Analyze dynamic imports: import("./path") or import('./path')
    const sourceText = sourceFile.getFullText();
    const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let match;
    while ((match = dynamicImportRegex.exec(sourceText)) !== null) {
        const moduleSpecifier = match[1];
        
        // Only track relative dynamic imports (local files)
        if (moduleSpecifier.startsWith('.')) {
            // Resolve the path
            const currentDir = path.dirname(filePath);
            const resolvedPath = path.resolve(currentDir, moduleSpecifier.replace(/\.js$/, '.ts'));
            
            // Check if not already in imports list
            const exists = imports.some(i => i.moduleSpecifier === moduleSpecifier);
            if (!exists) {
                imports.push({
                    moduleSpecifier,
                    namedImports: [],
                    defaultImport: undefined,
                    isExternal: false,
                    resolvedPath: resolvedPath
                });
            }
        }
    }

    // Analyze exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
        const namedExports = exportDecl.getNamedExports();
        for (const namedExport of namedExports) {
            exports.push({
                name: namedExport.getName(),
                kind: 'variable',
                isReExport: true
            });
        }
    }

    // Analyze exported declarations
    for (const func of sourceFile.getFunctions()) {
        if (func.isExported()) {
            exports.push({
                name: func.getName() || 'default',
                kind: func.isDefaultExport() ? 'default' : 'function',
                isReExport: false
            });
        }
    }

    for (const cls of sourceFile.getClasses()) {
        if (cls.isExported()) {
            exports.push({
                name: cls.getName() || 'default',
                kind: cls.isDefaultExport() ? 'default' : 'class',
                isReExport: false
            });
        }
    }

    for (const iface of sourceFile.getInterfaces()) {
        if (iface.isExported()) {
            exports.push({
                name: iface.getName(),
                kind: 'interface',
                isReExport: false
            });
        }
    }

    for (const typeAlias of sourceFile.getTypeAliases()) {
        if (typeAlias.isExported()) {
            exports.push({
                name: typeAlias.getName(),
                kind: 'type',
                isReExport: false
            });
        }
    }

    return {
        filePath,
        relativePath,
        imports,
        exports,
        isInternal: true
    };
}

function collectDependencies(sourceFile: SourceFile, projectRoot: string, focusDirs?: string[], maxDepth?: number, currentDepth: number = 0): void {
    const filePath = sourceFile.getFilePath();
    if (processedFiles.has(filePath)) return;

    // Check if we've exceeded max depth
    if (maxDepth !== undefined && currentDepth > maxDepth) {
        return;
    }

    processedFiles.add(filePath);

    const depInfo = analyzeSourceFile(sourceFile, projectRoot);
    internalDependencies.push(depInfo);

    const dependencies: string[] = [];
    
    // Current file's relative path for tracking references
    const currentRelPath = path.relative(projectRoot, filePath);

    // Helper to check if a path is within focus directories
    const isInFocusDirs = (depFilePath: string): boolean => {
        if (!focusDirs || focusDirs.length === 0) return true;
        
        const relPath = path.relative(projectRoot, depFilePath).replace(/\\/g, '/').toLowerCase();
        return focusDirs.some(dir => {
            const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
            return relPath.startsWith(normalizedDir + '/') || relPath === normalizedDir;
        });
    };

    for (const importDecl of sourceFile.getImportDeclarations()) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const dependencySourceFile = importDecl.getModuleSpecifierSourceFile();
        if (dependencySourceFile && !dependencySourceFile.isInNodeModules()) {
            const depPath = dependencySourceFile.getFilePath();
            dependencies.push(depPath);
            
            // Only traverse into dependency if it's in focus directories
            if (isInFocusDirs(depPath)) {
                collectDependencies(dependencySourceFile, projectRoot, focusDirs, maxDepth, currentDepth + 1);
            } else {
                // Track this as a missing dependency
                const relPath = path.relative(projectRoot, depPath).replace(/\\/g, '/');
                const directory = path.dirname(relPath);
                
                if (missingDependencies.has(depPath)) {
                    const existing = missingDependencies.get(depPath)!;
                    if (!existing.referencedBy.includes(currentRelPath)) {
                        existing.referencedBy.push(currentRelPath);
                    }
                    if (!existing.importSpecifiers.includes(moduleSpecifier)) {
                        existing.importSpecifiers.push(moduleSpecifier);
                    }
                } else {
                    missingDependencies.set(depPath, {
                        filePath: depPath,
                        relativePath: relPath,
                        directory,
                        referencedBy: [currentRelPath],
                        importSpecifiers: [moduleSpecifier]
                    });
                }
            }
        }
    }

    // Also check re-exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
        const moduleSpecifier = exportDecl.getModuleSpecifierValue() || '';
        const exportedSourceFile = exportDecl.getModuleSpecifierSourceFile();
        if (exportedSourceFile && !exportedSourceFile.isInNodeModules()) {
            const depPath = exportedSourceFile.getFilePath();
            dependencies.push(depPath);
            
            // Only traverse into dependency if it's in focus directories
            if (isInFocusDirs(depPath)) {
                collectDependencies(exportedSourceFile, projectRoot, focusDirs, maxDepth, currentDepth + 1);
            } else {
                // Track this as a missing dependency
                const relPath = path.relative(projectRoot, depPath).replace(/\\/g, '/');
                const directory = path.dirname(relPath);
                
                if (missingDependencies.has(depPath)) {
                    const existing = missingDependencies.get(depPath)!;
                    if (!existing.referencedBy.includes(currentRelPath)) {
                        existing.referencedBy.push(currentRelPath);
                    }
                    if (moduleSpecifier && !existing.importSpecifiers.includes(moduleSpecifier)) {
                        existing.importSpecifiers.push(moduleSpecifier);
                    }
                } else {
                    missingDependencies.set(depPath, {
                        filePath: depPath,
                        relativePath: relPath,
                        directory,
                        referencedBy: [currentRelPath],
                        importSpecifiers: moduleSpecifier ? [moduleSpecifier] : []
                    });
                }
            }
        }
    }

    // Also handle dynamic imports from depInfo.imports
    // These were captured by the regex in analyzeSourceFile
    for (const importInfo of depInfo.imports) {
        if (importInfo.resolvedPath && !importInfo.isExternal) {
            const depPath = importInfo.resolvedPath;
            // Skip if already processed through static imports
            if (dependencies.includes(depPath)) continue;
            
            // Check if file exists
            if (!fs.existsSync(depPath)) continue;
            
            dependencies.push(depPath);
            
            if (isInFocusDirs(depPath)) {
                // Load the source file and traverse
                const project = sourceFile.getProject();
                let depSourceFile = project.getSourceFile(depPath);
                if (!depSourceFile) {
                    try {
                        depSourceFile = project.addSourceFileAtPath(depPath);
                    } catch {
                        // File might not exist
                        continue;
                    }
                }
                if (depSourceFile && !depSourceFile.isInNodeModules()) {
                    collectDependencies(depSourceFile, projectRoot, focusDirs, maxDepth, currentDepth + 1);
                }
            } else {
                // Track as missing dependency
                const relPath = path.relative(projectRoot, depPath).replace(/\\/g, '/');
                const directory = path.dirname(relPath);
                
                if (missingDependencies.has(depPath)) {
                    const existing = missingDependencies.get(depPath)!;
                    if (!existing.referencedBy.includes(currentRelPath)) {
                        existing.referencedBy.push(currentRelPath);
                    }
                    if (!existing.importSpecifiers.includes(importInfo.moduleSpecifier)) {
                        existing.importSpecifiers.push(importInfo.moduleSpecifier);
                    }
                } else {
                    missingDependencies.set(depPath, {
                        filePath: depPath,
                        relativePath: relPath,
                        directory,
                        referencedBy: [currentRelPath],
                        importSpecifiers: [importInfo.moduleSpecifier]
                    });
                }
            }
        }
    }

    fileGraph.set(filePath, dependencies);
}

/**
 * Find all TypeScript files in the specified directories.
 * This provides more precise control over which files to extract.
 */
function findFilesInDirectories(
    project: InstanceType<typeof TsMorphProject>,
    projectRoot: string,
    directories: string[]
): SourceFile[] {
    const sourceFiles = project.getSourceFiles();
    const entryPoints: SourceFile[] = [];

    // Normalize directory paths
    const normalizedDirs = directories.map(dir => {
        const normalized = dir.replace(/\\/g, '/').toLowerCase();
        // Remove trailing slash
        return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    });

    console.log('  Normalized directories:', normalizedDirs);

    for (const sf of sourceFiles) {
        if (sf.isInNodeModules()) continue;

        const relativePath = path.relative(projectRoot, sf.getFilePath())
            .replace(/\\/g, '/')
            .toLowerCase();

        // Check if file is in any of the specified directories
        const isInDirectory = normalizedDirs.some(dir => 
            relativePath.startsWith(dir + '/') || relativePath === dir
        );

        if (isInDirectory) {
            entryPoints.push(sf);
        }
    }

    console.log(`  Found ${entryPoints.length} files in specified directories`);
    return entryPoints;
}

function findEntryPoints(project: InstanceType<typeof TsMorphProject>, projectRoot: string, moduleDescription: string): SourceFile[] {
    const sourceFiles = project.getSourceFiles();
    const entryPoints: SourceFile[] = [];

    // Extract path patterns from description (e.g., "src/browser", "assets/chrome-extension")
    const pathPatterns: string[] = [];
    
    // Match path-like patterns in the description
    const pathRegex = /(?:projects\/\w+\/)?([a-zA-Z0-9_\-\/]+)/g;
    let match;
    while ((match = pathRegex.exec(moduleDescription)) !== null) {
        const potentialPath = match[1];
        // Only include if it looks like a directory path (has / or common dir names)
        if (potentialPath.includes('/') || 
            ['src', 'assets', 'lib', 'browser', 'extension'].some(d => potentialPath.includes(d))) {
            pathPatterns.push(potentialPath.toLowerCase());
        }
    }

    // Keywords from module description (split on spaces, commas, and Chinese punctuation)
    const keywords = moduleDescription
        .toLowerCase()
        .split(/[\s,，、。：:]+/)
        .filter((w: string) => w.length > 2 && !/^[一-龟]+$/.test(w)) // Filter out pure Chinese
        .map((w: string) => w.replace(/['"]/g, ''));

    // Add common variations
    const additionalKeywords = keywords.flatMap(kw => {
        const parts = kw.split(/[-_\/]/);
        return parts.length > 1 ? parts : [];
    });
    keywords.push(...additionalKeywords);

    console.log('  Path patterns:', pathPatterns);
    console.log('  Keywords:', keywords.slice(0, 10), keywords.length > 10 ? '...' : '');

    for (const sf of sourceFiles) {
        if (sf.isInNodeModules()) continue;

        const filePath = sf.getFilePath().toLowerCase();
        const relativePath = path.relative(projectRoot, sf.getFilePath()).toLowerCase();
        const fileName = path.basename(filePath, path.extname(filePath));

        // Check if file path matches any path pattern
        const matchesPathPattern = pathPatterns.some(pattern => 
            relativePath.includes(pattern) || filePath.includes(pattern)
        );

        // Check if file name matches keywords
        const matchesKeyword = keywords.some(kw =>
            fileName.includes(kw) || relativePath.includes(kw)
        );

        // Check if it's an index file in a relevant directory
        const isRelevantIndex = fileName === 'index' && (
            pathPatterns.some(pattern => path.dirname(relativePath).includes(pattern)) ||
            keywords.some(kw => path.dirname(relativePath).includes(kw))
        );

        if (matchesPathPattern || matchesKeyword || isRelevantIndex) {
            entryPoints.push(sf);
        }
    }

    return entryPoints;
}

export async function analyzeProjectDependencies(input: AnalysisInput): Promise<AnalysisResult> {
    // Reset state
    processedFiles.clear();
    internalDependencies.length = 0;
    externalDependencies.clear();
    fileGraph.clear();
    missingDependencies.clear();

    const ProjectClass = await loadTsMorph();
    const tsConfigPath = path.join(input.projectPath, 'tsconfig.json');
    const project = new ProjectClass({ tsConfigFilePath: tsConfigPath });

    let entrySourceFiles: SourceFile[] = [];

    // Priority 1: Use explicitly specified entry files (preferred, most precise)
    if (input.entryFiles && input.entryFiles.length > 0) {
        console.log('  📍 Using entry files (precise mode):', input.entryFiles);
        for (const entryFile of input.entryFiles) {
            // Clean up the entry file path - remove project prefix if present
            const cleanedPath = entryFile.replace(/^projects\/\w+\//, '');
            const fullPath = path.resolve(input.projectPath, cleanedPath);
            console.log(`    Looking for: ${fullPath}`);
            
            let sf = project.getSourceFile(fullPath);
            if (!sf) {
                // Try adding the file if it exists
                try {
                    const fs = await import('fs');
                    if (fs.existsSync(fullPath)) {
                        sf = project.addSourceFileAtPath(fullPath);
                    }
                } catch {
                    console.log(`    ⚠️ Could not load: ${fullPath}`);
                }
            }
            if (sf) {
                console.log(`    ✓ Found: ${sf.getFilePath()}`);
                entrySourceFiles.push(sf);
            }
        }
        
        if (entrySourceFiles.length === 0) {
            console.log('  ⚠️ No entry files found, falling back to directory/keyword search');
        }
    }
    
    // Priority 2: Use files from specified directories (less precise)
    if (entrySourceFiles.length === 0 && input.directories && input.directories.length > 0) {
        console.log('  📂 Searching in directories:', input.directories);
        entrySourceFiles = findFilesInDirectories(project, input.projectPath, input.directories);
    }
    
    // Priority 3: Fall back to keyword-based search (least precise)
    if (entrySourceFiles.length === 0) {
        console.log('  🔍 Falling back to keyword-based search');
        entrySourceFiles = findEntryPoints(project, input.projectPath, input.moduleDescription);
    }

    if (entrySourceFiles.length === 0) {
        throw new Error(`No entry points found for module: ${input.moduleDescription}`);
    }
    
    console.log(`  📊 Found ${entrySourceFiles.length} entry point(s)`);
    for (const sf of entrySourceFiles.slice(0, 5)) {
        console.log(`    - ${path.relative(input.projectPath, sf.getFilePath())}`);
    }
    if (entrySourceFiles.length > 5) {
        console.log(`    ... and ${entrySourceFiles.length - 5} more`);
    }

    // Determine focus directories for limiting dependency traversal
    let focusDirs = input.focusDirectories;
    if (!focusDirs && input.entryFiles && input.entryFiles.length > 0) {
        // Auto-detect focus directories from entry files
        focusDirs = input.entryFiles.map(ef => {
            const cleanedPath = ef.replace(/^projects\/\w+\//, '');
            // Extract directory from file path (e.g., src/browser/server.ts -> src/browser)
            const dir = path.dirname(cleanedPath);
            return dir;
        }).filter((v, i, a) => a.indexOf(v) === i); // unique
        console.log(`  📁 Auto-detected focus directories: ${focusDirs.join(', ')}`);
    }

    // Collect all dependencies starting from entry points
    // Use maxDepth to limit traversal (default: unlimited for backward compatibility)
    const maxDepth = input.maxDepth;
    if (maxDepth !== undefined) {
        console.log(`  ⚙️ Using max depth: ${maxDepth}`);
    }
    if (focusDirs && focusDirs.length > 0) {
        console.log(`  📂 Limiting extraction to directories: ${focusDirs.join(', ')}`);
    }
    
    for (const entrySf of entrySourceFiles) {
        collectDependencies(entrySf, input.projectPath, focusDirs, maxDepth, 0);
    }

    // Build library structure
    const libName = input.outputLibName || `lib-${Date.now()}`;
    const outputPath = path.resolve(input.projectPath, '..', 'libs', libName);

    const filesToMigrate: FileToMigrate[] = internalDependencies.map(dep => {
        // Normalize the relative path - if it starts with 'src/', keep it as is
        // Otherwise, prepend 'src/' to organize the output
        let targetRelativePath = dep.relativePath;
        
        // If the relative path starts with 'src/', we don't add another 'src/' prefix
        // to avoid nested src/src/ directories
        if (targetRelativePath.startsWith('src/') || targetRelativePath.startsWith('src\\')) {
            return {
                sourcePath: dep.filePath,
                targetPath: path.join(outputPath, targetRelativePath),
                pathMappings: []
            };
        }
        
        // For paths outside of src/, place them under src/
        return {
            sourcePath: dep.filePath,
            targetPath: path.join(outputPath, 'src', targetRelativePath),
            pathMappings: []
        };
    });

    const suggestedLibStructure: LibStructure = {
        name: libName,
        outputPath,
        files: filesToMigrate,
        packageJson: {
            name: libName,
            version: '1.0.0',
            main: './dist/index.js',
            types: './dist/index.d.ts',
            dependencies: {},
            peerDependencies: {}
        }
    };

    // Add external dependencies to package.json
    for (const extDep of externalDependencies) {
        suggestedLibStructure.packageJson.dependencies[extDep] = '*';
    }

    // Report missing dependencies
    const missingDeps = Array.from(missingDependencies.values());
    if (missingDeps.length > 0) {
        console.log(`\n  ⚠️ Missing Dependencies Report:`);
        console.log(`  Found ${missingDeps.length} files referenced but not included due to focus restrictions:\n`);
        
        // Group by directory
        const byDirectory = new Map<string, typeof missingDeps>();
        for (const dep of missingDeps) {
            const dir = dep.directory;
            if (!byDirectory.has(dir)) {
                byDirectory.set(dir, []);
            }
            byDirectory.get(dir)!.push(dep);
        }
        
        // Report grouped by directory
        for (const [dir, deps] of byDirectory.entries()) {
            const refCount = deps.reduce((sum, d) => sum + d.referencedBy.length, 0);
            console.log(`  📁 ${dir}/ (${deps.length} files, ${refCount} references)`);
            for (const dep of deps.slice(0, 3)) {
                console.log(`      - ${path.basename(dep.relativePath)} (from ${dep.referencedBy.length} file${dep.referencedBy.length > 1 ? 's' : ''})`);
            }
            if (deps.length > 3) {
                console.log(`      ... and ${deps.length - 3} more`);
            }
        }
        
        // Suggest fix
        console.log(`\n  💡 To include these dependencies, add focus directories:`);
        const suggestedDirs = Array.from(byDirectory.keys()).map(d => `-f "${d}"`).join(' ');
        console.log(`     ${suggestedDirs}`);
        console.log(`     Or use --include-deps to automatically include all required files\n`);
    }

    return {
        entryPoints: entrySourceFiles.map(sf => sf.getFilePath()),
        internalDependencies,
        externalDependencies: Array.from(externalDependencies),
        missingDependencies: missingDeps,
        fileGraph,
        suggestedLibStructure
    };
}
