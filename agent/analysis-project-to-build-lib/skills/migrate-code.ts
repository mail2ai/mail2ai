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

    // Get unique directories from entry points
    const exportedPaths = new Set<string>();

    for (const dep of analysisResult.internalDependencies) {
        // Only export from files that have exports
        if (dep.exports.length > 0) {
            const relativePath = './' + dep.relativePath.replace(/\.tsx?$/, '').replace(/\\/g, '/');
            if (!exportedPaths.has(relativePath)) {
                exportedPaths.add(relativePath);
                lines.push(`export * from '${relativePath}';`);
            }
        }
    }

    return lines.join('\n');
}
