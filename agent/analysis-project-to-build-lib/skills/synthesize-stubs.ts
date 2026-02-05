/**
 * Smart Stub Synthesizer Skill
 * 
 * T-DAERA Phase 3: Synthesis
 * 
 * Generates intelligent stubs from trace logs. Unlike static stubs that throw
 * errors, these stubs contain actual recorded values and behavior patterns
 * from runtime tracing.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    TraceLog,
    TraceEntry,
    SmartStubConfig,
    StubSynthesisResult,
    GeneratedStub,
    MissingDependency,
    AnalysisResult
} from '../types.js';

// Dynamic import for ts-morph
let Project: any = null;
let SyntaxKind: any = null;

async function loadTsMorph() {
    if (!Project) {
        const tsMorph = await import('ts-morph');
        Project = tsMorph.Project;
        SyntaxKind = tsMorph.SyntaxKind;
    }
    return { Project, SyntaxKind };
}

/**
 * Group trace entries by module and method.
 */
function groupTraceEntries(entries: TraceEntry[]): Map<string, Map<string, TraceEntry[]>> {
    const grouped = new Map<string, Map<string, TraceEntry[]>>();

    for (const entry of entries) {
        if (!grouped.has(entry.module)) {
            grouped.set(entry.module, new Map());
        }
        const moduleMap = grouped.get(entry.module)!;
        
        if (!moduleMap.has(entry.method)) {
            moduleMap.set(entry.method, []);
        }
        moduleMap.get(entry.method)!.push(entry);
    }

    return grouped;
}

/**
 * Generate a smart return value based on traced calls.
 * Handles multiple call patterns by creating a lookup table.
 */
function generateSmartReturnValue(
    entries: TraceEntry[],
    config: SmartStubConfig
): { code: string; isConditional: boolean } {
    if (entries.length === 0) {
        return {
            code: config.fallbackBehavior === 'throw'
                ? `throw new Error('[T-DAERA Stub] No traced calls')`
                : `return undefined`,
            isConditional: false
        };
    }

    // If all calls return the same value, use simple return
    const uniqueReturns = new Set(entries.map(e => JSON.stringify(e.returnValue)));
    
    if (uniqueReturns.size === 1) {
        const value = entries[0].returnValue;
        return {
            code: `return ${serializeValue(value)}`,
            isConditional: false
        };
    }

    // Multiple return values - create a lookup based on args
    const lookupCases: string[] = [];
    const seenArgs = new Set<string>();

    for (const entry of entries) {
        const argsKey = JSON.stringify(entry.args);
        if (seenArgs.has(argsKey)) continue;
        seenArgs.add(argsKey);

        const argsCondition = entry.args.length > 0
            ? `JSON.stringify([${entry.args.map((_, i) => `arguments[${i}]`).join(', ')}]) === ${JSON.stringify(argsKey)}`
            : 'arguments.length === 0';

        lookupCases.push(`    if (${argsCondition}) return ${serializeValue(entry.returnValue)};`);
    }

    // Add fallback
    let fallback: string;
    switch (config.fallbackBehavior) {
        case 'throw':
            fallback = `    throw new Error('[T-DAERA Stub] Untraced call with args: ' + JSON.stringify(Array.from(arguments)));`;
            break;
        case 'warn':
            fallback = `    console.warn('[T-DAERA Stub] Untraced call with args:', Array.from(arguments));\n    return ${serializeValue(entries[0].returnValue)};`;
            break;
        case 'return-default':
        default:
            fallback = `    return ${serializeValue(entries[0].returnValue)};`;
    }

    return {
        code: lookupCases.join('\n') + '\n' + fallback,
        isConditional: true
    };
}

/**
 * Serialize a value to JavaScript code.
 */
function serializeValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return 'function() {}';

    if (Array.isArray(value)) {
        return `[${value.map(v => serializeValue(v)).join(', ')}]`;
    }

    if (typeof value === 'object') {
        // Handle special serialized values from tracer
        if ('__error' in (value as Record<string, unknown>)) {
            const err = value as { message: string };
            return `(() => { throw new Error(${JSON.stringify(err.message)}); })()`;
        }

        // Check for circular/unserializable markers
        const valueStr = String(value);
        if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
            // Special marker like [Circular], [Function], etc.
            return 'undefined /* ' + valueStr + ' */';
        }

        try {
            return JSON.stringify(value);
        } catch {
            return '{}';
        }
    }

    return 'undefined';
}

/**
 * Generate a smart stub for a single module based on trace data.
 */
