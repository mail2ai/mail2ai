#!/usr/bin/env node

import { runAnalysisAgent, type AnalysisInput } from './index.js';
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
    .name('analysis-agent')
    .description('Extract TypeScript modules from projects into independent libraries')
    .version('1.0.0');

program
    .command('extract')
    .description('Extract a module from a TypeScript project')
    .requiredOption('-p, --project <path>', 'Path to the source project')
    .requiredOption('-m, --module <description>', 'Description of the module to extract')
    .option('-e, --entry <files...>', 'Entry file paths (relative to project)')
    .option('-n, --name <name>', 'Name for the output library')
    .action(async (options) => {
        console.log(chalk.blue('🔍 Starting module extraction...'));
        console.log(chalk.gray(`Project: ${options.project}`));
        console.log(chalk.gray(`Module: ${options.module}`));

        const input: AnalysisInput = {
            projectPath: options.project,
            moduleDescription: options.module,
            entryFiles: options.entry,
            outputLibName: options.name
        };

        try {
            const result = await runAnalysisAgent(input);

            if (result.success) {
                console.log(chalk.green('\n✅ Module extraction completed successfully!'));
                console.log(chalk.cyan(`Library created at: ${result.libPath}`));
                console.log(chalk.gray(`Files migrated: ${result.migratedFiles.length}`));
            } else {
                console.log(chalk.yellow('\n⚠️ Module extraction completed with errors:'));
                for (const error of result.errors) {
                    console.log(chalk.red(`  [${error.phase}] ${error.file}: ${error.error}`));
                }
            }
        } catch (error) {
            console.error(chalk.red('\n❌ Extraction failed:'), error);
            process.exit(1);
        }
    });

program.parse();
