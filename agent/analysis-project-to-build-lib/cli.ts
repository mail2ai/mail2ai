#!/usr/bin/env node

import { runAnalysisAgent, AnalysisAgent, type AnalysisInput, type AgentConfig } from './index.js';
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';

const program = new Command();

program
    .name('analysis-agent')
    .description('Extract TypeScript modules from projects into independent libraries using @github/copilot-sdk')
    .version('1.0.0');

program
    .command('extract')
    .description('Extract a module from a TypeScript project using entry file for precise extraction')
    .requiredOption('-p, --project <path>', 'Path to the source project')
    .requiredOption('-m, --module <description>', 'Description of the module to extract (include entry file path)')
    .option('-e, --entry <files...>', 'Entry file paths (relative to project) - recommended for precise extraction')
    .option('-n, --name <name>', 'Name for the output library')
    .option('-d, --directories <dirs...>', 'Directories to search (deprecated: prefer -e for precise extraction)')
    .option('-f, --focus <dirs...>', 'Focus directories - only include files from these directories (auto-detected from entry files)')
    .option('--max-depth <depth>', 'Maximum depth for dependency traversal (use 0 for shallow, 1 for one level)', parseInt)
    .option('--include-deps', 'Automatically include all required dependencies (ignores focus restrictions)')
    .option('--generate-stubs', 'Generate stub files for missing external dependencies')
    .option('--model <model>', 'AI model to use', 'gpt-5-mini')
    .option('--verbose', 'Enable verbose logging', true)
    .option('--save-logs', 'Save stage logs for optimization', true)
    .option('--no-sdk', 'Disable Copilot SDK and use direct execution')
    .action(async (options) => {
        const startTime = Date.now();
        
        console.log(chalk.blue.bold('\n🤖 Analysis Agent - Module Extraction'));
        console.log(chalk.blue('═'.repeat(50)));
        console.log(chalk.gray(`Model: ${options.model}`));
        console.log(chalk.gray(`Project: ${options.project}`));
        console.log(chalk.gray(`Module: ${options.module}`));

        // Resolve project path to absolute
        const projectPath = path.isAbsolute(options.project) 
            ? options.project 
            : path.resolve(process.cwd(), options.project);

        // Auto-detect entry file from module description if not specified
        let entryFiles = options.entry;
        if (!entryFiles || entryFiles.length === 0) {
            // Extract entry file paths from module description
            const entryFileMatch = options.module.match(/入口文件[：:]?\s*([\w\/\-\.]+\.ts)/i)
                || options.module.match(/entry\s*file[:\s]+([\w\/\-\.]+\.ts)/i)
                || options.module.match(/((?:projects\/\w+\/)?(?:src|lib)\/[\w\/\-]+\.ts)/gi);
            
            if (entryFileMatch) {
                entryFiles = Array.isArray(entryFileMatch) ? [entryFileMatch[1] || entryFileMatch[0]] : [entryFileMatch];
                // Clean up project path prefix if present
                entryFiles = entryFiles.map((f: string) => f.replace(/^projects\/\w+\//, ''));
                console.log(chalk.yellow(`📍 Auto-detected entry file: ${entryFiles.join(', ')}`));
            }
        }

        const input: AnalysisInput = {
            projectPath: projectPath,
            moduleDescription: options.module,
            entryFiles: entryFiles,
            outputLibName: options.name,
            directories: options.directories,
            focusDirectories: options.focus,
            maxDepth: options.maxDepth,
            includeDeps: options.includeDeps,
            generateStubs: options.generateStubs
        };

        // Log entry files (preferred) or directories
        if (entryFiles && entryFiles.length > 0) {
            console.log(chalk.cyan(`Entry files: ${entryFiles.join(', ')}`));
        } else if (options.directories) {
            console.log(chalk.yellow(`⚠️ Using directories (consider using -e for precise extraction)`));
            console.log(chalk.gray(`Directories: ${options.directories.join(', ')}`));
        } else {
            console.log(chalk.yellow(`⚠️ No entry file specified, will use keyword-based detection`));
        }
        
        if (options.focus) {
            console.log(chalk.cyan(`Focus directories: ${options.focus.join(', ')}`));
        }
        if (options.maxDepth !== undefined) {
            console.log(chalk.cyan(`Max depth: ${options.maxDepth}`));
        }
        if (options.includeDeps) {
            console.log(chalk.cyan(`Auto-include deps: enabled`));
        }
        if (options.generateStubs) {
            console.log(chalk.cyan(`Generate stubs: enabled`));
        }

        const agentConfig: AgentConfig = {
            model: options.model,
            verbose: options.verbose,
            useSdk: options.sdk !== false
        };

        console.log(chalk.blue('─'.repeat(50)) + '\n');

        try {
            const result = await runAnalysisAgent(input, agentConfig);
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            console.log(chalk.blue('\n' + '═'.repeat(50)));
            
            if (result.success) {
                console.log(chalk.green.bold('\n✅ Module extraction completed successfully!'));
                console.log(chalk.cyan(`📁 Library created at: ${result.libPath}`));
                console.log(chalk.gray(`📊 Files migrated: ${result.migratedFiles.length}`));
                console.log(chalk.gray(`⏱️  Duration: ${duration}s`));
                
                // Print some helpful next steps
                console.log(chalk.yellow('\n📋 Next steps:'));
                console.log(chalk.gray(`   cd ${result.libPath}`));
                console.log(chalk.gray('   npm install'));
                console.log(chalk.gray('   npm run build'));
            } else {
                console.log(chalk.yellow.bold('\n⚠️ Module extraction completed with errors:'));
                console.log(chalk.gray(`⏱️  Duration: ${duration}s`));
                
                for (const error of result.errors) {
                    console.log(chalk.red(`   [${error.phase}] ${error.file || 'general'}: ${error.error}`));
                }

                // Still show the library path
                console.log(chalk.cyan(`\n📁 Partial output at: ${result.libPath}`));
                console.log(chalk.gray(`📊 Files migrated: ${result.migratedFiles.length}`));
            }

            // Generate and save report
            const reportPath = path.join(result.libPath, 'EXTRACTION_REPORT.md');
            await generateReport(result, input, duration, reportPath);
            console.log(chalk.gray(`\n📝 Report saved to: ${reportPath}`));

        } catch (error) {
            console.error(chalk.red('\n❌ Extraction failed:'), error);
            process.exit(1);
        }
    });

async function generateReport(
    result: Awaited<ReturnType<typeof runAnalysisAgent>>,
    input: AnalysisInput,
    duration: string,
    reportPath: string
): Promise<void> {
    const fs = await import('fs');
    
    const report = `# Module Extraction Report

## Summary

- **Status**: ${result.success ? '✅ Success' : '⚠️ Completed with errors'}
- **Duration**: ${duration}s
- **Files Migrated**: ${result.migratedFiles.length}
- **Library Path**: ${result.libPath}

## Input Configuration

- **Source Project**: ${input.projectPath}
- **Module Description**: ${input.moduleDescription}
- **Directories**: ${input.directories?.join(', ') || 'Auto-detected'}
- **Entry Files**: ${input.entryFiles?.join(', ') || 'Auto-detected'}
- **Output Library Name**: ${input.outputLibName || 'Auto-generated'}

## Migrated Files

${result.migratedFiles.map(f => `- ${f}`).join('\n')}

${result.errors.length > 0 ? `
## Errors

${result.errors.map(e => `- **[${e.phase}]** ${e.file || 'general'}: ${e.error}`).join('\n')}
` : ''}

## Improvement Suggestions

1. **Import Path Resolution**: Review the import paths in the migrated files to ensure all path aliases are correctly resolved.

2. **External Dependencies**: Verify that all external dependencies are correctly listed in package.json with proper versions.

3. **Type Declarations**: Ensure type-only imports are preserved and .d.ts files are generated correctly.

4. **Testing**: Add unit tests for the extracted library to verify functionality.

5. **Documentation**: Consider adding a README.md with usage instructions for the extracted library.

---
*Generated by Analysis Agent on ${new Date().toISOString()}*
`;

    await fs.promises.writeFile(reportPath, report, 'utf-8');
}

program.parse();