async function generateModuleStub(
    moduleName: string,
    methodTraces: Map<string, TraceEntry[]>,
    originalFilePath: string | undefined,
    config: SmartStubConfig
): Promise<string> {
    const lines: string[] = [
        `/**`,
        ` * T-DAERA Smart Stub`,
        ` * Module: ${moduleName}`,
        ` * Generated: ${new Date().toISOString()}`,
        ` * `,
        ` * This stub contains recorded runtime values from tracing.`,
        ` * Methods with actual behavior are marked with [TRACED].`,
        ` * Methods with fallback behavior are marked with [FALLBACK].`,
        ` */`,
        ``
    ];

    // Track which methods were traced
    const tracedMethods: string[] = [];
    const fallbackMethods: string[] = [];

    // If we have the original file, try to preserve types
    if (originalFilePath && fs.existsSync(originalFilePath)) {
        try {
            const { Project: ProjectClass } = await loadTsMorph();
            const project = new ProjectClass();
            const sourceFile = project.addSourceFileAtPath(originalFilePath);

            // Get exported declarations
            const exports = sourceFile.getExportedDeclarations();

            for (const [name, declarations] of exports) {
                const traces = methodTraces.get(name) || [];
                const isTraced = traces.length > 0;

                if (isTraced) {
                    tracedMethods.push(name);
                } else if (!config.pruneUncalled) {
                    fallbackMethods.push(name);
                } else {
                    continue; // Skip untraced methods if pruning
                }

                for (const decl of declarations) {
                    const kind = decl.getKindName();
                    const marker = isTraced ? '[TRACED]' : '[FALLBACK]';

                    if (kind === 'FunctionDeclaration') {
                        const func = decl as any;
                        const params = func.getParameters?.() || [];
                        const paramStr = params.map((p: any) => {
                            const name = p.getName?.() || 'arg';
                            const type = p.getType?.()?.getText?.() || 'any';
                            return `${name}: ${type}`;
                        }).join(', ');
                        const returnType = func.getReturnType?.()?.getText?.() || 'any';
                        const isAsync = traces.some(t => t.isAsync);

                        lines.push(`// ${marker}`);
                        if (isTraced) {
                            const { code, isConditional } = generateSmartReturnValue(traces, config);
                            if (isAsync) {
                                lines.push(`export async function ${name}(${paramStr}): Promise<${returnType}> {`);
                            } else {
                                lines.push(`export function ${name}(${paramStr}): ${returnType} {`);
                            }
                            if (isConditional) {
                                lines.push(code);
                            } else {
                                lines.push(`  ${code};`);
                            }
                            lines.push(`}`);
                        } else {
                            lines.push(`export function ${name}(${paramStr}): ${returnType} {`);
                            if (config.fallbackBehavior === 'throw') {
                                lines.push(`  throw new Error('[T-DAERA Stub] ${name} was not traced');`);
                            } else if (config.fallbackBehavior === 'warn') {
                                lines.push(`  console.warn('[T-DAERA Stub] Calling untraced method: ${name}');`);
                                lines.push(`  return undefined as any;`);
                            } else {
                                lines.push(`  return undefined as any;`);
                            }
                            lines.push(`}`);
                        }
                        lines.push(``);
                    } else if (kind === 'ClassDeclaration') {
                        // For classes, we need to handle instance methods
                        const cls = decl as any;
                        const className = cls.getName?.() || name;
                        lines.push(`// ${marker} class`);
                        lines.push(`export class ${className} {`);

                        // Generate constructor
                        const constructorTraces = methodTraces.get('constructor') || [];
                        lines.push(`  constructor(...args: any[]) {`);
                        if (constructorTraces.length > 0) {
                            lines.push(`    // Constructor was traced`);
                        }
                        lines.push(`  }`);
                        lines.push(``);

                        // Generate methods
                        const methods = cls.getMethods?.() || [];
                        for (const method of methods) {
                            const methodName = method.getName?.() || 'method';
                            const methodTraceEntries = methodTraces.get(methodName) || [];

                            if (methodTraceEntries.length > 0) {
                                const { code, isConditional } = generateSmartReturnValue(methodTraceEntries, config);
                                const isAsync = methodTraceEntries.some(t => t.isAsync);

                                lines.push(`  // [TRACED]`);
                                if (isAsync) {
                                    lines.push(`  async ${methodName}(...args: any[]): Promise<any> {`);
                                } else {
                                    lines.push(`  ${methodName}(...args: any[]): any {`);
                                }
                                if (isConditional) {
                                    lines.push(code.split('\n').map(l => '  ' + l).join('\n'));
                                } else {
                                    lines.push(`    ${code};`);
                                }
                                lines.push(`  }`);
                            } else if (!config.pruneUncalled) {
                                lines.push(`  // [FALLBACK]`);
                                lines.push(`  ${methodName}(...args: any[]): any {`);
                                if (config.fallbackBehavior === 'throw') {
                                    lines.push(`    throw new Error('[T-DAERA Stub] ${methodName} was not traced');`);
                                } else {
                                    lines.push(`    return undefined;`);
                                }
                                lines.push(`  }`);
                            }
                            lines.push(``);
                        }

                        lines.push(`}`);
                        lines.push(``);
                    } else if (kind === 'InterfaceDeclaration' || kind === 'TypeAliasDeclaration') {
                        // Preserve types as-is
                        lines.push(decl.getFullText());
                        lines.push(``);
                    } else if (kind === 'VariableDeclaration') {
                        const varTraces = traces;
                        if (varTraces.length > 0) {
                            lines.push(`// ${marker}`);
                            lines.push(`export const ${name} = ${serializeValue(varTraces[0].returnValue)};`);
                        } else if (!config.pruneUncalled) {
                            lines.push(`// ${marker}`);
                            lines.push(`export const ${name}: any = null;`);
                        }
                        lines.push(``);
                    }
                }
            }

            // Handle default export
            const defaultExport = sourceFile.getDefaultExportSymbol();
            if (defaultExport) {
                const defaultTraces = methodTraces.get('default') || [];
                if (defaultTraces.length > 0) {
                    lines.push(`// [TRACED] default export`);
                    const { code } = generateSmartReturnValue(defaultTraces, config);
                    if (defaultTraces.some(t => t.isAsync)) {
                        lines.push(`export default async function(...args: any[]) {`);
                    } else {
                        lines.push(`export default function(...args: any[]) {`);
                    }
                    lines.push(`  ${code};`);
                    lines.push(`}`);
                } else if (!config.pruneUncalled) {
                    lines.push(`// [FALLBACK] default export`);
                    lines.push(`export default null;`);
                }
            }

            return lines.join('\n');
        } catch (error) {
            console.warn(`  ⚠️  Could not analyze original file ${originalFilePath}:`, error);
        }
    }

    // Fallback: generate stubs from trace data only
    for (const [methodName, traces] of methodTraces.entries()) {
        const { code, isConditional } = generateSmartReturnValue(traces, config);
        const isAsync = traces.some(t => t.isAsync);

        tracedMethods.push(methodName);
        lines.push(`// [TRACED from runtime]`);

        if (isAsync) {
            lines.push(`export async function ${methodName}(...args: any[]): Promise<any> {`);
        } else {
            lines.push(`export function ${methodName}(...args: any[]): any {`);
        }
        
        if (isConditional) {
            lines.push(code);
        } else {
            lines.push(`  ${code};`);
        }
        lines.push(`}`);
        lines.push(``);
    }

    if (tracedMethods.length === 0) {
        lines.push(`// No traces captured - placeholder stub`);
        lines.push(`export const __stub__ = true;`);
    }

    return lines.join('\n');
}

