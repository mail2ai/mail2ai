/**
 * Test Scenario Generator Skill
 * 
 * T-DAERA Phase 1: Reconnaissance
 * 
 * Analyzes entry points and generates test scenarios that will exercise
 * the code paths we want to trace. These scenarios are used to capture
 * runtime behavior for smart stub generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    TestScenario,
    ScenarioExpectation,
    AnalysisResult,
    DependencyInfo,
    ExportInfo
} from '../types.js';

// Dynamic import for ts-morph
let Project: any = null;
async function loadTsMorph() {
    if (!Project) {
        const tsMorph = await import('ts-morph');
        Project = tsMorph.Project;
    }
    return Project;
}

/**
 * Hints about how to exercise an entry point.
 */
interface ScenarioHints {
    entryFile: string;
    type: 'server' | 'cli' | 'library' | 'worker' | 'unknown';
    exports: ExportInfo[];
    hasMainFunction: boolean;
    hasDefaultExport: boolean;
    serverPatterns: ServerPattern[];
    cliPatterns: CliPattern[];
    dependencies: string[];
    suggestedCommands: string[];
}

interface ServerPattern {
    method: string;
    port?: number;
    host?: string;
}

interface CliPattern {
    command: string;
    args: string[];
}

/**
 * Analyze an entry point file to generate scenario hints.
 */
