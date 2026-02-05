/**
 * AI Agent using @github/copilot-sdk for intelligent module extraction.
 * 
 * This agent uses the Copilot SDK to orchestrate the extraction workflow,
 * making intelligent decisions about which files to include and how to
 * structure the output library.
 */

import type { AnalysisInput, MigrationResult, AnalysisResult, SkillContext } from './types.js';
import type { CopilotClient, CopilotSession, defineTool } from '@github/copilot-sdk';
import * as path from 'path';
import * as fs from 'fs';
import { Logger, LogLevel } from './logger.js';

// Type for the SDK module
type CopilotSDKType = {
    CopilotClient: typeof CopilotClient;
    CopilotSession: typeof CopilotSession;
    defineTool: typeof defineTool;
};

// Dynamic import for Copilot SDK
let CopilotSDK: CopilotSDKType | null = null;

async function loadCopilotSDK(): Promise<CopilotSDKType | null> {
    if (CopilotSDK) return CopilotSDK;
    try {
        const sdk = await import('@github/copilot-sdk');
        CopilotSDK = sdk as CopilotSDKType;
        return CopilotSDK;
    } catch {
        return null;
    }
}

// Load skills dynamically
const loadSkills = async () => ({
    analyzeProjectDependencies: (await import('./skills/analyze-dependencies.js')).analyzeProjectDependencies,
    extractAndMigrateCode: (await import('./skills/migrate-code.js')).extractAndMigrateCode,
    refactorImportPaths: (await import('./skills/refactor-paths.js')).refactorImportPaths,
    generateLibPackageJson: (await import('./skills/generate-package.js')).generateLibPackageJson,
    buildAndValidateLib: (await import('./skills/build-validate.js')).buildAndValidateLib
});

export interface AgentTool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string; items?: { type: string } }>;
        required: string[];
    };
}

export interface AgentConfig {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    verbose?: boolean;
}

/**
 * Create tool definitions for the Copilot SDK agent.
 */
function createToolDefinitions(): AgentTool[] {
    return [
        {
            name: 'analyze_project',
            description: 'Analyze a TypeScript project to identify module entry points and all their dependencies. This uses ts-morph to traverse the AST and build a complete dependency graph.',
            parameters: {
                type: 'object',
                properties: {
                    projectPath: { type: 'string', description: 'Absolute path to the project root' },
                    moduleDescription: { type: 'string', description: 'Description of the module to extract' },
                    directories: { type: 'array', items: { type: 'string' }, description: 'Directories to search (relative to project)' }
                },
                required: ['projectPath', 'moduleDescription']
            }
        },
        {
            name: 'migrate_code',
            description: 'Copy identified source files to the new library location while preserving directory structure.',
            parameters: {
                type: 'object',
                properties: {
                    outputPath: { type: 'string', description: 'Target path for the new library' }
                },
                required: ['outputPath']
            }
        },
        {
            name: 'refactor_imports',
            description: 'Rewrite import/export paths in migrated files to use correct relative paths, handling path aliases like @/...',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the migrated library' }
                },
                required: ['libPath']
            }
        },
        {
            name: 'generate_package',
            description: 'Generate package.json and tsconfig.json for the new library based on detected dependencies.',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the library' },
                    libName: { type: 'string', description: 'Name for the library package' }
                },
                required: ['libPath', 'libName']
            }
        },
        {
            name: 'build_and_validate',
            description: 'Install dependencies, compile TypeScript, and validate the library builds correctly.',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the library' }
                },
                required: ['libPath']
            }
        }
    ];
}

/**
 * Agent class that uses @github/copilot-sdk for intelligent orchestration.
 */
export class AnalysisAgent {
    private logger: Logger;
    private config: AgentConfig;
    private context: SkillContext | null = null;
    private analysisResult: AnalysisResult | null = null;

    constructor(config: AgentConfig = {}) {
        this.config = {
            model: config.model || 'gpt-5-mini',
            maxTokens: config.maxTokens || 4096,
            temperature: config.temperature || 0.1,
            verbose: config.verbose ?? true
        };
        this.logger = new Logger({
            level: config.verbose ? LogLevel.DEBUG : LogLevel.INFO,
            prefix: '[AnalysisAgent]'
        });
    }

