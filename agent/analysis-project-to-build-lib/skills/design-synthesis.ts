/**
 * Design Synthesis Skill (v3.0)
 * 
 * Generates architecture artifacts before code extraction:
 * - Class/module diagrams (Mermaid)
 * - Dependency graphs
 * - Sequence diagrams
 * - Data flow diagrams
 * - Cross-boundary dependency analysis
 * 
 * Part of the Design-Driven Closed-Loop Refactoring architecture.
 */

import { Project, SourceFile, SyntaxKind, Node, ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, TypeAliasDeclaration } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import type { 
    AnalysisResult, 
    ArchitectureArtifacts, 
    CrossBoundaryDependency,
    LibraryInterface,
    TypeExport,
    FunctionExport,
    ClassExport
} from '../types.js';

/**
 * Generate architecture artifacts from analysis results.
 */
export async function generateArchitectureArtifacts(
    analysisResult: AnalysisResult,
    projectPath: string,
    outputPath: string
): Promise<ArchitectureArtifacts> {
    const project = new Project({
        tsConfigFilePath: path.join(projectPath, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true
    });

    // Add analyzed files to the project
    const filePaths = analysisResult.internalDependencies.map(d => d.filePath);
    for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
            project.addSourceFileAtPath(filePath);
        }
    }

    // Generate class diagram
    const classDiagram = generateClassDiagram(project, analysisResult);
    
    // Generate dependency graph
    const dependencyGraph = generateDependencyGraph(analysisResult);
    
    // Identify cross-boundary dependencies
    const crossBoundaryDeps = identifyCrossBoundaryDeps(analysisResult);
    
    // Generate sequence diagram for main entry points
    const sequenceDiagram = generateSequenceDiagram(project, analysisResult);
    
    // Generate data flow diagram
    const dataFlowDiagram = generateDataFlowDiagram(analysisResult);

    // Create documentation
    const docsDir = path.join(outputPath, 'docs');
    await fs.promises.mkdir(docsDir, { recursive: true });
    
    const architectureMd = generateArchitectureDoc(
        classDiagram,
        dependencyGraph,
        sequenceDiagram,
        dataFlowDiagram,
        crossBoundaryDeps
    );
    
    const documentationPath = path.join(docsDir, 'ARCHITECTURE.md');
    await fs.promises.writeFile(documentationPath, architectureMd);

    return {
        classDiagram,
        dependencyGraph,
        sequenceDiagram,
        dataFlowDiagram,
        documentationPath,
        crossBoundaryDeps
    };
}

/**
 * Generate Mermaid class diagram from TypeScript classes.
 */