/**
 * Synthesize smart stubs for all missing dependencies.
 */
export async function synthesizeSmartStubs(
    traceLog: TraceLog,
    analysisResult: AnalysisResult,
    outputPath: string,
    projectPath: string,
    config: Partial<SmartStubConfig> = {}
): Promise<StubSynthesisResult> {
    const fullConfig: SmartStubConfig = {
        traceLog,
        preserveTypes: config.preserveTypes ?? true,
        generateWarnings: config.generateWarnings ?? true,
        fallbackBehavior: config.fallbackBehavior ?? 'warn',
        pruneUncalled: config.pruneUncalled ?? false
    };

    const result: StubSynthesisResult = {
        files: [],
        prunedMethods: [],
        warnings: []
    };

    console.log(`  🧪 Synthesizing smart stubs from ${traceLog.entries.length} trace entries...`);

    // Group traces by module
    const groupedTraces = groupTraceEntries(traceLog.entries);

    // Create stubs directory
    const stubsDir = path.join(outputPath, 'src', 'stubs');
    await fs.promises.mkdir(stubsDir, { recursive: true });

    // Generate stubs for missing dependencies
    const missingDeps = analysisResult.missingDependencies || [];
    
    // Group missing deps by directory
    const byDirectory = new Map<string, MissingDependency[]>();
    for (const dep of missingDeps) {
        const dir = dep.directory;
        if (!byDirectory.has(dir)) {
            byDirectory.set(dir, []);
        }
        byDirectory.get(dir)!.push(dep);
    }

    for (const [dir, deps] of byDirectory.entries()) {
        const stubSubDir = path.join(stubsDir, dir.replace(/^src\//, ''));
        await fs.promises.mkdir(stubSubDir, { recursive: true });

        for (const dep of deps) {
            try {
                // Find traces for this module
                const moduleTraces = groupedTraces.get(dep.relativePath) ||
                    groupedTraces.get(path.basename(dep.relativePath)) ||
                    new Map<string, TraceEntry[]>();

                // Also check by import specifier
                for (const specifier of dep.importSpecifiers) {
                    const specTraces = groupedTraces.get(specifier);
                    if (specTraces) {
                        for (const [method, entries] of specTraces) {
                            if (!moduleTraces.has(method)) {
                                moduleTraces.set(method, []);
                            }
                            moduleTraces.get(method)!.push(...entries);
                        }
                    }
                }

                // Generate stub content
                const stubContent = await generateModuleStub(
                    dep.relativePath,
                    moduleTraces,
                    dep.filePath,
                    fullConfig
                );

                // Write stub file
                const fileName = path.basename(dep.relativePath);
                const stubFilePath = path.join(stubSubDir, fileName);
                await fs.promises.writeFile(stubFilePath, stubContent, 'utf-8');

                // Track generated stub
                const tracedMethods = Array.from(moduleTraces.keys());
                result.files.push({
                    filePath: stubFilePath,
                    originalPath: dep.filePath,
                    content: stubContent,
                    tracedMethods,
                    fallbackMethods: [] // TODO: track properly
                });

                const stubRelPath = path.relative(outputPath, stubFilePath);
                if (tracedMethods.length > 0) {
                    console.log(`    ✓ Smart stub: ${stubRelPath} (${tracedMethods.length} traced methods)`);
                } else {
                    console.log(`    ⚠ Fallback stub: ${stubRelPath} (no traces)`);
                    result.warnings.push(`No traces for ${dep.relativePath}`);
                }
            } catch (error) {
                result.warnings.push(`Failed to generate stub for ${dep.relativePath}: ${error}`);
                console.error(`    ✗ Failed: ${dep.relativePath}`, error);
            }
        }
    }

    // Generate stubs index
    if (result.files.length > 0) {
        const indexContent = generateStubsIndex(result.files, stubsDir);
        const indexPath = path.join(stubsDir, 'index.ts');
        await fs.promises.writeFile(indexPath, indexContent, 'utf-8');
    }

    console.log(`  ✅ Generated ${result.files.length} smart stubs`);
    if (result.warnings.length > 0) {
        console.log(`  ⚠️  ${result.warnings.length} warnings`);
    }

    return result;
}

/**
 * Generate an index file for stubs.
 */
function generateStubsIndex(files: GeneratedStub[], stubsDir: string): string {
    const lines: string[] = [
        `/**`,
        ` * T-DAERA Smart Stubs Index`,
        ` * Auto-generated - do not edit`,
        ` */`,
        ``
    ];

    for (const file of files) {
        const relPath = path.relative(stubsDir, file.filePath)
            .replace(/\\/g, '/')
            .replace(/\.tsx?$/, '.js');
        
        // Extract module name for re-export
        const baseName = path.basename(file.filePath, path.extname(file.filePath));
        lines.push(`export * from './${relPath.replace(/\.js$/, '.js')}';`);
    }

    return lines.join('\n');
}

/**
 * Analyze trace log and return statistics about stub quality.
 */
export function analyzeStubQuality(traceLog: TraceLog): {
    coverage: number;
    methodsCovered: string[];
    methodsUncovered: string[];
    callPatterns: Map<string, number>;
} {
    const grouped = groupTraceEntries(traceLog.entries);
    const methodsCovered: string[] = [];
    const callPatterns = new Map<string, number>();

    for (const [module, methods] of grouped) {
        for (const [method, entries] of methods) {
            const fullName = `${module}.${method}`;
            methodsCovered.push(fullName);
            callPatterns.set(fullName, entries.length);
        }
    }

    return {
        coverage: methodsCovered.length > 0 ? 1 : 0, // Need more context for real coverage
        methodsCovered,
        methodsUncovered: [], // Would need static analysis to know all methods
        callPatterns
    };
}

export default {
    synthesizeSmartStubs,
    analyzeStubQuality
};
