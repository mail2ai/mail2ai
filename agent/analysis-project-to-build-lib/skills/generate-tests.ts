/**
 * Test Generation Skill (v3.0)
 * 
 * Generates test cases from T-DAERA trace data.
 * Creates Jest/Vitest test suites with assertions based on captured runtime values.
 * 
 * Part of the Design-Driven Closed-Loop Refactoring architecture.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { 
    TraceLog, 
    TraceEntry,
    GeneratedTestCase, 
    GeneratedTestSuite,
    AnalysisResult
} from '../types.js';

/**
 * Generate test suite from trace data.
 */
export async function generateTestsFromTrace(
    traceLog: TraceLog,
    analysisResult: AnalysisResult,
    outputPath: string,
    options: {
        testFramework?: 'vitest' | 'jest';
        groupBy?: 'module' | 'method';
        includeEdgeCases?: boolean;
        maxTestsPerMethod?: number;
    } = {}
): Promise<GeneratedTestSuite> {
    const framework = options.testFramework || 'vitest';
    const groupBy = options.groupBy || 'module';
    const maxTestsPerMethod = options.maxTestsPerMethod || 5;
    
    // Group trace entries by module or method
    const grouped = groupTraceEntries(traceLog.entries, groupBy);
    
    // Generate test cases
    const testCases: GeneratedTestCase[] = [];
    
    for (const [groupKey, entries] of grouped) {
        // Take unique input combinations (limit to maxTestsPerMethod)
        const uniqueEntries = deduplicateEntries(entries, maxTestsPerMethod);
        
        for (const entry of uniqueEntries) {
            const testCase = generateTestCase(entry, framework);
            if (testCase) {
                testCases.push(testCase);
            }
        }
    }
    
    // Generate full test file content
    const content = generateTestFileContent(testCases, framework, analysisResult);
    
    // Write test file
    const testsDir = path.join(outputPath, 'tests');
    await fs.promises.mkdir(testsDir, { recursive: true });
    
    const testFilePath = path.join(testsDir, 'auto-generated.spec.ts');
    await fs.promises.writeFile(testFilePath, content);
    
    return {
        name: 'Auto-Generated Tests from Trace',
        filePath: testFilePath,
        testCases,
        content,
        coverage: {
            modules: new Set(testCases.map(tc => tc.module)).size,
            methods: new Set(testCases.map(tc => `${tc.module}.${tc.method}`)).size,
            assertions: testCases.length
        }
    };
}

/**
 * Group trace entries by module or method.
 */
function groupTraceEntries(
    entries: TraceEntry[],
    groupBy: 'module' | 'method'
): Map<string, TraceEntry[]> {
    const grouped: Map<string, TraceEntry[]> = new Map();
    
    for (const entry of entries) {
        const key = groupBy === 'module' 
            ? entry.module 
            : `${entry.module}.${entry.method}`;
        
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(entry);
    }
    
    return grouped;
}

/**
 * Deduplicate entries by input signature.
 */
function deduplicateEntries(entries: TraceEntry[], limit: number): TraceEntry[] {
    const seen = new Set<string>();
    const unique: TraceEntry[] = [];
    
    for (const entry of entries) {
        const signature = JSON.stringify(entry.args);
        if (!seen.has(signature)) {
            seen.add(signature);
            unique.push(entry);
            if (unique.length >= limit) break;
        }
    }
    
    return unique;
}

/**
 * Generate a single test case from a trace entry.
 */
function generateTestCase(entry: TraceEntry, framework: 'vitest' | 'jest'): GeneratedTestCase | null {
    // Skip entries with errors (could generate error test cases separately)
    if (entry.error) return null;
    
    // Skip entries with undefined return values
    if (entry.returnValue === undefined) return null;
    
    const module = path.basename(entry.module).replace(/\.[jt]sx?$/, '');
    const methodName = entry.method;
    
    // Generate test name
    const argsStr = entry.args.length > 0 
        ? formatArgsForName(entry.args).substring(0, 50)
        : 'no args';
    const name = `${methodName} with ${argsStr}`;
    
    // Generate assertion
    const expectedValue = serializeValue(entry.returnValue);
    const argsCode = entry.args.map(serializeValue).join(', ');
    
    const content = `
test('${escapeTestName(name)}', ${entry.isAsync ? 'async ' : ''}() => {
    ${entry.isAsync ? 'const result = await' : 'const result ='} ${methodName}(${argsCode});
    expect(result).toEqual(${expectedValue});
});
`.trim();

    return {
        name,
        filePath: '', // Will be set by parent
        module,
        method: methodName,
        inputs: entry.args,
        expectedOutput: entry.returnValue,
        content,
        sourceTrace: entry
    };
}

/**
 * Format args for test name.
 */
function formatArgsForName(args: unknown[]): string {
    return args.map(arg => {
        if (typeof arg === 'string') return `"${arg.substring(0, 20)}"`;
        if (typeof arg === 'number') return String(arg);
        if (typeof arg === 'boolean') return String(arg);
        if (arg === null) return 'null';
        if (Array.isArray(arg)) return `[${arg.length} items]`;
        if (typeof arg === 'object') return `{object}`;
        return String(arg);
    }).join(', ');
}

