# Analysis Project to Build Lib Agent

An AI-powered agent using `@github/copilot-sdk` that analyzes TypeScript projects and extracts modules into independent, reusable libraries.

## Overview

This agent automates the process of:
1. Analyzing project dependencies using `ts-morph`
2. Identifying all internal files required for a module
3. Extracting and migrating code to a new library
4. Refactoring import paths (including path aliases)
5. Generating package.json and tsconfig.json
6. Validating the extracted library compiles correctly

## Features

- **AI-Powered Orchestration**: Uses `@github/copilot-sdk` with gpt-5-mini (default) for intelligent workflow execution
- **Automatic Fallback**: Falls back to direct skill execution when SDK is unavailable
- **Comprehensive Logging**: Detailed logs with DEBUG/INFO/STEP/WARN/ERROR levels
- **Report Generation**: Automatically generates extraction reports

## Usage

### As a Library

```typescript
import { runAnalysisAgent, AnalysisAgent } from './agent/analysis-project-to-build-lib';

// Simple usage
const result = await runAnalysisAgent({
    projectPath: '/path/to/source/project',
    moduleDescription: 'browser automation utilities',
    directories: ['src/browser'],
    outputLibName: 'browser-lib'
});

// With agent configuration
const agent = new AnalysisAgent({
    model: 'gpt-5-mini',
    verbose: true
});

const result = await agent.run({
    projectPath: '/path/to/project',
    moduleDescription: 'email handling utilities',
    entryFiles: ['src/email/index.ts'],
    outputLibName: 'my-email-lib'
});

if (result.success) {
    console.log(`Library created at: ${result.libPath}`);
} else {
    console.error('Errors:', result.errors);
}
```

### Via CLI

```bash
# Basic usage
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    --project /path/to/project \
    --module "email handling utilities" \
    --entry src/email/index.ts \
    --name my-email-lib

# Extract browser module with directories
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p projects/openclaw \
    -m "browser automation functionality" \
    -d src/browser assets/chrome-extension \
    -n browser-lib \
    --model gpt-5-mini
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-p, --project <path>` | Path to the source project (required) |
| `-m, --module <description>` | Description of the module to extract (required) |
| `-e, --entry <files...>` | Entry file paths (relative to project) |
| `-n, --name <name>` | Name for the output library |
| `-d, --directories <dirs...>` | Directories to search (relative to project) |
| `--model <model>` | AI model to use (default: gpt-5-mini) |
| `--verbose` | Enable verbose logging (default: true) |

## Skills

The agent uses a set of specialized skills:

### 1. Analyze Dependencies
Uses `ts-morph` to traverse the AST and build a complete dependency graph.

### 2. Migrate Code
Copies identified files to the new library location while maintaining structure.

### 3. Refactor Paths
Rewrites import/export paths to work in the new location, handling:
- Relative imports
- Path aliases (@/...)
- ESM .js extensions

### 4. Generate Package
Creates package.json and tsconfig.json with correct configuration.

### 5. Build and Validate
Runs TypeScript compilation to verify the library works.

## Output

The extracted library is placed in `{project_root}/../libs/{libName}` with structure:

```
libs/
  my-email-lib/
    package.json
    tsconfig.json
    src/
      index.ts
      email/
        emailService.ts
        ...
```

## Dependencies

- `ts-morph` - TypeScript AST manipulation
- `@github/copilot-sdk` - AI agent framework
- `chalk` - Terminal styling
- `commander` - CLI framework
