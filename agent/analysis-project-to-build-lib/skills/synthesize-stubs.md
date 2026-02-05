# Smart Stub Synthesizer Skill

## Purpose

The Smart Stub Synthesizer skill implements T-DAERA Phase 3: Synthesis. It generates intelligent stubs from trace logs that contain actual recorded runtime values, rather than simple "throw Error" stubs.

## Key Innovation

Traditional stubs look like:
```typescript
export function getConfig(key: string): any {
  throw new Error('Stub not implemented');
}
```

**Smart stubs** look like:
```typescript
export function getConfig(key: string): any {
  // [TRACED] - Values recorded from runtime
  if (JSON.stringify([arguments[0]]) === '["port"]') return 18792;
  if (JSON.stringify([arguments[0]]) === '["env"]') return "production";
  console.warn('[T-DAERA Stub] Untraced call:', arguments);
  return 18792; // Default to first traced value
}
```

## How It Works

1. **Group Trace Entries**: Organize trace data by module and method
2. **Analyze Call Patterns**: Identify unique arg→return mappings
3. **Generate Conditional Logic**: Create lookups for different call patterns
4. **Preserve Types**: Use ts-morph to maintain TypeScript type annotations
5. **Prune Uncalled**: Optionally remove methods never called during tracing

## Key Functions

### `synthesizeSmartStubs(traceLog, analysisResult, outputPath, projectPath, config?)`
Main entry point. Generates smart stubs for all missing dependencies.

### `generateModuleStub(moduleName, methodTraces, originalFilePath, config)`
Generates a single stub file with traced values.

### `generateSmartReturnValue(entries, config)`
Creates conditional return logic from multiple trace entries.

### `analyzeStubQuality(traceLog)`
Returns statistics about stub coverage and call patterns.

## Configuration

```typescript
interface SmartStubConfig {
  traceLog: TraceLog;
  preserveTypes: boolean;        // Keep TS types from original
  generateWarnings: boolean;     // Warn on untraced calls
  fallbackBehavior: 'throw' | 'return-default' | 'warn';
  pruneUncalled: boolean;        // Remove untraced methods
}
```

## Output Example

Given trace entries:
```json
[
  {"module": "config", "method": "get", "args": ["port"], "returnValue": 3000},
  {"module": "config", "method": "get", "args": ["host"], "returnValue": "localhost"},
  {"module": "logger", "method": "info", "args": ["Starting"], "returnValue": undefined}
]
```

Generated stubs/config.ts:
```typescript
/**
 * T-DAERA Smart Stub
 * Module: config
 */

// [TRACED]
export function get(key: string): any {
  if (JSON.stringify([arguments[0]]) === '["port"]') return 3000;
  if (JSON.stringify([arguments[0]]) === '["host"]') return "localhost";
  console.warn('[T-DAERA Stub] Untraced call with args:', Array.from(arguments));
  return 3000;
}
```

## Stub Quality Metrics

The `analyzeStubQuality` function provides:
- **coverage**: Percentage of methods with traces
- **methodsCovered**: List of traced methods
- **callPatterns**: Call count per method

## Best Practices

1. **Run comprehensive scenarios** before synthesis to capture more call patterns
2. **Use `fallbackBehavior: 'warn'`** during development to identify missing traces
3. **Enable `pruneUncalled`** for minimal stubs (but verify nothing important is removed)
4. **Review generated stubs** - they're a starting point, not perfect
