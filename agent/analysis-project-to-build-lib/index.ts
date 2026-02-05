/**
 * Analysis Agent for extracting TypeScript modules into independent libraries.
 * 
 * This agent uses ts-morph for code analysis and can integrate with
 * @github/copilot-sdk for AI-assisted decision making.
 */

import * as path from 'path';
import * as fs from 'fs';
import type {
    AnalysisInput,
    AnalysisResult,
    MigrationResult,
    SkillContext
} from './types.js';

// Dynamic imports for skills to handle .ts/.js resolution
const loadSkills = async () => ({
    analyzeProjectDependencies: (await import('./skills/analyze-dependencies.js')).analyzeProjectDependencies,
    extractAndMigrateCode: (await import('./skills/migrate-code.js')).extractAndMigrateCode,
    refactorImportPaths: (await import('./skills/refactor-paths.js')).refactorImportPaths,
    generateLibPackageJson: (await import('./skills/generate-package.js')).generateLibPackageJson,
    buildAndValidateLib: (await import('./skills/build-validate.js')).buildAndValidateLib
});

const SKILLS_DIR = path.join(import.meta.dirname, 'skills');

function loadSkillPrompts(): Map<string, string> {
    const skills = new Map<string, string>();
    try {
        const skillFiles = fs.readdirSync(SKILLS_DIR).filter((f: string) => f.endsWith('.md'));
        for (const file of skillFiles) {
            const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
            skills.set(file.replace('.md', ''), content);
        }
    } catch {
        // Skills directory might not exist in all environments
    }
    return skills;
}

export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
    };
    handler: (params: unknown) => Promise<unknown>;
}

/**
 * Run the analysis agent to extract a module from a TypeScript project.
 * 
 * This is the main entry point that orchestrates the full extraction workflow:
 * 1. Analyze project dependencies
 * 2. Migrate code files to new library
 * 3. Refactor import paths
 * 4. Generate package.json
 * 5. Build and validate
 */
export async function runAnalysisAgent(input: AnalysisInput): Promise<MigrationResult> {
    const skills = await loadSkills();
    const libsDir = path.resolve(input.projectPath, '..', 'libs');
    const libName = input.outputLibName || `extracted-${Date.now()}`;
    const outputPath = path.join(libsDir, libName);

    const context: SkillContext = {
        projectPath: input.projectPath,
        moduleDescription: input.moduleDescription
    };

    try {
        // Ensure libs directory exists
        await fs.promises.mkdir(libsDir, { recursive: true });

        console.log('🔍 Step 1: Analyzing project dependencies...');
        const analysisResult = await skills.analyzeProjectDependencies(input);
        context.analysisResult = analysisResult;

        console.log(`   Found ${analysisResult.entryPoints.length} entry points`);
        console.log(`   Found ${analysisResult.internalDependencies.length} internal files`);
        console.log(`   Found ${analysisResult.externalDependencies.length} external dependencies`);

        console.log('\n📦 Step 2: Migrating code files...');
        const migrationProgress = await skills.extractAndMigrateCode(analysisResult, outputPath);
        console.log(`   Copied ${migrationProgress.copiedFiles.length} files`);

        console.log('\n🔧 Step 3: Refactoring import paths...');
        const refactorResult = await skills.refactorImportPaths(outputPath);
        console.log(`   Modified ${refactorResult.modifiedFiles.length} files`);

        console.log('\n📄 Step 4: Generating package.json...');
        const packageResult = await skills.generateLibPackageJson(
            outputPath,
            libName,
            analysisResult.externalDependencies
        );
        console.log(`   Created: ${packageResult.packageJsonPath}`);

        console.log('\n🔨 Step 5: Building and validating...');
        const buildResult = await skills.buildAndValidateLib(outputPath);
        context.migrationResult = buildResult;

        return buildResult;

    } catch (error) {
        console.error('\n❌ Error during extraction:', error);
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
    }
}

/**
 * Get tool definitions for integration with AI agents.
 * These can be used with @github/copilot-sdk or similar frameworks.
 */
export function getToolDefinitions(): Tool[] {
    return [
        {
            name: 'analyze_project',
            description: 'Analyze a TypeScript project to identify module entry points and dependencies',
            parameters: {
                type: 'object',
                properties: {
                    projectPath: { type: 'string', description: 'Absolute path to the project root' },
                    moduleDescription: { type: 'string', description: 'Description of the module to extract' },
                    entryFiles: { type: 'array', items: { type: 'string' }, description: 'Optional entry file paths' }
                },
                required: ['projectPath', 'moduleDescription']
            },
            handler: async (params: unknown): Promise<unknown> => {
                const skills = await loadSkills();
                return skills.analyzeProjectDependencies(params as AnalysisInput);
            }
        },
        {
            name: 'migrate_code',
            description: 'Extract and migrate identified code files to the new library location',
            parameters: {
                type: 'object',
                properties: {
                    analysisResult: { type: 'object', description: 'Result from analyze_project' },
                    outputPath: { type: 'string', description: 'Target path for the new library' }
                },
                required: ['analysisResult', 'outputPath']
            },
            handler: async (params: unknown): Promise<unknown> => {
                const skills = await loadSkills();
                const p = params as { analysisResult: AnalysisResult; outputPath: string };
                return skills.extractAndMigrateCode(p.analysisResult, p.outputPath);
            }
        },
        {
            name: 'refactor_imports',
            description: 'Refactor import paths in migrated files to use new relative paths',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the migrated library' },
                    pathMappings: { type: 'object', description: 'Original to new path mappings' }
                },
                required: ['libPath']
            },
            handler: async (params: unknown): Promise<unknown> => {
                const skills = await loadSkills();
                const p = params as { libPath: string; pathMappings?: Record<string, string> };
                return skills.refactorImportPaths(p.libPath, p.pathMappings);
            }
        },
        {
            name: 'generate_package_json',
            description: 'Generate package.json for the new library based on detected dependencies',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the library' },
                    libName: { type: 'string', description: 'Name for the library package' },
                    externalDeps: { type: 'array', items: { type: 'string' }, description: 'External dependencies' }
                },
                required: ['libPath', 'libName']
            },
            handler: async (params: unknown): Promise<unknown> => {
                const skills = await loadSkills();
                const p = params as { libPath: string; libName: string; externalDeps?: string[] };
                return skills.generateLibPackageJson(p.libPath, p.libName, p.externalDeps);
            }
        },
        {
            name: 'build_and_validate',
            description: 'Build the library and run validation checks',
            parameters: {
                type: 'object',
                properties: {
                    libPath: { type: 'string', description: 'Path to the library' }
                },
                required: ['libPath']
            },
            handler: async (params: unknown): Promise<unknown> => {
                const skills = await loadSkills();
                const p = params as { libPath: string };
                return skills.buildAndValidateLib(p.libPath);
            }
        }
    ];
}

/**
 * Get skill prompts for LLM context.
 */
export function getSkillPrompts(): Map<string, string> {
    return loadSkillPrompts();
}

export type { AnalysisInput, MigrationResult, AnalysisResult };
