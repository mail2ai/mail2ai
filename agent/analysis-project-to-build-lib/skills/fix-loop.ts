/**
 * Iterative Fix Loop Skill (v3.0)
 * 
 * Implements the closed-loop error fixing cycle:
 * 1. Run build/tests
 * 2. Analyze errors
 * 3. Apply fix strategy (import file, generate stub, refactor path)
 * 4. Re-run build/tests
 * 5. Repeat until resolved or max iterations
 * 
 * Part of the Design-Driven Closed-Loop Refactoring architecture.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { 
    MigrationError, 
    AnalysisResult,
    FixAttempt,
    FixLoopResult,
    TraceLog
} from '../types.js';

/**
 * Error pattern analysis result.
 */
interface ErrorAnalysis {
    type: 'module-not-found' | 'type-error' | 'syntax-error' | 'import-error' | 'unknown';
    module?: string;
    file?: string;
    line?: number;
    suggestedFix: 'add-import' | 'generate-stub' | 'refactor-path' | 'add-file' | 'manual';
    details: string;
}

/**
 * Run the iterative fix loop.
 */
export async function runFixLoop(
    outputPath: string,
    analysisResult: AnalysisResult,
    projectPath: string,
    traceLog: TraceLog | null,
    options: {
        maxIterations?: number;
        autoFixMode?: 'import' | 'stub' | 'both';
        verbose?: boolean;
    } = {}
): Promise<FixLoopResult> {
    const maxIterations = options.maxIterations || 10;
    const autoFixMode = options.autoFixMode || 'both';
    const verbose = options.verbose ?? true;
    
    const attempts: FixAttempt[] = [];
    const addedFiles: string[] = [];
    const generatedStubs: string[] = [];
    let iteration = 0;
    let remainingErrors: MigrationError[] = [];
    
    while (iteration < maxIterations) {
        iteration++;
        
        if (verbose) {
            console.log(`\n[FixLoop] Iteration ${iteration}/${maxIterations}`);
        }
        
        // Run build and collect errors
        const errors = await runBuildAndCollectErrors(outputPath);
        
        if (errors.length === 0) {
            if (verbose) {
                console.log(`[FixLoop] ✅ No errors, build successful!`);
            }
            break;
        }
        
        if (verbose) {
            console.log(`[FixLoop] Found ${errors.length} error(s)`);
        }
        
        // Analyze first error
        const error = errors[0];
        const analysis = analyzeError(error);
        
        if (verbose) {
            console.log(`[FixLoop] Error type: ${analysis.type}`);
            console.log(`[FixLoop] Suggested fix: ${analysis.suggestedFix}`);
        }
        
        // Check if this fix was already tried
        const prevAttempt = attempts.find(a => 
            a.error.file === error.file && 
            a.error.error === error.error &&
            a.strategy === analysis.suggestedFix
        );
        
        if (prevAttempt && !prevAttempt.success) {
            if (verbose) {
                console.log(`[FixLoop] ⚠️ Already tried this fix, trying alternative...`);
            }
            // Try alternative fix
            analysis.suggestedFix = getAlternativeFix(analysis.suggestedFix);
        }
        
        // Apply fix
        let success = false;
        let fixAction = '';
        
        try {
            switch (analysis.suggestedFix) {
                case 'add-file':
                    if (autoFixMode === 'import' || autoFixMode === 'both') {
                        const result = await tryAddMissingFile(
                            analysis.module!,
                            outputPath,
                            projectPath,
                            analysisResult
                        );
                        success = result.success;
                        fixAction = result.action;
                        if (result.addedFile) {
                            addedFiles.push(result.addedFile);
                        }
                    }
                    break;
                    
                case 'generate-stub':
                    if (autoFixMode === 'stub' || autoFixMode === 'both') {
                        const result = await tryGenerateStub(
                            analysis.module!,
                            outputPath,
                            traceLog
                        );
                        success = result.success;
                        fixAction = result.action;
                        if (result.stubFile) {
                            generatedStubs.push(result.stubFile);
                        }
                    }
                    break;
                    
                case 'refactor-path':
                    const result = await tryRefactorPath(
                        error.file,
                        analysis.module!,
                        outputPath
                    );
                    success = result.success;
                    fixAction = result.action;
                    break;
                    
                case 'manual':
                    fixAction = 'Requires manual intervention';
                    break;
            }
        } catch (e) {
            fixAction = `Fix failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        
        // Record attempt
        attempts.push({
            iteration,
            error,
            strategy: analysis.suggestedFix,
            action: fixAction,
            success
        });
        
        if (verbose) {
            console.log(`[FixLoop] ${success ? '✅' : '❌'} ${fixAction}`);
        }
        
        // If no progress, break to avoid infinite loop
        if (!success && analysis.suggestedFix === 'manual') {
            remainingErrors = errors;
            break;
        }
        
        remainingErrors = errors.slice(1);
    }
    
    // Final build check
    const finalErrors = await runBuildAndCollectErrors(outputPath);
    
    return {
        allResolved: finalErrors.length === 0,
        iterations: iteration,
        attempts,
        remainingErrors: finalErrors,
        addedFiles,
        generatedStubs
    };
}

/**
 * Run build and collect errors.
 */
async function runBuildAndCollectErrors(outputPath: string): Promise<MigrationError[]> {
    const errors: MigrationError[] = [];
    
    try {
        // Run TypeScript compiler
        execSync('npx tsc --noEmit 2>&1', {
            cwd: outputPath,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024
        });
    } catch (e) {
        const output = e instanceof Error && 'stdout' in e 
            ? (e as { stdout: string }).stdout 
            : String(e);
        
        // Parse TypeScript errors
        const errorLines = output.split('\n');
        for (const line of errorLines) {
            const match = line.match(/^(.+\.tsx?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)/);
            if (match) {
                errors.push({
                    file: match[1],
                    error: `${match[4]}: ${match[5]}`,
                    phase: 'build'
                });
            }
            
            // Also catch "Cannot find module" errors
            const moduleMatch = line.match(/Cannot find module ['"]([^'"]+)['"]/);
            if (moduleMatch) {
                errors.push({
                    file: '',
                    error: `Cannot find module '${moduleMatch[1]}'`,
                    phase: 'build'
                });
            }
        }
    }
    
    return errors;
}

/**
 * Analyze error to determine fix strategy.
 */
function analyzeError(error: MigrationError): ErrorAnalysis {
    const msg = error.error;
    
    // Cannot find module
    if (msg.includes('Cannot find module') || msg.includes('TS2307')) {
        const moduleMatch = msg.match(/['"]([^'"]+)['"]/);
        const module = moduleMatch ? moduleMatch[1] : '';
        
        // Determine if it's an internal or external module
        if (module.startsWith('.') || module.startsWith('@/') || module.startsWith('../')) {
            // Internal module - try to add file
            return {
                type: 'module-not-found',
                module,
                file: error.file,
                suggestedFix: 'add-file',
                details: `Missing internal module: ${module}`
            };
        } else {
            // External module - generate stub
            return {
                type: 'module-not-found',
                module,
                file: error.file,
                suggestedFix: 'generate-stub',
                details: `Missing external module: ${module}`
            };
        }
    }
    
    // Type errors
    if (msg.includes('TS2339') || msg.includes('TS2345') || msg.includes('TS2322')) {
        return {
            type: 'type-error',
            file: error.file,
            suggestedFix: 'manual',
            details: `Type error: ${msg}`
        };
    }
    
    // Syntax errors
    if (msg.includes('TS1005') || msg.includes('TS1003')) {
        return {
            type: 'syntax-error',
            file: error.file,
            suggestedFix: 'manual',
            details: `Syntax error: ${msg}`
        };
    }
    
    return {
        type: 'unknown',
        file: error.file,
        suggestedFix: 'manual',
        details: msg
    };
}

/**
 * Get alternative fix strategy.
 */
function getAlternativeFix(currentFix: string): 'add-import' | 'generate-stub' | 'refactor-path' | 'add-file' | 'manual' {
    switch (currentFix) {
        case 'add-file': return 'generate-stub';
        case 'generate-stub': return 'refactor-path';
        case 'refactor-path': return 'manual';
        default: return 'manual';
    }
}

/**
 * Try to add a missing file from the original project.
 */
async function tryAddMissingFile(
    modulePath: string,
    outputPath: string,
    projectPath: string,
    analysisResult: AnalysisResult
): Promise<{ success: boolean; action: string; addedFile?: string }> {
    // Resolve the module path
    let sourcePath = '';
    
    if (modulePath.startsWith('../') || modulePath.startsWith('./')) {
        // Relative path - resolve from output
        const possiblePaths = [
            path.resolve(projectPath, 'src', modulePath.replace(/^\.\.\//, '') + '.ts'),
            path.resolve(projectPath, 'src', modulePath.replace(/^\.\.\//, '') + '.tsx'),
            path.resolve(projectPath, modulePath + '.ts'),
            path.resolve(projectPath, modulePath + '.tsx'),
        ];
        
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                sourcePath = p;
                break;
            }
        }
    } else if (modulePath.startsWith('@/')) {
        // Path alias
        sourcePath = path.resolve(projectPath, 'src', modulePath.substring(2) + '.ts');
    }
    
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return {
            success: false,
            action: `Source file not found for module: ${modulePath}`
        };
    }
    
    // Determine target path
    const relativePath = path.relative(path.join(projectPath, 'src'), sourcePath);
    const targetPath = path.join(outputPath, 'src', relativePath);
    
    // Copy file
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, targetPath);
    
    return {
        success: true,
        action: `Added missing file: ${relativePath}`,
        addedFile: targetPath
    };
}

/**
 * Try to generate a stub for a missing module.
 */
async function tryGenerateStub(
    modulePath: string,
    outputPath: string,
    traceLog: TraceLog | null
): Promise<{ success: boolean; action: string; stubFile?: string }> {
    // Determine stub path
    let stubPath = '';
    
    if (modulePath.startsWith('../') || modulePath.startsWith('./')) {
        // Relative module
        stubPath = path.join(outputPath, 'src', '__stubs__', 
            modulePath.replace(/^\.+\//, '').replace(/\//g, '_') + '.ts');
    } else {
        // External module
        stubPath = path.join(outputPath, 'src', '__stubs__', 
            modulePath.replace(/\//g, '_').replace(/@/g, '') + '.ts');
    }
    
    await fs.promises.mkdir(path.dirname(stubPath), { recursive: true });
    
    // Generate stub content
    let content = `/**
 * Auto-generated stub for: ${modulePath}
 * Generated by Analysis Agent v3.0 Fix Loop
 */

`;

    // If we have trace data for this module, use it
    if (traceLog) {
        const moduleEntries = traceLog.entries.filter(e => 
            e.module.includes(modulePath.replace(/\.\.\//g, '').replace(/\.\//g, ''))
        );
        
        if (moduleEntries.length > 0) {
            // Generate smart stub from trace
            const methods = new Map<string, { args: unknown[], returnValue: unknown }[]>();
            for (const entry of moduleEntries) {
                if (!methods.has(entry.method)) {
                    methods.set(entry.method, []);
                }
                methods.get(entry.method)!.push({
                    args: entry.args,
                    returnValue: entry.returnValue
                });
            }
            
            for (const [method, calls] of methods) {
                const returnValue = JSON.stringify(calls[0].returnValue);
                content += `// [TRACED] ${calls.length} call(s) recorded\n`;
                content += `export function ${method}(...args: unknown[]): unknown {\n`;
                content += `    console.warn('[STUB] ${modulePath}.${method} called');\n`;
                content += `    return ${returnValue};\n`;
                content += `}\n\n`;
            }
        } else {
            // Fallback stub
            content += `// [FALLBACK] No trace data available\n`;
            content += `export default {};\n`;
            content += `export function __stub_warning__() {\n`;
            content += `    console.warn('[STUB] Module ${modulePath} is a stub');\n`;
            content += `}\n`;
        }
    } else {
        // Basic fallback stub
        content += `// [FALLBACK] No trace data available\n`;
        content += `export default {};\n`;
    }
    
    await fs.promises.writeFile(stubPath, content);
    
    return {
        success: true,
        action: `Generated stub: ${path.relative(outputPath, stubPath)}`,
        stubFile: stubPath
    };
}

