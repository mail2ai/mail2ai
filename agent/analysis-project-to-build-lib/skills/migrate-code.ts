import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisResult } from '../types.js';

interface MigrationProgress {
    copiedFiles: string[];
    errors: Array<{ file: string; error: string }>;
}

async function ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

async function copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await ensureDir(path.dirname(targetPath));
    await fs.promises.copyFile(sourcePath, targetPath);
}

export async function extractAndMigrateCode(
    analysisResult: AnalysisResult,
    outputPath: string
): Promise<MigrationProgress> {
    const progress: MigrationProgress = {
        copiedFiles: [],
        errors: []
    };

    const srcDir = path.join(outputPath, 'src');
    await ensureDir(srcDir);

    for (const file of analysisResult.suggestedLibStructure.files) {
        try {
            // Check if source file exists
            if (!fs.existsSync(file.sourcePath)) {
                progress.errors.push({
                    file: file.sourcePath,
                    error: 'Source file not found'
                });
                continue;
            }

            await copyFile(file.sourcePath, file.targetPath);
            progress.copiedFiles.push(file.targetPath);

        } catch (error) {
            progress.errors.push({
                file: file.sourcePath,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Create a main index.ts that re-exports from entry points
    const indexContent = generateIndexFile(analysisResult);
    const indexPath = path.join(srcDir, 'index.ts');
    await fs.promises.writeFile(indexPath, indexContent, 'utf-8');
    progress.copiedFiles.push(indexPath);

    return progress;
}

function generateIndexFile(analysisResult: AnalysisResult): string {
    const lines: string[] = [
        '// Auto-generated index file',
        '// Re-exports all public APIs from the extracted library',
        ''
    ];

    // Build a map of export names to their source files to detect conflicts
    // Use Set to avoid duplicate sources for the same export name
    const exportNameToSources = new Map<string, Set<string>>();
    const fileToExports = new Map<string, string[]>();

    for (const dep of analysisResult.internalDependencies) {
        if (dep.exports.length > 0) {
            // Get the relative path from the src directory
            let exportPath = dep.relativePath.replace(/\.tsx?$/, '.js').replace(/\\/g, '/');
            
            // If path starts with 'src/', keep just the part after src/
            // since index.ts is in the src/ directory
            if (exportPath.startsWith('src/')) {
                exportPath = './' + exportPath.slice(4); // Remove 'src/' prefix
            } else if (!exportPath.startsWith('./') && !exportPath.startsWith('../')) {
                exportPath = './' + exportPath;
            }
            
            // Extract export names from ExportInfo[] and deduplicate
            const exportNames = [...new Set(dep.exports.map(e => e.name))];
            
            // Only add if not already processed for this file
            if (!fileToExports.has(exportPath)) {
                fileToExports.set(exportPath, exportNames);
            }
            
            for (const exportName of exportNames) {
                if (!exportNameToSources.has(exportName)) {
                    exportNameToSources.set(exportName, new Set());
                }
                exportNameToSources.get(exportName)!.add(exportPath);
            }
        }
    }

    // Find conflicting exports (same name from multiple DIFFERENT files)
    const conflictingNames = new Set<string>();
    for (const [name, sources] of exportNameToSources.entries()) {
        if (sources.size > 1) {
            conflictingNames.add(name);
        }
    }

    // Track which files have conflicts
    const filesWithConflicts = new Set<string>();
    for (const name of conflictingNames) {
        const sources = exportNameToSources.get(name) || [];
        for (const source of sources) {
            filesWithConflicts.add(source);
        }
    }

    // Generate exports
    const exportedPaths = new Set<string>();
    
    for (const [filePath, exports] of fileToExports.entries()) {
        if (exportedPaths.has(filePath)) continue;
        exportedPaths.add(filePath);
        
        if (filesWithConflicts.has(filePath)) {
            // For files with conflicts, use named exports to avoid ambiguity
            const nonConflictingExports = [...new Set(exports.filter(e => !conflictingNames.has(e)))];
            const conflictExports = [...new Set(exports.filter(e => conflictingNames.has(e)))];
            
            // Export non-conflicting names directly
            if (nonConflictingExports.length > 0) {
                lines.push(`export { ${nonConflictingExports.join(', ')} } from '${filePath}';`);
            }
            
            // For conflicting exports, use aliased exports with file-based prefix
            if (conflictExports.length > 0) {
                // Create a prefix from the file path (e.g., "browser_client" from "./src/browser/client.js")
                const prefix = filePath
                    .replace(/^\.\//, '')
                    .replace(/\.(js|ts)$/, '')
                    .replace(/[\/\-\.]/g, '_');
                
                const aliasedExports = conflictExports.map(e => `${e} as ${prefix}_${e}`);
                lines.push(`export { ${aliasedExports.join(', ')} } from '${filePath}';`);
            }
        } else {
            // No conflicts, use star export
            lines.push(`export * from '${filePath}';`);
        }
    }

    // Add a comment about conflicting exports if any
    if (conflictingNames.size > 0) {
        lines.unshift('');
        lines.unshift(`// Note: ${conflictingNames.size} export names had conflicts and were aliased with file prefixes`);
    }

    return lines.join('\n');
}
