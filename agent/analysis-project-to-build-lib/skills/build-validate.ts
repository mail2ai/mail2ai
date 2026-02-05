import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { MigrationResult } from '../types.js';

interface BuildResult {
    success: boolean;
    stdout: string;
    stderr: string;
    errors: Array<{ file: string; line?: number; message: string }>;
}

async function runCommand(
    command: string,
    args: string[],
    cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
        const proc = spawn(command, args, { cwd, shell: true });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            resolve({ stdout, stderr, code: code ?? 0 });
        });

        proc.on('error', (error) => {
            stderr += error.message;
            resolve({ stdout, stderr, code: 1 });
        });
    });
}

function parseTypeScriptErrors(output: string): Array<{ file: string; line?: number; message: string }> {
    const errors: Array<{ file: string; line?: number; message: string }> = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Match TypeScript error format: file.ts(line,col): error TS1234: message
        const match = line.match(/(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)/);
        if (match) {
            errors.push({
                file: match[1],
                line: parseInt(match[2], 10),
                message: match[3]
            });
        }
    }

    return errors;
}

async function installDependencies(libPath: string): Promise<BuildResult> {
    const packageJsonPath = path.join(libPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return {
            success: false,
            stdout: '',
            stderr: 'package.json not found',
            errors: [{ file: packageJsonPath, message: 'package.json not found' }]
        };
    }

    // Check if npm or pnpm is available
    const result = await runCommand('npm', ['install'], libPath);

    return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        errors: result.code !== 0
            ? [{ file: 'npm install', message: result.stderr }]
            : []
    };
}

async function buildTypeScript(libPath: string): Promise<BuildResult> {
    const result = await runCommand('npx', ['tsc', '--noEmit'], libPath);

    const errors = parseTypeScriptErrors(result.stdout + result.stderr);

    return {
        success: result.code === 0 && errors.length === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        errors
    };
}

async function validateExports(libPath: string): Promise<BuildResult> {
    const srcIndexPath = path.join(libPath, 'src', 'index.ts');

    if (!fs.existsSync(srcIndexPath)) {
        return {
            success: false,
            stdout: '',
            stderr: 'No index.ts found in src directory',
            errors: [{ file: srcIndexPath, message: 'Missing entry point' }]
        };
    }

    const content = fs.readFileSync(srcIndexPath, 'utf-8');
    const hasExports = content.includes('export');

    return {
        success: hasExports,
        stdout: hasExports ? 'Entry point has exports' : '',
        stderr: hasExports ? '' : 'No exports found in index.ts',
        errors: hasExports
            ? []
            : [{ file: srcIndexPath, message: 'No exports found' }]
    };
}

export async function buildAndValidateLib(libPath: string): Promise<MigrationResult> {
    const migratedFiles: string[] = [];
    const errors: MigrationResult['errors'] = [];

    // Collect all files in the library
    function collectFiles(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
                collectFiles(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                migratedFiles.push(fullPath);
            }
        }
    }

    const srcPath = path.join(libPath, 'src');
    if (fs.existsSync(srcPath)) {
        collectFiles(srcPath);
    }

    // Step 1: Install dependencies
    console.log('📦 Installing dependencies...');
    const installResult = await installDependencies(libPath);
    if (!installResult.success) {
        for (const err of installResult.errors) {
            errors.push({ file: err.file, error: err.message, phase: 'build' });
        }
        // Continue anyway, TypeScript check might still work
    }

    // Step 2: Validate exports
    console.log('🔍 Validating exports...');
    const validateResult = await validateExports(libPath);
    if (!validateResult.success) {
        for (const err of validateResult.errors) {
            errors.push({ file: err.file, error: err.message, phase: 'build' });
        }
    }

    // Step 3: Build/Type check
    console.log('🔨 Running TypeScript check...');
    const buildResult = await buildTypeScript(libPath);
    if (!buildResult.success) {
        for (const err of buildResult.errors) {
            errors.push({
                file: err.file,
                error: `Line ${err.line}: ${err.message}`,
                phase: 'build'
            });
        }
    }

    const success = errors.length === 0;

    if (success) {
        console.log('✅ Library build validation passed!');
    } else {
        console.log(`⚠️ Library build completed with ${errors.length} error(s)`);
    }

    return {
        success,
        libPath,
        migratedFiles,
        errors
    };
}