/**
 * Try to refactor an import path.
 */
async function tryRefactorPath(
    file: string,
    modulePath: string,
    outputPath: string
): Promise<{ success: boolean; action: string }> {
    if (!file || !fs.existsSync(file)) {
        return {
            success: false,
            action: `Cannot refactor: file not found: ${file}`
        };
    }
    
    try {
        let content = await fs.promises.readFile(file, 'utf-8');
        
        // Try to fix common path issues
        const originalContent = content;
        
        // Fix path alias @/ to relative
        if (modulePath.startsWith('@/')) {
            const relativePath = path.relative(
                path.dirname(file),
                path.join(outputPath, 'src', modulePath.substring(2))
            );
            content = content.replace(
                new RegExp(`from\\s+['"]${escapeRegExp(modulePath)}['"]`, 'g'),
                `from '${relativePath.startsWith('.') ? relativePath : './' + relativePath}'`
            );
        }
        
        // Fix missing .js extension
        if (!modulePath.endsWith('.js') && !modulePath.endsWith('.ts')) {
            content = content.replace(
                new RegExp(`from\\s+['"]${escapeRegExp(modulePath)}['"]`, 'g'),
                `from '${modulePath}.js'`
            );
        }
        
        if (content !== originalContent) {
            await fs.promises.writeFile(file, content);
            return {
                success: true,
                action: `Refactored import path in ${path.basename(file)}`
            };
        }
        
        return {
            success: false,
            action: `No refactoring applied to ${path.basename(file)}`
        };
    } catch (e) {
        return {
            success: false,
            action: `Refactor failed: ${e instanceof Error ? e.message : String(e)}`
        };
    }
}