function generateClassDiagram(project: Project, analysisResult: AnalysisResult): string {
    const lines: string[] = ['classDiagram'];
    const classes: Map<string, { methods: string[], properties: string[], deps: string[] }> = new Map();
    
    for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();
        const relativePath = path.basename(filePath, path.extname(filePath));
        
        // Find all classes
        const classDecls = sourceFile.getClasses();
        for (const classDecl of classDecls) {
            const className = classDecl.getName() || 'Anonymous';
            const methods: string[] = [];
            const properties: string[] = [];
            const deps: string[] = [];
            
            // Get methods
            for (const method of classDecl.getMethods()) {
                const visibility = method.getScope() === 'private' ? '-' : 
                                   method.getScope() === 'protected' ? '#' : '+';
                const isAsync = method.isAsync() ? '«async»' : '';
                methods.push(`${visibility}${method.getName()}()${isAsync}`);
            }
            
            // Get properties
            for (const prop of classDecl.getProperties()) {
                const visibility = prop.getScope() === 'private' ? '-' : 
                                   prop.getScope() === 'protected' ? '#' : '+';
                const type = prop.getType().getText().substring(0, 20);
                properties.push(`${visibility}${prop.getName()} : ${type}`);
            }
            
            // Find dependencies (imports used in class)
            const imports = sourceFile.getImportDeclarations();
            for (const imp of imports) {
                const moduleSpec = imp.getModuleSpecifierValue();
                if (!moduleSpec.startsWith('@') && !moduleSpec.includes('node_modules')) {
                    const importedName = path.basename(moduleSpec).replace(/\.(js|ts)$/, '');
                    deps.push(importedName);
                }
            }
            
            classes.set(className, { methods, properties, deps });
        }
        
        // Also track interfaces
        const interfaces = sourceFile.getInterfaces();
        for (const iface of interfaces) {
            const name = iface.getName();
            const methods: string[] = [];
            
            for (const method of iface.getMethods()) {
                methods.push(`+${method.getName()}()`);
            }
            
            lines.push(`    class ${name} {`);
            lines.push(`        <<interface>>`);
            for (const m of methods.slice(0, 5)) {
                lines.push(`        ${m}`);
            }
            lines.push(`    }`);
        }
    }
    
    // Add classes to diagram
    for (const [className, info] of classes) {
        lines.push(`    class ${className} {`);
        for (const prop of info.properties.slice(0, 5)) {
            lines.push(`        ${prop}`);
        }
        for (const method of info.methods.slice(0, 8)) {
            lines.push(`        ${method}`);
        }
        lines.push(`    }`);
        
        // Add dependencies
        for (const dep of info.deps) {
            if (classes.has(dep) || project.getSourceFiles().some(sf => 
                sf.getClasses().some(c => c.getName() === dep)
            )) {
                lines.push(`    ${className} --> ${dep}`);
            }
        }
    }
    
    return lines.join('\n');
}

/**
 * Generate Mermaid dependency graph.
 */
function generateDependencyGraph(analysisResult: AnalysisResult): string {
    const lines: string[] = ['graph TD'];
    const seen = new Set<string>();
    
    // Group files by directory
    const dirGroups: Map<string, string[]> = new Map();
    
    for (const [file, deps] of analysisResult.fileGraph) {
        const dir = path.dirname(file).split('/').slice(-2).join('/');
        if (!dirGroups.has(dir)) {
            dirGroups.set(dir, []);
        }
        dirGroups.get(dir)!.push(path.basename(file));
    }
    
    // Add subgraphs for directories
    let subgraphId = 0;
    for (const [dir, files] of dirGroups) {
        const safeName = dir.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`    subgraph ${safeName}["${dir}"]`);
        for (const file of files.slice(0, 10)) {
            const nodeId = file.replace(/[^a-zA-Z0-9]/g, '_');
            lines.push(`        ${nodeId}["${file}"]`);
        }
        lines.push(`    end`);
        subgraphId++;
    }
    
    // Add edges for dependencies
    for (const [file, deps] of analysisResult.fileGraph) {
        const sourceId = path.basename(file).replace(/[^a-zA-Z0-9]/g, '_');
        for (const dep of deps.slice(0, 5)) {
            const targetId = path.basename(dep).replace(/[^a-zA-Z0-9]/g, '_');
            const edgeKey = `${sourceId}->${targetId}`;
            if (!seen.has(edgeKey) && sourceId !== targetId) {
                lines.push(`    ${sourceId} --> ${targetId}`);
                seen.add(edgeKey);
            }
        }
    }
    
    // Add external dependencies
    lines.push(`    subgraph External["External Dependencies"]`);
    for (const ext of analysisResult.externalDependencies.slice(0, 10)) {
        const nodeId = ext.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`        ${nodeId}["${ext}"]:::external`);
    }
    lines.push(`    end`);
    
    lines.push(`    classDef external fill:#f9f,stroke:#333`);
    
    return lines.join('\n');
}

/**
 * Identify cross-boundary dependencies.
 */