    /**
     * Run the extraction workflow using the Copilot SDK.
     */
    async run(input: AnalysisInput): Promise<MigrationResult> {
        const startTime = Date.now();
        this.logger.info('Starting module extraction...');
        this.logger.debug('Input:', JSON.stringify(input, null, 2));

        const sdk = await loadCopilotSDK();
        const skills = await loadSkills();

        const libsDir = path.resolve(input.projectPath, '..', 'libs');
        const libName = input.outputLibName || `browser-lib-${Date.now()}`;
        const outputPath = path.join(libsDir, libName);

        this.context = {
            projectPath: input.projectPath,
            moduleDescription: input.moduleDescription
        };

        try {
            // Ensure libs directory exists
            await fs.promises.mkdir(libsDir, { recursive: true });

            if (sdk) {
                // Use Copilot SDK for intelligent orchestration
                return await this.runWithCopilotSDK(sdk, input, skills, outputPath, libName);
            } else {
                // Fallback to direct skill execution
                this.logger.warn('Copilot SDK not available, using direct skill execution');
                return await this.runDirectExecution(input, skills, outputPath, libName);
            }
        } catch (error) {
            this.logger.error('Error during extraction:', error);
            return {
                success: false,
                libPath: outputPath,
                migratedFiles: [],
                errors: [{
                    file: '',
                    error: error instanceof Error ? error.message : String(error),
                    phase: 'analysis'
                }]
            };
        } finally {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            this.logger.info(`Extraction completed in ${duration}s`);
            this.logger.saveToFile(path.join(outputPath, 'extraction.log'));
        }
    }

