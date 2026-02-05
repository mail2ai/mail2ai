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
    .description('Extract a module from a TypeScript project')
    .requiredOption('-p, --project <path>', 'Path to the source project')
    .requiredOption('-m, --module <description>', 'Description of the module to extract')
    .option('-e, --entry <files...>', 'Entry file paths (relative to project)')
    .option('-n, --name <name>', 'Name for the output library')
    .option('-d, --directories <dirs...>', 'Directories to search (relative to project, e.g., src/browser assets/chrome-extension)')
    .option('--model <model>', 'AI model to use (default: gpt-5-mini)', 'gpt-5-mini')
    .option('--verbose', 'Enable verbose logging', true)
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

        const input: AnalysisInput = {
            projectPath: projectPath,
            moduleDescription: options.module,
            entryFiles: options.entry,
            outputLibName: options.name,
            directories: options.directories
        };

        if (options.directories) {
            console.log(chalk.gray(`Directories: ${options.directories.join(', ')}`));
        }

        const agentConfig: AgentConfig = {
            model: options.model,
            verbose: options.verbose
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
