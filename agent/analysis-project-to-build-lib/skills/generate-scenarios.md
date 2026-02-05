# Test Scenario Generator Skill

## Purpose

The Test Scenario Generator skill implements T-DAERA Phase 1: Reconnaissance. It analyzes entry points to understand what type of code they represent (server, CLI, library, etc.) and generates appropriate test scenarios that will exercise the code during tracing.

## How It Works

1. **Entry Point Analysis**: Uses ts-morph to parse the entry file and extract:
   - Exported functions, classes, types
   - Pattern detection (server, CLI, library, worker)
   - Dependencies

2. **Pattern Detection**: Identifies common patterns:
   - **Server**: `listen()`, `createServer()`, express/koa/fastify imports
   - **CLI**: `process.argv`, commander/yargs usage
   - **Library**: Exports functions/classes without server/CLI patterns
   - **Worker**: worker_threads, cluster usage

3. **Command Generation**: Creates appropriate execution commands:
   - Servers: Start, make request, shut down
   - CLI: Run with --help or typical args
   - Library: Import and call main exports

## Key Functions

### `analyzeEntryPoint(entryFilePath, projectPath, analysisResult?)`
Returns `ScenarioHints` with:
- Entry file type
- Exports list
- Server/CLI patterns detected
- Suggested commands

### `generateTestScenario(hints, customizations?)`
Creates a `TestScenario` object suitable for tracing.

### `generateAllScenarios(analysisResult, projectPath)`
Generates scenarios for all entry points in the analysis.

### `createComprehensiveScenario(entryFile, projectPath, analysisResult)`
Creates multiple scenarios to exercise different code paths.

## Scenario Structure

```typescript
interface TestScenario {
  name: string;           // Unique identifier
  entryFile: string;      // Path to entry file
  setup?: string[];       // Commands to run before
  execute: string | string[];  // Main commands
  teardown?: string[];    // Commands to run after
  timeout?: number;       // Timeout in ms
  env?: Record<string, string>;  // Environment vars
}
```

## Example Usage

```typescript
import { analyzeEntryPoint, generateTestScenario } from './generate-scenarios.js';

const hints = await analyzeEntryPoint('src/server.ts', '/path/to/project');
console.log(`Detected type: ${hints.type}`);
console.log(`Exports:`, hints.exports);

const scenario = generateTestScenario(hints, {
  timeout: 15000,
  env: { DEBUG: 'true' }
});

console.log(`Execute: ${scenario.execute}`);
```

## Auto-Generated Commands

### Server Pattern
```javascript
node -e "
  const m = require('./dist/server.js');
  const server = m.createServer();
  server.listen(3000, () => {
    http.get('http://localhost:3000/', () => {
      server.close();
    });
    setTimeout(() => server.close(), 5000);
  });
"
```

### Library Pattern  
```javascript
node -e "const m = require('./dist/lib.js'); m.main?.() || m.run?.()"
```

### CLI Pattern
```bash
node dist/cli.js --help
```
