import type { Project as TsMorphProject, SourceFile } from 'ts-morph';
import * as path from 'path';
import type { AnalysisInput, AnalysisResult, DependencyInfo, ImportInfo, ExportInfo, LibStructure, FileToMigrate } from '../types.js';

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

function analyzeSourceFile(sourceFile: SourceFile, projectRoot: string): DependencyInfo {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(projectRoot, filePath);

    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    // Analyze imports
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

function collectDependencies(sourceFile: SourceFile, projectRoot: string): void {
    const filePath = sourceFile.getFilePath();
    if (processedFiles.has(filePath)) return;

    processedFiles.add(filePath);

    const depInfo = analyzeSourceFile(sourceFile, projectRoot);
    internalDependencies.push(depInfo);

    const dependencies: string[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
        const dependencySourceFile = importDecl.getModuleSpecifierSourceFile();
        if (dependencySourceFile && !dependencySourceFile.isInNodeModules()) {
            const depPath = dependencySourceFile.getFilePath();
            dependencies.push(depPath);
            collectDependencies(dependencySourceFile, projectRoot);
        }
    }

    // Also check re-exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
        const exportedSourceFile = exportDecl.getModuleSpecifierSourceFile();
        if (exportedSourceFile && !exportedSourceFile.isInNodeModules()) {
            const depPath = exportedSourceFile.getFilePath();
            dependencies.push(depPath);
            collectDependencies(exportedSourceFile, projectRoot);
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

    const ProjectClass = await loadTsMorph();
    const tsConfigPath = path.join(input.projectPath, 'tsconfig.json');
    const project = new ProjectClass({ tsConfigFilePath: tsConfigPath });

    let entrySourceFiles: SourceFile[] = [];

    if (input.entryFiles && input.entryFiles.length > 0) {
        // Use explicitly specified entry files
        for (const entryFile of input.entryFiles) {
            const sf = project.getSourceFile(path.resolve(input.projectPath, entryFile));
            if (sf) entrySourceFiles.push(sf);
        }
    } else if (input.directories && input.directories.length > 0) {
        // Use files from specified directories only
        console.log('  Searching in directories:', input.directories);
        entrySourceFiles = findFilesInDirectories(project, input.projectPath, input.directories);
    } else {
        // Fall back to keyword-based search
        entrySourceFiles = findEntryPoints(project, input.projectPath, input.moduleDescription);
    }

    if (entrySourceFiles.length === 0) {
        throw new Error(`No entry points found for module: ${input.moduleDescription}`);
    }

    // Collect all dependencies starting from entry points
    for (const entrySf of entrySourceFiles) {
        collectDependencies(entrySf, input.projectPath);
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

    return {
        entryPoints: entrySourceFiles.map(sf => sf.getFilePath()),
        internalDependencies,
        externalDependencies: Array.from(externalDependencies),
        fileGraph,
        suggestedLibStructure
    };
}
