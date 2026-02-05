/**
 * Analysis Agent for extracting TypeScript modules into independent libraries.
 * 
 * This agent uses ts-morph for code analysis and integrates with
 * @github/copilot-sdk for AI-assisted decision making.
 * 
 * Default model: gpt-5-mini
 */

import * as path from 'path';
import * as fs from 'fs';
import type {
    AnalysisInput,
    AnalysisResult,
    MigrationResult,
    SkillContext
} from './types.js';
import { AnalysisAgent, type AgentConfig } from './agent.js';
import { Logger, LogLevel } from './logger.js';

// Re-export the agent and logger
export { AnalysisAgent, Logger, LogLevel };
export type { AgentConfig };

// Dynamic imports for skills to handle .ts/.js resolution
const loadSkills = async () => ({
    analyzeProjectDependencies: (await import('./skills/analyze-dependencies.js')).analyzeProjectDependencies,
    extractAndMigrateCode: (await import('./skills/migrate-code.js')).extractAndMigrateCode,
    refactorImportPaths: (await import('./skills/refactor-paths.js')).refactorImportPaths,
    generateLibPackageJson: (await import('./skills/generate-package.js')).generateLibPackageJson,
    buildAndValidateLib: (await import('./skills/build-validate.js')).buildAndValidateLib,
    generateStubs: (await import('./skills/generate-stubs.js')).generateStubs
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
 * 
 * Uses @github/copilot-sdk with gpt-5-mini by default for intelligent orchestration.
 */
export async function runAnalysisAgent(input: AnalysisInput, config?: AgentConfig): Promise<MigrationResult> {
    const agentConfig: AgentConfig = {
        model: 'gpt-5-mini',
        verbose: true,
        ...config
    };

    const agent = new AnalysisAgent(agentConfig);
    return agent.run(input);
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
