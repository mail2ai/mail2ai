# Analysis Project to Build Lib Agent

An AI-powered agent using `@github/copilot-sdk` that analyzes TypeScript projects and extracts modules into independent, reusable libraries.

## 🏗️ v3.0: Design-Driven Closed-Loop Refactoring

This agent now includes **v3.0 Design-Driven Closed-Loop Refactoring**, which builds upon T-DAERA:

- **Architecture First**: Generates Mermaid diagrams before extraction (class, dependency, data flow)
- **Entry-First Strategy**: Defines public API before refactoring
- **Test Generation**: Auto-generates Jest/Vitest tests from trace data
- **Iterative Fix Loop**: Automatically fixes build errors by adding files or generating stubs
- **Closed-Loop Verification**: Re-runs scenarios to verify extracted library

```bash
# Enable v3.0 Design-Driven mode
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p /path/to/project \
    -m "browser module" \
    -e src/browser/server.ts \
    --design-driven           # Enable v3.0 mode
    --trace                   # Enable T-DAERA tracing
    --verify                  # Verify after extraction
```

### v3.0 Generated Artifacts

- `docs/ARCHITECTURE.md` - Mermaid diagrams (class, dependency, data flow)
- `tests/auto-generated.spec.ts` - Test cases from trace data
- `logs/fix-loop-report.md` - Iterative fix loop report
- `EXTRACTION_REPORT.md` - Complete extraction summary

---

## 🧬 T-DAERA Enhancement (v2.0)

This agent now includes **T-DAERA (Trace-Driven Automated Extraction & Refactoring Architecture)**, which enables:

- **Smart Stubs**: Generate stubs with actual runtime values instead of `throw Error`
- **Dynamic Tracing**: Capture real I/O mappings during test execution
- **Precision Pruning**: Only include methods that were actually called
- **Verification**: Re-run scenarios to validate extraction correctness

```bash
# Enable T-DAERA mode with --trace
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p /path/to/project \
    -m "browser module" \
    -e src/browser/server.ts \
    --trace                    # Enable dynamic tracing
    --verify                   # Verify after extraction
```

See [T-DAERA_PLAN.md](./T-DAERA_PLAN.md) for implementation details.

---

## Overview

This agent automates the process of:
1. Analyzing project dependencies using `ts-morph`
2. **[v3.0] Generating architecture diagrams and public API definition**
3. Identifying all internal files required for a module
4. **[T-DAERA] Tracing runtime behavior to capture I/O mappings**
5. Extracting and migrating code to a new library
6. **[T-DAERA] Synthesizing smart stubs from trace data**
7. Refactoring import paths (including path aliases)
8. Generating package.json and tsconfig.json
9. **[v3.0] Generating test cases from trace data**
10. Validating the extracted library compiles correctly
11. **[v3.0] Running iterative fix loop for build errors**
12. **[T-DAERA] Verifying behavior matches in new environment**

## Features

- **AI-Powered Orchestration**: Uses `@github/copilot-sdk` with gpt-5-mini (default) for intelligent workflow execution
- **v3.0 Design-Driven Mode**: Architecture-first extraction with iterative fixing
- **Automatic Fallback**: Falls back to direct skill execution when SDK is unavailable
- **Comprehensive Logging**: Detailed logs with DEBUG/INFO/STEP/WARN/ERROR levels
- **Report Generation**: Automatically generates extraction reports
- **T-DAERA Tracing**: Dynamic behavior recording for smart stub generation

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

// With v3.0 Design-Driven mode
const result = await runAnalysisAgent({
    projectPath: '/path/to/project',
    moduleDescription: 'browser server',
    entryFiles: ['src/browser/server.ts'],
    outputLibName: 'browser-lib',
    tracing: {
        enabled: true,
        maxTraceTime: 30000
    },
    designDriven: {
        enabled: true,
        generateDiagrams: true,
        generateTests: true,
        iterativeFixLoop: true,
        maxFixIterations: 10
    },
    verify: true
});

// With T-DAERA tracing enabled
const result = await runAnalysisAgent({
    projectPath: '/path/to/project',
    moduleDescription: 'browser server',
    entryFiles: ['src/browser/server.ts'],
    outputLibName: 'browser-lib',
    tracing: {
        enabled: true,
        maxTraceTime: 30000
    },
    verify: true
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

# With T-DAERA dynamic tracing
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p projects/openclaw \
    -m "browser server" \
    -e src/browser/server.ts \
    -n browser-lib \
    --trace \
    --trace-timeout 60000 \
    --verify
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
| **T-DAERA Options** | |
| `--trace` | Enable dynamic tracing for smart stubs |
| `--scenario <path>` | Path to custom test scenario file (JSON) |
| `--trace-timeout <ms>` | Max tracing time (default: 30000) |
| `--spy-modules <modules>` | Specific modules to spy on |
| `--verify` | Re-run scenarios after extraction |

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

### T-DAERA Skills (NEW)

#### 6. Generate Scenarios (`generate-scenarios.ts`)
Analyzes entry points to detect type (server/CLI/library) and generates appropriate test commands.

#### 7. Runtime Tracer (`runtime-tracer.ts`)
Creates Proxy wrappers to intercept function calls, recording all I/O mappings:
- Injects bootstrap via NODE_OPTIONS
- Captures args, return values, errors, timing
- Builds call graph

#### 8. Synthesize Stubs (`synthesize-stubs.ts`)
Generates smart stubs from trace data:
- Creates conditional return logic based on recorded args
- Marks methods as [TRACED] or [FALLBACK]
- Preserves TypeScript types from original

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
      stubs/           # T-DAERA smart stubs
        config/
          config.ts    # Contains [TRACED] methods with real values
        logging/
          logger.ts
    logs/
      trace-log.json   # T-DAERA trace data
```

## T-DAERA: Understanding Smart Stubs

Traditional stubs throw errors and require manual implementation:

```typescript
// Old static stub
export function getConfig(key: string): any {
    throw new Error('Stub not implemented');
}
```

T-DAERA smart stubs contain actual recorded values:

```typescript
// Smart stub from T-DAERA tracing
export function getConfig(key: string): any {
    // [TRACED] - Values recorded from runtime
    if (JSON.stringify([arguments[0]]) === '["port"]') return 18792;
    if (JSON.stringify([arguments[0]]) === '["env"]') return "production";
    if (JSON.stringify([arguments[0]]) === '["host"]') return "0.0.0.0";
    // Fallback for untraced calls
    console.warn('[T-DAERA Stub] Untraced call:', arguments);
    return 18792;
}
```

## Dependencies

- `ts-morph` - TypeScript AST manipulation
- `@github/copilot-sdk` - AI agent framework
- `chalk` - Terminal styling
- `commander` - CLI framework