function identifyCrossBoundaryDeps(analysisResult: AnalysisResult): CrossBoundaryDependency[] {
    const crossBoundary: Map<string, CrossBoundaryDependency> = new Map();
    
    for (const dep of analysisResult.internalDependencies) {
        const sourceDir = path.dirname(dep.relativePath).split('/')[1] || 'root';
        
        for (const imp of dep.imports) {
            if (imp.isExternal) continue;
            
            const targetPath = imp.resolvedPath || imp.moduleSpecifier;
            const targetDir = path.dirname(targetPath).split('/')[1] || 'root';
            
            if (sourceDir !== targetDir && !imp.moduleSpecifier.startsWith('.')) {
                const key = `${sourceDir}->${targetDir}:${imp.moduleSpecifier}`;
                
                if (!crossBoundary.has(key)) {
                    crossBoundary.set(key, {
                        sourceModule: sourceDir,
                        targetModule: targetDir,
                        importPath: imp.moduleSpecifier,
                        usageCount: 0,
                        usedSymbols: []
                    });
                }
                
                const cb = crossBoundary.get(key)!;
                cb.usageCount++;
                cb.usedSymbols.push(...imp.namedImports);
            }
        }
    }
    
    // Also add missing dependencies as cross-boundary
    if (analysisResult.missingDependencies) {
        for (const missing of analysisResult.missingDependencies) {
            const targetDir = missing.directory.split('/')[1] || missing.directory;
            
            for (const refBy of missing.referencedBy) {
                const sourceDir = path.dirname(refBy).split('/')[1] || 'root';
                const key = `${sourceDir}->${targetDir}:${missing.importSpecifiers[0] || missing.relativePath}`;
                
                if (!crossBoundary.has(key)) {
                    crossBoundary.set(key, {
                        sourceModule: sourceDir,
                        targetModule: targetDir,
                        importPath: missing.importSpecifiers[0] || missing.relativePath,
                        usageCount: missing.referencedBy.length,
                        usedSymbols: []
                    });
                }
            }
        }
    }
    
    return Array.from(crossBoundary.values())
        .sort((a, b) => b.usageCount - a.usageCount);
}

/**
 * Generate sequence diagram for main entry points.
 */
function generateSequenceDiagram(project: Project, analysisResult: AnalysisResult): string {
    const lines: string[] = ['sequenceDiagram'];
    const participants = new Set<string>();
    const calls: string[] = [];
    
    // Find entry points and trace their main calls
    for (const entryPoint of analysisResult.entryPoints.slice(0, 3)) {
        const sourceFile = project.getSourceFile(entryPoint);
        if (!sourceFile) continue;
        
        const fileName = path.basename(entryPoint, path.extname(entryPoint));
        participants.add(fileName);
        
        // Find main function calls
        sourceFile.forEachDescendant((node) => {
            if (Node.isCallExpression(node)) {
                const expr = node.getExpression();
                let target = '';
                
                if (Node.isPropertyAccessExpression(expr)) {
                    target = expr.getName();
                } else if (Node.isIdentifier(expr)) {
                    target = expr.getText();
                }
                
                if (target && target.length > 0 && target.length < 30) {
                    participants.add(target);
                    calls.push(`    ${fileName}->>+${target}: ${target}()`);
                }
            }
        });
    }
    
    // Add participants
    for (const p of Array.from(participants).slice(0, 10)) {
        lines.push(`    participant ${p}`);
    }
    
    // Add calls
    lines.push(...calls.slice(0, 20));
    
    return lines.join('\n');
}

/**
 * Generate data flow diagram.
 */
function generateDataFlowDiagram(analysisResult: AnalysisResult): string {
    const lines: string[] = ['flowchart LR'];
    
    // Create nodes for main modules
    const modules = new Set<string>();
    
    for (const dep of analysisResult.internalDependencies) {
        const module = path.dirname(dep.relativePath).split('/').slice(0, 2).join('/');
        modules.add(module);
    }
    
    // Create subgraphs
    lines.push(`    subgraph Input["Input Sources"]`);
    lines.push(`        User["User Request"]`);
    lines.push(`        Config["Configuration"]`);
    lines.push(`    end`);
    
    lines.push(`    subgraph Core["Core Processing"]`);
    for (const mod of Array.from(modules).slice(0, 5)) {
        const safeName = mod.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`        ${safeName}["${mod}"]`);
    }
    lines.push(`    end`);
    
    lines.push(`    subgraph Output["Output"]`);
    lines.push(`        Result["Result"]`);
    lines.push(`        Logs["Logs"]`);
    lines.push(`    end`);
    
    // Add flow connections
    lines.push(`    User --> Core`);
    lines.push(`    Config --> Core`);
    lines.push(`    Core --> Result`);
    lines.push(`    Core --> Logs`);
    
    return lines.join('\n');
}