/**
 * Escape test name for JavaScript string.
 */
function escapeTestName(name: string): string {
    return name.replace(/'/g, "\\'").replace(/\n/g, ' ');
}

/**
 * Serialize value for test code.
 */
function serializeValue(value: unknown, depth = 0): string {
    if (depth > 3) return '/* complex object */{}';
    
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (value.length > 10) {
            const first5 = value.slice(0, 5).map(v => serializeValue(v, depth + 1));
            return `[${first5.join(', ')}, /* ... ${value.length - 5} more */]`;
        }
        return `[${value.map(v => serializeValue(v, depth + 1)).join(', ')}]`;
    }
    
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        if (entries.length > 10) {
            const first5 = entries.slice(0, 5)
                .map(([k, v]) => `${JSON.stringify(k)}: ${serializeValue(v, depth + 1)}`);
            return `{ ${first5.join(', ')}, /* ... ${entries.length - 5} more */ }`;
        }
        const props = entries
            .map(([k, v]) => `${JSON.stringify(k)}: ${serializeValue(v, depth + 1)}`)
            .join(', ');
        return `{ ${props} }`;
    }
    
    return '/* unsupported */null';
}

/**
 * Generate full test file content.
 */
function generateTestFileContent(
    testCases: GeneratedTestCase[],
    framework: 'vitest' | 'jest',
    analysisResult: AnalysisResult
): string {
    const lines: string[] = [];
    
    // Header
    lines.push(`/**`);
    lines.push(` * Auto-generated tests from T-DAERA trace data`);
    lines.push(` * Generated by Analysis Agent v3.0`);
    lines.push(` * `);
    lines.push(` * These tests verify that the extracted library behaves the same`);
    lines.push(` * as the original code during tracing.`);
    lines.push(` */`);
    lines.push('');
    
    // Imports
    if (framework === 'vitest') {
        lines.push(`import { describe, test, expect, beforeAll, afterAll } from 'vitest';`);
    } else {
        lines.push(`import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';`);
    }
    lines.push('');
    
    // Group test cases by module
    const byModule: Map<string, GeneratedTestCase[]> = new Map();
    for (const tc of testCases) {
        if (!byModule.has(tc.module)) {
            byModule.set(tc.module, []);
        }
        byModule.get(tc.module)!.push(tc);
    }
    
    // Add import comments for modules being tested
    lines.push('// Import the modules being tested');
    for (const module of byModule.keys()) {
        lines.push(`// import { ... } from '../src/${module}';`);
    }
    lines.push('');
    
    // Generate describe blocks
    for (const [module, cases] of byModule) {
        lines.push(`describe('${module}', () => {`);
        
        // Group by method
        const byMethod: Map<string, GeneratedTestCase[]> = new Map();
        for (const tc of cases) {
            if (!byMethod.has(tc.method)) {
                byMethod.set(tc.method, []);
            }
            byMethod.get(tc.method)!.push(tc);
        }
        
        for (const [method, methodCases] of byMethod) {
            lines.push(`    describe('${method}', () => {`);
            for (const tc of methodCases) {
                lines.push('        ' + tc.content.split('\n').join('\n        '));
            }
            lines.push(`    });`);
            lines.push('');
        }
        
        lines.push(`});`);
        lines.push('');
    }
    
    // Add coverage summary comment
    lines.push(`/**`);
    lines.push(` * Coverage Summary:`);
    lines.push(` * - Modules: ${byModule.size}`);
    lines.push(` * - Methods: ${new Set(testCases.map(tc => `${tc.module}.${tc.method}`)).size}`);
    lines.push(` * - Test cases: ${testCases.length}`);
    lines.push(` */`);
    
    return lines.join('\n');
}

/**
 * Generate error test cases for entries that threw errors.
 */
export function generateErrorTestCases(
    traceLog: TraceLog,
    framework: 'vitest' | 'jest'
): GeneratedTestCase[] {
    const errorEntries = traceLog.entries.filter(e => e.error);
    const testCases: GeneratedTestCase[] = [];
    
    for (const entry of errorEntries) {
        const module = path.basename(entry.module).replace(/\.[jt]sx?$/, '');
        const argsCode = entry.args.map(serializeValue).join(', ');
        
        const content = `
test('${entry.method} should throw with ${formatArgsForName(entry.args)}', ${entry.isAsync ? 'async ' : ''}() => {
    ${entry.isAsync 
        ? `await expect(${entry.method}(${argsCode})).rejects.toThrow();`
        : `expect(() => ${entry.method}(${argsCode})).toThrow();`
    }
});
`.trim();

        testCases.push({
            name: `${entry.method} should throw`,
            filePath: '',
            module,
            method: entry.method,
            inputs: entry.args,
            expectedOutput: entry.error,
            content,
            sourceTrace: entry
        });
    }
    
    return testCases;
}