/**
 * Escape string for use in RegExp.
 */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate fix loop report.
 */
export function generateFixLoopReport(result: FixLoopResult): string {
    const lines: string[] = [
        '# Fix Loop Report',
        '',
        `**Status:** ${result.allResolved ? '✅ All errors resolved' : '❌ Some errors remain'}`,
        `**Iterations:** ${result.iterations}`,
        `**Files added:** ${result.addedFiles.length}`,
        `**Stubs generated:** ${result.generatedStubs.length}`,
        '',
        '## Fix Attempts',
        '',
        '| Iteration | Strategy | Action | Success |',
        '|-----------|----------|--------|---------|'
    ];
    
    for (const attempt of result.attempts) {
        lines.push(`| ${attempt.iteration} | ${attempt.strategy} | ${attempt.action.substring(0, 50)} | ${attempt.success ? '✅' : '❌'} |`);
    }
    
    if (result.addedFiles.length > 0) {
        lines.push('');
        lines.push('## Files Added');
        for (const f of result.addedFiles) {
            lines.push(`- ${f}`);
        }
    }
    
    if (result.generatedStubs.length > 0) {
        lines.push('');
        lines.push('## Stubs Generated');
        for (const s of result.generatedStubs) {
            lines.push(`- ${s}`);
        }
    }
    
    if (result.remainingErrors.length > 0) {
        lines.push('');
        lines.push('## Remaining Errors');
        for (const e of result.remainingErrors) {
            lines.push(`- **${e.file}:** ${e.error}`);
        }
    }
    
    return lines.join('\n');
}