/**
 * Generate architecture documentation.
 */
function generateArchitectureDoc(
    classDiagram: string,
    dependencyGraph: string,
    sequenceDiagram: string | undefined,
    dataFlowDiagram: string | undefined,
    crossBoundaryDeps: CrossBoundaryDependency[]
): string {
    const lines: string[] = [
        '# Library Architecture Documentation',
        '',
        '*Auto-generated by Analysis Agent v3.0*',
        '',
        '## Module Dependency Graph',
        '',
        '```mermaid',
        dependencyGraph,
        '```',
        '',
        '## Class Diagram',
        '',
        '```mermaid',
        classDiagram,
        '```',
        ''
    ];
    
    if (sequenceDiagram) {
        lines.push(
            '## Sequence Diagram (Main Flows)',
            '',
            '```mermaid',
            sequenceDiagram,
            '```',
            ''
        );
    }
    
    if (dataFlowDiagram) {
        lines.push(
            '## Data Flow',
            '',
            '```mermaid',
            dataFlowDiagram,
            '```',
            ''
        );
    }
    
    if (crossBoundaryDeps.length > 0) {
        lines.push(
            '## Cross-Boundary Dependencies',
            '',
            'These imports cross module boundaries and may need stubs:',
            '',
            '| Source | Target | Import | Usage Count | Symbols |',
            '|--------|--------|--------|-------------|---------|'
        );
        
        for (const dep of crossBoundaryDeps.slice(0, 20)) {
            lines.push(
                `| ${dep.sourceModule} | ${dep.targetModule} | \`${dep.importPath}\` | ${dep.usageCount} | ${dep.usedSymbols.slice(0, 3).join(', ')} |`
            );
        }
        lines.push('');
    }
    
    return lines.join('\n');
}

/**
 * Define the public library interface.
 */