    /**
     * Run extraction using the Copilot SDK for AI-assisted orchestration.
     * Uses the CopilotClient and CopilotSession for tool-based execution.
     */
    private async runWithCopilotSDK(
        sdk: CopilotSDKType,
        input: AnalysisInput,
        skills: Awaited<ReturnType<typeof loadSkills>>,
        outputPath: string,
        libName: string
    ): Promise<MigrationResult> {
        this.logger.info('Using Copilot SDK with model:', this.config.model);

        let client: InstanceType<typeof sdk.CopilotClient> | null = null;
        let session: InstanceType<typeof sdk.CopilotSession> | null = null;

        try {
            // Create the Copilot client
            client = new sdk.CopilotClient();

            // Create tools with handlers
            const tools = this.createTools(sdk, skills, input, outputPath, libName);

            // Create a session with the specified model and tools
            session = await client.createSession({
                model: this.config.model || 'gpt-5-mini',
                tools: tools,
                systemMessage: {
                    mode: 'append',
                    content: this.buildSystemPrompt(input)
                }
            });

            // Set up event handler for logging
            session.on('assistant.message', (event) => {
                this.logger.debug('Assistant:', event.data.content);
            });

            const userMessage = this.buildUserMessage(input, outputPath, libName);

            // Send the message and wait for completion
            await session.sendAndWait({
                prompt: userMessage
            });

            // After SDK execution, ensure build and validate runs
            const finalResult = await skills.buildAndValidateLib(outputPath);
            this.context!.migrationResult = finalResult;
            return finalResult;

        } catch (error) {
            this.logger.error('Copilot SDK error, falling back to direct execution:', error);
            return await this.runDirectExecution(input, skills, outputPath, libName);
        } finally {
            // Clean up session and client
            if (session) {
                try {
                    await session.destroy();
                } catch {
                    // Ignore cleanup errors
                }
            }
            if (client) {
                try {
                    await client.stop();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * Create tools array for the Copilot SDK session.
     */
    private createTools(
        sdk: CopilotSDKType,
        skills: Awaited<ReturnType<typeof loadSkills>>,
        input: AnalysisInput,
        outputPath: string,
        libName: string
    ): ReturnType<typeof sdk.defineTool>[] {
        const createHandler = (name: string) => async (args: unknown): Promise<unknown> => {
            this.logger.debug(`Tool call: ${name}`, args);
            const argsObj = args as Record<string, unknown>;

            try {
                switch (name) {
                    case 'analyze_project': {
                        this.logger.step('Analyzing project dependencies...');
                        const analysisInput: AnalysisInput = {
                            projectPath: argsObj.projectPath as string || input.projectPath,
                            moduleDescription: argsObj.moduleDescription as string || input.moduleDescription,
                            directories: argsObj.directories as string[] || input.directories,
                            entryFiles: input.entryFiles
                        };
                        this.analysisResult = await skills.analyzeProjectDependencies(analysisInput);
                        this.logger.info(`Found ${this.analysisResult.entryPoints.length} entry points`);
                        this.logger.info(`Found ${this.analysisResult.internalDependencies.length} internal files`);
                        this.logger.info(`Found ${this.analysisResult.externalDependencies.length} external dependencies`);
                        return {
                            entryPointCount: this.analysisResult.entryPoints.length,
                            internalFileCount: this.analysisResult.internalDependencies.length,
                            externalDependencies: this.analysisResult.externalDependencies
                        };
                    }

                    case 'migrate_code': {
                        if (!this.analysisResult) {
                            throw new Error('Must run analyze_project first');
                        }
                        this.logger.step('Migrating code files...');
                        const migrationProgress = await skills.extractAndMigrateCode(
                            this.analysisResult,
                            argsObj.outputPath as string || outputPath
                        );
                        this.logger.info(`Copied ${migrationProgress.copiedFiles.length} files`);
                        return migrationProgress;
                    }

                    case 'refactor_imports': {
                        this.logger.step('Refactoring import paths...');
                        const refactorResult = await skills.refactorImportPaths(
                            argsObj.libPath as string || outputPath
                        );
                        this.logger.info(`Modified ${refactorResult.modifiedFiles.length} files`);
                        return refactorResult;
                    }

                    case 'generate_package': {
                        this.logger.step('Generating package.json...');
                        const externalDeps = this.analysisResult?.externalDependencies || [];
                        const packageResult = await skills.generateLibPackageJson(
                            argsObj.libPath as string || outputPath,
                            argsObj.libName as string || libName,
                            externalDeps
                        );
                        this.logger.info(`Created: ${packageResult.packageJsonPath}`);
                        return packageResult;
                    }

                    case 'build_and_validate': {
                        this.logger.step('Building and validating...');
                        const buildResult = await skills.buildAndValidateLib(
                            argsObj.libPath as string || outputPath
                        );
                        return buildResult;
                    }

                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                this.logger.error(`Tool ${name} failed:`, error);
                throw error;
            }
        };

        return [
            sdk.defineTool('analyze_project', {
                description: 'Analyze a TypeScript project to identify module entry points and all their dependencies using ts-morph AST traversal.',
                parameters: {
                    type: 'object',
                    properties: {
                        projectPath: { type: 'string', description: 'Absolute path to the project root' },
                        moduleDescription: { type: 'string', description: 'Description of the module to extract' },
                        directories: { type: 'array', items: { type: 'string' }, description: 'Directories to search (relative to project)' }
                    },
                    required: ['projectPath', 'moduleDescription']
                },
                handler: createHandler('analyze_project')
            }),
            sdk.defineTool('migrate_code', {
                description: 'Copy identified source files to the new library location while preserving directory structure.',
                parameters: {
                    type: 'object',
                    properties: {
                        outputPath: { type: 'string', description: 'Target path for the new library' }
                    },
                    required: ['outputPath']
                },
                handler: createHandler('migrate_code')
            }),
            sdk.defineTool('refactor_imports', {
                description: 'Rewrite import/export paths in migrated files to use correct relative paths, handling path aliases like @/...',
                parameters: {
                    type: 'object',
                    properties: {
                        libPath: { type: 'string', description: 'Path to the migrated library' }
                    },
                    required: ['libPath']
                },
                handler: createHandler('refactor_imports')
            }),
            sdk.defineTool('generate_package', {
                description: 'Generate package.json and tsconfig.json for the new library based on detected dependencies.',
                parameters: {
                    type: 'object',
                    properties: {
                        libPath: { type: 'string', description: 'Path to the library' },
                        libName: { type: 'string', description: 'Name for the library package' }
                    },
                    required: ['libPath', 'libName']
                },
                handler: createHandler('generate_package')
            }),
            sdk.defineTool('build_and_validate', {
                description: 'Install dependencies, compile TypeScript, and validate the library builds correctly.',
                parameters: {
                    type: 'object',
                    properties: {
                        libPath: { type: 'string', description: 'Path to the library' }
                    },
                    required: ['libPath']
                },
                handler: createHandler('build_and_validate')
            })
        ];
    }

    /**
     * Build the user message for the extraction task.
     */
    private buildUserMessage(input: AnalysisInput, outputPath: string, libName: string): string {
        return `Extract the browser module from the project at "${input.projectPath}".
            
Module description: ${input.moduleDescription}

${input.directories ? `Directories to search: ${input.directories.join(', ')}` : ''}
${input.entryFiles ? `Entry files: ${input.entryFiles.join(', ')}` : ''}

Output library name: ${libName}
Output path: ${outputPath}

Please execute the extraction workflow step by step:
1. First analyze the project to identify all files needed
2. Migrate the code files to the new library location
3. Refactor import paths
4. Generate package.json
5. Build and validate the library

Report any errors you encounter.`;
    }

    /**
     * Run extraction with direct skill execution (fallback when SDK unavailable).
     */
    private async runDirectExecution(
        input: AnalysisInput,
        skills: Awaited<ReturnType<typeof loadSkills>>,
        outputPath: string,
        libName: string
    ): Promise<MigrationResult> {
        this.logger.info('Running direct skill execution...');

        // Step 1: Analyze dependencies
        this.logger.step('Step 1: Analyzing project dependencies...');
        const analysisResult = await skills.analyzeProjectDependencies(input);
        this.analysisResult = analysisResult;
        this.context!.analysisResult = analysisResult;

        this.logger.info(`   Found ${analysisResult.entryPoints.length} entry points`);
        this.logger.info(`   Found ${analysisResult.internalDependencies.length} internal files`);
        this.logger.info(`   Found ${analysisResult.externalDependencies.length} external dependencies`);

        // Step 2: Migrate code
        this.logger.step('Step 2: Migrating code files...');
        const migrationProgress = await skills.extractAndMigrateCode(analysisResult, outputPath);
        this.logger.info(`   Copied ${migrationProgress.copiedFiles.length} files`);

        // Step 3: Refactor imports
        this.logger.step('Step 3: Refactoring import paths...');
        const refactorResult = await skills.refactorImportPaths(outputPath);
        this.logger.info(`   Modified ${refactorResult.modifiedFiles.length} files`);

        // Step 4: Generate package.json
        this.logger.step('Step 4: Generating package.json...');
        const packageResult = await skills.generateLibPackageJson(
            outputPath,
            libName,
            analysisResult.externalDependencies
        );
        this.logger.info(`   Created: ${packageResult.packageJsonPath}`);

        // Step 5: Build and validate
        this.logger.step('Step 5: Building and validating...');
        const buildResult = await skills.buildAndValidateLib(outputPath);
        this.context!.migrationResult = buildResult;

        return buildResult;
    }

    /**
     * Build the system prompt for the Copilot SDK agent.
     */
    private buildSystemPrompt(input: AnalysisInput): string {
        return `You are an expert TypeScript module extraction agent. Your task is to extract a module from a TypeScript project into an independent, reusable library.

## Available Tools

1. **analyze_project**: Analyze the project to identify all files that need to be extracted. This uses ts-morph to build a complete dependency graph.

2. **migrate_code**: Copy the identified files to the new library location while preserving directory structure.

3. **refactor_imports**: Rewrite all import/export paths to work in the new location. This handles:
   - Relative imports (./foo, ../bar)
   - Path aliases (@/foo → relative path)
   - ESM .js extensions

4. **generate_package**: Create package.json with the correct dependencies based on what was detected during analysis.

5. **build_and_validate**: Run npm install and TypeScript compilation to verify everything works.

## Workflow

Execute these tools in order:
1. analyze_project - to identify what to extract
2. migrate_code - to copy files
3. refactor_imports - to fix paths
4. generate_package - to create package.json
5. build_and_validate - to verify it compiles

## Current Task

Extract module: ${input.moduleDescription}
From project: ${input.projectPath}
${input.directories ? `Directories: ${input.directories.join(', ')}` : ''}

Report progress and any errors encountered.`;
    }

    /**
     * Get the analysis result for inspection.
     */
    getAnalysisResult(): AnalysisResult | null {
        return this.analysisResult;
    }

    /**
     * Get the logger for accessing logs.
     */
    getLogger(): Logger {
        return this.logger;
    }
}

export default AnalysisAgent;