export async function analyzeEntryPoint(
    entryFilePath: string,
    projectPath: string,
    analysisResult?: AnalysisResult
): Promise<ScenarioHints> {
    const ProjectClass = await loadTsMorph();
    const project = new ProjectClass({
        tsConfigFilePath: path.join(projectPath, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true
    });

    const absolutePath = path.isAbsolute(entryFilePath)
        ? entryFilePath
        : path.join(projectPath, entryFilePath);

    const sourceFile = project.addSourceFileAtPath(absolutePath);
    const relativePath = path.relative(projectPath, absolutePath);

    const hints: ScenarioHints = {
        entryFile: relativePath,
        type: 'unknown',
        exports: [],
        hasMainFunction: false,
        hasDefaultExport: false,
        serverPatterns: [],
        cliPatterns: [],
        dependencies: [],
        suggestedCommands: []
    };

    // Collect exports
    for (const func of sourceFile.getFunctions()) {
        if (func.isExported()) {
            const name = func.getName() || 'default';
            hints.exports.push({
                name,
                kind: func.isDefaultExport() ? 'default' : 'function',
                isReExport: false
            });
            
            if (/^(main|run|start|init|bootstrap|execute)$/i.test(name)) {
                hints.hasMainFunction = true;
            }
        }
    }

    for (const cls of sourceFile.getClasses()) {
        if (cls.isExported()) {
            const name = cls.getName() || 'default';
            hints.exports.push({
                name,
                kind: cls.isDefaultExport() ? 'default' : 'class',
                isReExport: false
            });
        }
    }

    // Check for default export
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
        hints.hasDefaultExport = true;
    }

    // Analyze source text for patterns
    const sourceText = sourceFile.getFullText();

    // Server patterns
    const serverMatches = [
        ...sourceText.matchAll(/\.listen\s*\(\s*(\d+)?/g),
        ...sourceText.matchAll(/createServer\s*\(/g),
        ...sourceText.matchAll(/new\s+(http|https|express|koa|fastify)/gi),
        ...sourceText.matchAll(/app\.use\s*\(/g)
    ];

    if (serverMatches.length > 0) {
        hints.type = 'server';
        const portMatch = sourceText.match(/(?:PORT|port)\s*[=:]\s*(\d+)/);
        hints.serverPatterns.push({
            method: 'listen',
            port: portMatch ? parseInt(portMatch[1]) : 3000
        });
    }

    // CLI patterns
    const cliMatches = [
        ...sourceText.matchAll(/process\.argv/g),
        ...sourceText.matchAll(/commander|yargs|meow|cac/g),
        ...sourceText.matchAll(/\.command\s*\(/g)
    ];

    if (cliMatches.length > 0 && hints.type === 'unknown') {
        hints.type = 'cli';
        hints.cliPatterns.push({
            command: 'node',
            args: [relativePath]
        });
    }

    // Worker patterns
    const workerMatches = [
        ...sourceText.matchAll(/worker_threads|cluster\.fork|child_process/g)
    ];

    if (workerMatches.length > 0 && hints.type === 'unknown') {
        hints.type = 'worker';
    }

    // If still unknown but has exports, it's a library
    if (hints.type === 'unknown' && hints.exports.length > 0) {
        hints.type = 'library';
    }

    // Generate suggested commands based on type
    hints.suggestedCommands = generateSuggestedCommands(hints, relativePath);

    // Get dependencies from analysis result if available
    if (analysisResult) {
        const depInfo = analysisResult.internalDependencies.find(
            d => d.filePath === absolutePath || d.relativePath === relativePath
        );
        if (depInfo) {
            hints.dependencies = depInfo.imports
                .filter(i => i.isExternal)
                .map(i => i.moduleSpecifier);
        }
    }

    return hints;
}

/**
 * Generate suggested commands based on scenario hints.
 */
function generateSuggestedCommands(hints: ScenarioHints, entryFile: string): string[] {
    const commands: string[] = [];
    const jsEntry = entryFile.replace(/\.tsx?$/, '.js');

    switch (hints.type) {
        case 'server':
            // For servers, start then make a request then stop
            commands.push(`node -e "
                const m = require('./${jsEntry}');
                const server = m.createServer?.() || m.startServer?.() || m.default?.();
                if (server?.listen) {
                    const port = ${hints.serverPatterns[0]?.port || 0};
                    server.listen(port, () => {
                        console.log('Server listening');
                        // Make a test request
                        const http = require('http');
                        http.get('http://localhost:' + (port || server.address?.()?.port || 3000) + '/', (res) => {
                            res.on('data', () => {});
                            res.on('end', () => {
                                server.close?.();
                                process.exit(0);
                            });
                        }).on('error', () => {
                            server.close?.();
                            process.exit(0);
                        });
                        // Timeout fallback
                        setTimeout(() => { server.close?.(); process.exit(0); }, 5000);
                    });
                } else {
                    process.exit(0);
                }
            "`);
            break;

        case 'cli':
            // For CLI tools, run with --help or version
            commands.push(`node ${jsEntry} --help 2>/dev/null || node ${jsEntry} --version 2>/dev/null || node ${jsEntry}`);
            break;

        case 'library':
            // For libraries, import and call main exports
            if (hints.hasMainFunction) {
                commands.push(`node -e "const m = require('./${jsEntry}'); m.main?.() || m.run?.() || m.start?.() || m.init?.()"`);
            } else if (hints.hasDefaultExport) {
                commands.push(`node -e "const m = require('./${jsEntry}'); typeof m.default === 'function' ? m.default() : m.default"`);
            } else {
                // Just require it to trigger module-level code
                commands.push(`node -e "require('./${jsEntry}')"`);
            }
            break;

        case 'worker':
            // Workers are tricky, just require and hope for the best
            commands.push(`node -e "require('./${jsEntry}')"`);
            break;

        default:
            // Unknown type, try various approaches
            commands.push(`node -e "require('./${jsEntry}')"`);
    }

    return commands;
}

/**
 * Generate a test scenario from hints.
 */
export function generateTestScenario(
    hints: ScenarioHints,
    customizations?: Partial<TestScenario>
): TestScenario {
    const scenario: TestScenario = {
        name: `scenario-${path.basename(hints.entryFile, path.extname(hints.entryFile))}`,
        entryFile: hints.entryFile,
        execute: hints.suggestedCommands[0] || `node -e "require('./${hints.entryFile}')"`,
        timeout: hints.type === 'server' ? 10000 : 5000,
        ...customizations
    };

    // Add setup for servers (build if needed)
    if (hints.type === 'server') {
        scenario.setup = ['npm run build 2>/dev/null || tsc 2>/dev/null || true'];
    }

    return scenario;
}

/**
 * Generate test scenarios for all entry points.
 */
export async function generateAllScenarios(
    analysisResult: AnalysisResult,
    projectPath: string
): Promise<TestScenario[]> {
    const scenarios: TestScenario[] = [];

    for (const entryPoint of analysisResult.entryPoints) {
        try {
            const hints = await analyzeEntryPoint(entryPoint, projectPath, analysisResult);
            const scenario = generateTestScenario(hints);
            scenarios.push(scenario);
        } catch (error) {
            console.warn(`  ⚠️  Could not generate scenario for ${entryPoint}:`, error);
        }
    }

    return scenarios;
}

/**
 * Load custom scenarios from a file.
 */
export async function loadCustomScenarios(scenarioPath: string): Promise<TestScenario[]> {
    const content = await fs.promises.readFile(scenarioPath, 'utf-8');
    
    if (scenarioPath.endsWith('.json')) {
        return JSON.parse(content);
    }
    
    if (scenarioPath.endsWith('.yaml') || scenarioPath.endsWith('.yml')) {
        // Basic YAML parsing (for simple cases)
        // In production, use a proper YAML parser
        throw new Error('YAML scenarios not yet supported - please use JSON');
    }

    throw new Error(`Unsupported scenario file format: ${scenarioPath}`);
}

/**
 * Save generated scenarios to a file.
 */
export async function saveScenarios(
    scenarios: TestScenario[],
    outputPath: string
): Promise<void> {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(
        outputPath,
        JSON.stringify(scenarios, null, 2),
        'utf-8'
    );
}

/**
 * Validate that a scenario is well-formed.
 */
export function validateScenario(scenario: TestScenario): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!scenario.name) {
        errors.push('Scenario must have a name');
    }

    if (!scenario.entryFile) {
        errors.push('Scenario must have an entryFile');
    }

    if (!scenario.execute || (Array.isArray(scenario.execute) && scenario.execute.length === 0)) {
        errors.push('Scenario must have at least one execute command');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Create a comprehensive test scenario for a complex entry point.
 * This generates multiple execution paths to capture more behavior.
 */
export async function createComprehensiveScenario(
    entryFilePath: string,
    projectPath: string,
    analysisResult: AnalysisResult
): Promise<TestScenario[]> {
    const hints = await analyzeEntryPoint(entryFilePath, projectPath, analysisResult);
    const scenarios: TestScenario[] = [];
    const baseName = path.basename(entryFilePath, path.extname(entryFilePath));

    // Basic scenario
    scenarios.push(generateTestScenario(hints, { name: `${baseName}-basic` }));

    // If it's a library with multiple exports, create scenarios for each
    if (hints.type === 'library' && hints.exports.length > 1) {
        const jsEntry = entryFilePath.replace(/\.tsx?$/, '.js');
        
        for (const exp of hints.exports.slice(0, 5)) { // Limit to first 5
            if (exp.kind === 'function') {
                scenarios.push({
                    name: `${baseName}-${exp.name}`,
                    entryFile: entryFilePath,
                    execute: `node -e "const m = require('./${jsEntry}'); m.${exp.name}?.() || console.log('${exp.name} not callable')"`,
                    timeout: 5000
                });
            }
        }
    }

    // For servers, add scenario that makes actual HTTP requests
    if (hints.type === 'server' && hints.serverPatterns.length > 0) {
        const port = hints.serverPatterns[0].port || 3000;
        scenarios.push({
            name: `${baseName}-http-test`,
            entryFile: entryFilePath,
            setup: ['npm run build 2>/dev/null || true'],
            execute: [
                `node dist/${entryFilePath.replace(/\.tsx?$/, '.js')} &`,
                'sleep 2',
                `curl -s http://localhost:${port}/ || true`,
                `curl -s http://localhost:${port}/api/health || true`,
                'kill %1 2>/dev/null || true'
            ],
            timeout: 15000
        });
    }

    return scenarios;
}

export default {
    analyzeEntryPoint,
    generateTestScenario,
    generateAllScenarios,
    loadCustomScenarios,
    saveScenarios,
    validateScenario,
    createComprehensiveScenario
};