export async function defineLibraryInterface(
    analysisResult: AnalysisResult,
    projectPath: string,
    libName: string
): Promise<LibraryInterface> {
    const project = new Project({
        tsConfigFilePath: path.join(projectPath, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true
    });

    // Add entry point files
    for (const entryPoint of analysisResult.entryPoints) {
        if (fs.existsSync(entryPoint)) {
            project.addSourceFileAtPath(entryPoint);
        }
    }

    const types: TypeExport[] = [];
    const functions: FunctionExport[] = [];
    const classes: ClassExport[] = [];
    const reExports: string[] = [];

    for (const sourceFile of project.getSourceFiles()) {
        const relativePath = path.relative(projectPath, sourceFile.getFilePath());
        
        // Collect exported items
        for (const exp of sourceFile.getExportedDeclarations()) {
            const [name, decls] = exp;
            for (const decl of decls) {
                if (Node.isClassDeclaration(decl)) {
                    const methods = (decl as ClassDeclaration).getMethods()
                        .map(m => m.getName());
                    classes.push({
                        name,
                        methods,
                        sourceFile: relativePath,
                        isPublic: true
                    });
                } else if (Node.isFunctionDeclaration(decl)) {
                    const fn = decl as FunctionDeclaration;
                    functions.push({
                        name,
                        signature: fn.getSignature()?.getDeclaration().getText() || `function ${name}()`,
                        sourceFile: relativePath,
                        isAsync: fn.isAsync(),
                        isPublic: true
                    });
                } else if (Node.isInterfaceDeclaration(decl)) {
                    types.push({
                        name,
                        kind: 'interface',
                        sourceFile: relativePath,
                        isPublic: true
                    });
                } else if (Node.isTypeAliasDeclaration(decl)) {
                    types.push({
                        name,
                        kind: 'type',
                        sourceFile: relativePath,
                        isPublic: true
                    });
                }
            }
        }
        
        // Collect re-exports
        for (const exp of sourceFile.getExportDeclarations()) {
            const moduleSpec = exp.getModuleSpecifierValue();
            if (moduleSpec) {
                reExports.push(moduleSpec);
            }
        }
    }

    // Generate index.ts content
    const indexContent = generateIndexContent(types, functions, classes, reExports);
    
    // Generate index.d.ts content
    const dtsContent = generateDtsContent(types, functions, classes);

    return {
        name: libName,
        types,
        functions,
        classes,
        reExports,
        indexContent,
        dtsContent
    };
}

/**
 * Generate index.ts content from exports.
 */
function generateIndexContent(
    types: TypeExport[],
    functions: FunctionExport[],
    classes: ClassExport[],
    reExports: string[]
): string {
    const lines: string[] = [
        '/**',
        ' * Library Public API',
        ' * Auto-generated by Analysis Agent v3.0',
        ' */',
        ''
    ];

    // Group by source file
    const byFile: Map<string, { types: string[], functions: string[], classes: string[] }> = new Map();
    
    for (const t of types) {
        if (!byFile.has(t.sourceFile)) {
            byFile.set(t.sourceFile, { types: [], functions: [], classes: [] });
        }
        byFile.get(t.sourceFile)!.types.push(t.name);
    }
    
    for (const f of functions) {
        if (!byFile.has(f.sourceFile)) {
            byFile.set(f.sourceFile, { types: [], functions: [], classes: [] });
        }
        byFile.get(f.sourceFile)!.functions.push(f.name);
    }
    
    for (const c of classes) {
        if (!byFile.has(c.sourceFile)) {
            byFile.set(c.sourceFile, { types: [], functions: [], classes: [] });
        }
        byFile.get(c.sourceFile)!.classes.push(c.name);
    }

    for (const [file, exports] of byFile) {
        // The file path may have 'src/' prefix but index.ts is in src/, so we need to remove it
        let importPath = file.replace(/\.tsx?$/, '.js');
        // Remove leading 'src/' since index.ts is in src/
        importPath = importPath.replace(/^src\//, '');
        importPath = './' + importPath;
        
        const allExports = [...exports.types, ...exports.functions, ...exports.classes];
        
        if (allExports.length > 0) {
            lines.push(`export { ${allExports.join(', ')} } from '${importPath}';`);
        }
    }

    for (const reExp of reExports) {
        lines.push(`export * from '${reExp}';`);
    }

    return lines.join('\n');
}

/**
 * Generate index.d.ts content.
 */
function generateDtsContent(
    types: TypeExport[],
    functions: FunctionExport[],
    classes: ClassExport[]
): string {
    const lines: string[] = [
        '/**',
        ' * Library Type Definitions',
        ' * Auto-generated by Analysis Agent v3.0',
        ' */',
        ''
    ];

    for (const t of types) {
        lines.push(`export { ${t.name} } from './${t.sourceFile.replace(/\.tsx?$/, '')}';`);
    }

    for (const f of functions) {
        lines.push(`export { ${f.name} } from './${f.sourceFile.replace(/\.tsx?$/, '')}';`);
    }

    for (const c of classes) {
        lines.push(`export { ${c.name} } from './${c.sourceFile.replace(/\.tsx?$/, '')}';`);
    }

    return lines.join('\n');
}

/**
 * Write the library interface files.
 */
export async function writeLibraryInterface(
    libraryInterface: LibraryInterface,
    outputPath: string
): Promise<void> {
    const srcDir = path.join(outputPath, 'src');
    await fs.promises.mkdir(srcDir, { recursive: true });
    
    // Write index.ts
    await fs.promises.writeFile(
        path.join(srcDir, 'index.ts'),
        libraryInterface.indexContent
    );
    
    // Write index.d.ts (if different from generated)
    if (libraryInterface.dtsContent) {
        await fs.promises.writeFile(
            path.join(outputPath, 'index.d.ts'),
            libraryInterface.dtsContent
        );
    }
}
