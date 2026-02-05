import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisResult, MissingDependency } from '../types.js';

interface StubGenerationResult {
    generatedFiles: string[];
    errors: Array<{ file: string; error: string }>;
}

// Import ts-morph dynamically
let Project: any = null;
async function loadTsMorph() {
    if (!Project) {
        const tsMorph = await import('ts-morph');
        Project = tsMorph.Project;
    }
    return Project;
}

/**
 * Generate stub files for missing dependencies.
 * This allows the extracted library to compile even when some dependencies
 * are not included in the extraction.
 */
export async function generateStubs(
    analysisResult: AnalysisResult,
    outputPath: string,
    projectPath: string
): Promise<StubGenerationResult> {
    const result: StubGenerationResult = {
        generatedFiles: [],
        errors: []
    };

    const missingDeps = analysisResult.missingDependencies;
    if (!missingDeps || missingDeps.length === 0) {
        console.log('  ✅ No missing dependencies - no stubs needed');
        return result;
    }

    console.log(`  📝 Generating stubs for ${missingDeps.length} missing dependencies...`);

    // Create stubs directory
    const stubsDir = path.join(outputPath, 'src', 'stubs');
    await fs.promises.mkdir(stubsDir, { recursive: true });

    // Group missing dependencies by directory
    const byDirectory = new Map<string, MissingDependency[]>();
    for (const dep of missingDeps) {
        const dir = dep.directory;
        if (!byDirectory.has(dir)) {
            byDirectory.set(dir, []);
        }
        byDirectory.get(dir)!.push(dep);
    }

    // Generate stubs for each directory
    const stubExports: string[] = [];

    for (const [dir, deps] of byDirectory.entries()) {
        try {
            // Create directory structure in stubs
            const stubSubDir = path.join(stubsDir, dir.replace(/^src\//, ''));
            await fs.promises.mkdir(stubSubDir, { recursive: true });

            for (const dep of deps) {
                try {
                    const stubContent = await generateStubForFile(dep, projectPath);
                    const fileName = path.basename(dep.relativePath);
                    const stubFilePath = path.join(stubSubDir, fileName);

                    await fs.promises.writeFile(stubFilePath, stubContent, 'utf-8');
                    result.generatedFiles.push(stubFilePath);

                    // Track for index file
                    const relPath = path.relative(stubsDir, stubFilePath)
                        .replace(/\\/g, '/')
                        .replace(/\.tsx?$/, '.js');
                    stubExports.push(`./${relPath}`);

                    console.log(`    ✓ Generated stub: ${path.relative(outputPath, stubFilePath)}`);
                } catch (error) {
                    result.errors.push({
                        file: dep.filePath,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        } catch (error) {
            result.errors.push({
                file: dir,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Generate stubs index file
    if (stubExports.length > 0) {
        const stubIndexContent = generateStubsIndex(stubExports);
        const stubIndexPath = path.join(stubsDir, 'index.ts');
        await fs.promises.writeFile(stubIndexPath, stubIndexContent, 'utf-8');
        result.generatedFiles.push(stubIndexPath);
    }

    // Generate adapters interface file
    const adaptersDir = path.join(outputPath, 'src', 'adapters');
    await fs.promises.mkdir(adaptersDir, { recursive: true });
    const adaptersContent = generateAdaptersInterface(missingDeps);
    const adaptersPath = path.join(adaptersDir, 'types.ts');
    await fs.promises.writeFile(adaptersPath, adaptersContent, 'utf-8');
    result.generatedFiles.push(adaptersPath);

    console.log(`  ✅ Generated ${result.generatedFiles.length} stub files`);
    if (result.errors.length > 0) {
        console.log(`  ⚠️ ${result.errors.length} files could not be stubbed`);
    }

    return result;
}

/**
 * Generate a stub file for a missing dependency by analyzing the original file.
 * Uses ts-morph for accurate TypeScript parsing.
 */
async function generateStubForFile(dep: MissingDependency, projectPath: string): Promise<string> {
    const lines: string[] = [
        `/**`,
        ` * Auto-generated stub for missing dependency`,
        ` * Original: ${dep.relativePath}`,
        ` * Referenced by: ${dep.referencedBy.join(', ')}`,
        ` * `,
        ` * TODO: Implement this stub or inject the actual implementation`,
        ` */`,
        ``,
    ];

    try {
        const ProjectClass = await loadTsMorph();
        const project = new ProjectClass();
        const sourceFile = project.addSourceFileAtPath(dep.filePath);
        
        // Get all exports from the source file
        const exportedDeclarations = sourceFile.getExportedDeclarations();
        const generatedExports = new Set<string>();
        
        for (const [name, declarations] of exportedDeclarations) {
            if (generatedExports.has(name)) continue;
            generatedExports.add(name);
            
            for (const decl of declarations) {
                const kind = decl.getKindName();
                
                if (kind === 'FunctionDeclaration') {
                    lines.push(`export function ${name}(...args: any[]): any {`);
                    lines.push(`  throw new Error('Stub: ${name} not implemented');`);
                    lines.push(`}`);
                    lines.push(``);
                } else if (kind === 'ClassDeclaration') {
                    lines.push(`export class ${name} {`);
                    lines.push(`  constructor(...args: any[]) {`);
                    lines.push(`    throw new Error('Stub: ${name} not implemented');`);
                    lines.push(`  }`);
                    lines.push(`  [key: string]: any;`);
                    lines.push(`}`);
                    lines.push(``);
                } else if (kind === 'InterfaceDeclaration') {
                    lines.push(`export interface ${name} {`);
                    lines.push(`  [key: string]: any;`);
                    lines.push(`}`);
                    lines.push(``);
                } else if (kind === 'TypeAliasDeclaration') {
                    lines.push(`export type ${name} = any;`);
                    lines.push(``);
                } else if (kind === 'VariableDeclaration') {
                    lines.push(`export const ${name}: any = null;`);
                    lines.push(``);
                } else if (kind === 'EnumDeclaration') {
                    lines.push(`export enum ${name} {}`);
                    lines.push(``);
                } else {
                    // Default case
                    lines.push(`export const ${name}: any = null;`);
                    lines.push(``);
                }
            }
        }
        
        // Check for default export
        const defaultExport = sourceFile.getDefaultExportSymbol();
        if (defaultExport && !generatedExports.has('default')) {
            lines.push(`const _default: any = null;`);
            lines.push(`export default _default;`);
            lines.push(``);
        }
        
        if (generatedExports.size === 0) {
            lines.push(`// No exports found - using placeholder`);
            lines.push(`export const __stub__ = true;`);
        }
        
    } catch (error) {
        // Fallback to regex-based extraction if ts-morph fails
        console.log(`    ⚠️ ts-morph failed for ${dep.relativePath}, using regex fallback`);
        try {
            const originalContent = await fs.promises.readFile(dep.filePath, 'utf-8');
            const exports = extractExportsFromSource(originalContent);
            
            if (exports.length > 0) {
                lines.push(`// Extracted exports using regex (ts-morph unavailable)`);
                lines.push(``);
                
                for (const exp of exports) {
                    const stubCode = generateStubExport(exp);
                    if (stubCode) {
                        lines.push(stubCode);
                        lines.push(``);
                    }
                }
            } else {
                lines.push(`// Could not extract exports`);
                lines.push(`export const __stub__ = true;`);
            }
        } catch {
            lines.push(`// Original file could not be read`);
            lines.push(`export const __stub__ = true;`);
        }
    }

    return lines.join('\n');
}

interface ExtractedExport {
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'default';
    signature?: string;
}

/**
 * Extract export information from TypeScript source code using regex patterns.
 * This is a lightweight approach that doesn't require ts-morph.
 */
function extractExportsFromSource(content: string): ExtractedExport[] {
    const exports: ExtractedExport[] = [];

    // Match exported functions
    const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
        exports.push({
            name: match[1],
            kind: 'function',
            signature: `(${match[3]})${match[4] ? `: ${match[4].trim()}` : ': void'}`
        });
    }

    // Match exported classes
    const classRegex = /export\s+class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
    while ((match = classRegex.exec(content)) !== null) {
        exports.push({
            name: match[1],
            kind: 'class'
        });
    }

    // Match exported interfaces
    const interfaceRegex = /export\s+interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[\w,\s<>]+)?\s*\{/g;
    while ((match = interfaceRegex.exec(content)) !== null) {
        exports.push({
            name: match[1],
            kind: 'interface'
        });
    }

    // Match exported types
    const typeRegex = /export\s+type\s+(\w+)(?:<[^>]*>)?\s*=/g;
    while ((match = typeRegex.exec(content)) !== null) {
        exports.push({
            name: match[1],
            kind: 'type'
        });
    }

    // Match exported constants
    const constRegex = /export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=/g;
    while ((match = constRegex.exec(content)) !== null) {
        exports.push({
            name: match[1],
            kind: 'const',
            signature: match[2]?.trim()
        });
    }

    // Match default exports
    if (/export\s+default\s+/.test(content)) {
        exports.push({
            name: 'default',
            kind: 'default'
        });
    }

    return exports;
}

/**
 * Generate a stub implementation for an export.
 * Returns null if the signature cannot be safely generated.
 */
function generateStubExport(exp: ExtractedExport): string | null {
    switch (exp.kind) {
        case 'function':
            // For functions, create a simple stub that takes any args and returns any
            // This avoids parsing complex type signatures
            return `export function ${exp.name}(...args: any[]): any {\n  throw new Error('Stub: ${exp.name} not implemented');\n}`;
        
        case 'class':
            return `export class ${exp.name} {\n  constructor(...args: any[]) {\n    throw new Error('Stub: ${exp.name} not implemented');\n  }\n  [key: string]: any;\n}`;
        
        case 'interface':
            return `export interface ${exp.name} {\n  [key: string]: unknown;\n}`;
        
        case 'type':
            return `export type ${exp.name} = any;`;
        
        case 'const':
            return `export const ${exp.name}: any = null;`;
        
        case 'default':
            return `const _default: any = null;\nexport default _default;`;
        
        default:
            return `export const ${exp.name}: any = null;`;
    }
}

/**
 * Generate an index file that re-exports all stubs.
 * Uses named exports to avoid conflicts.
 */
function generateStubsIndex(stubPaths: string[]): string {
    const lines: string[] = [
        `/**`,
        ` * Auto-generated stubs index`,
        ` * Note: This file exists for reference.`,
        ` * Individual stub files should be imported directly.`,
        ` */`,
        ``,
        `// Stub files available:`
    ];

    for (const stubPath of stubPaths) {
        lines.push(`// - ${stubPath}`);
    }
    
    lines.push(``);
    lines.push(`export const __stubsIndex = true;`);

    return lines.join('\n');
}

/**
 * Generate adapter interfaces for dependency injection.
 */
function generateAdaptersInterface(missingDeps: MissingDependency[]): string {
    const lines: string[] = [
        `/**`,
        ` * Adapter interfaces for dependency injection`,
        ` * `,
        ` * Use these interfaces to inject real implementations`,
        ` * of the stubbed dependencies at runtime.`,
        ` */`,
        ``
    ];

    // Group by top-level module
    const modules = new Set<string>();
    for (const dep of missingDeps) {
        const parts = dep.directory.replace(/^src\//, '').split('/');
        if (parts[0]) {
            modules.add(parts[0]);
        }
    }

    for (const mod of modules) {
        const capitalizedMod = mod.charAt(0).toUpperCase() + mod.slice(1);
        lines.push(`export interface I${capitalizedMod}Adapter {`);
        lines.push(`  // TODO: Define adapter methods for ${mod} module`);
        lines.push(`  [key: string]: unknown;`);
        lines.push(`}`);
        lines.push(``);
    }

    // Add a unified adapters interface
    lines.push(`export interface LibraryAdapters {`);
    for (const mod of modules) {
        const capitalizedMod = mod.charAt(0).toUpperCase() + mod.slice(1);
        lines.push(`  ${mod}?: I${capitalizedMod}Adapter;`);
    }
    lines.push(`}`);
    lines.push(``);

    // Add initialization function
    lines.push(`let _adapters: LibraryAdapters = {};`);
    lines.push(``);
    lines.push(`export function setAdapters(adapters: LibraryAdapters): void {`);
    lines.push(`  _adapters = adapters;`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`export function getAdapters(): LibraryAdapters {`);
    lines.push(`  return _adapters;`);
    lines.push(`}`);

    return lines.join('\n');
}
