# Runtime Tracer Skill

## Purpose

The Runtime Tracer skill implements T-DAERA Phase 2: Dynamic Tracing. It creates Proxy wrappers to intercept function calls in the original project environment, recording all input-output mappings for smart stub generation.

## How It Works

1. **Bootstrap Injection**: Generates a Node.js require hook that wraps module exports with Proxy objects
2. **Call Interception**: Every function call to spied modules is intercepted, with args and return values recorded
3. **Call Graph Building**: Tracks which functions call which other functions
4. **Serialization**: Safely serializes complex objects, handling circular references, Buffers, Promises, etc.
5. **Exit Handling**: Saves trace log on process exit or signals

## Key Functions

### `identifyModulesToSpy(analysisResult)`
Identifies which modules need to be traced based on:
- External dependencies
- Missing internal dependencies (will become stubs)

### `runTracing(projectPath, scenario, modulesToSpy, config)`
Executes a test scenario with tracing enabled:
1. Generates bootstrap script
2. Runs setup commands
3. Executes main scenario with NODE_OPTIONS injection
4. Runs teardown commands
5. Collects and returns trace log

### `createDefaultScenario(entryFile, analysisResult)`
Creates a basic test scenario when none is provided:
- Detects server patterns (listen/start exports)
- Detects main/run patterns
- Falls back to simple require

### `saveTraceLog(traceLog, outputPath)`
Persists trace log to JSON file.

### `mergeTraceLogs(logs)`
Combines multiple trace logs (from multiple scenarios) into one.

## Trace Entry Structure

```typescript
{
  timestamp: number,
  module: string,        // "config" or "src/utils/helper.ts"
  method: string,        // "loadConfig" or "default"
  args: unknown[],       // Serialized arguments
  returnValue: unknown,  // Serialized return
  isAsync: boolean,      // Was it a Promise?
  error?: string,        // Error message if thrown
  duration?: number      // Execution time in ms
}
```

## Example Usage

```typescript
import { identifyModulesToSpy, runTracing, createDefaultScenario } from './runtime-tracer.js';

// After analysis
const modulesToSpy = identifyModulesToSpy(analysisResult);

// Create or load scenario
const scenario = createDefaultScenario('src/server.ts', analysisResult);

// Run with tracing
const traceLog = await runTracing(projectPath, scenario, modulesToSpy, {
  enabled: true,
  maxTraceTime: 30000
});

console.log(`Captured ${traceLog.stats.totalCalls} calls`);
```

## Configuration

```typescript
interface TracingConfig {
  enabled: boolean;           // Master switch
  testScenarioPath?: string;  // Custom scenario file
  traceOutputPath?: string;   // Where to save logs
  maxTraceTime?: number;      // Timeout (default: 30000ms)
  spyModules?: string[];      // Override auto-detected modules
}
```
