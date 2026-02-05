# T-DAERA Implementation Plan
**(Trace-Driven Automated Extraction & Refactoring Architecture)**

## Overview

This plan outlines the implementation of dynamic tracing capabilities to improve the module extraction agent. Instead of blind extraction with static analysis only, we will:

1. **Trace First** - Run targeted tests in the original environment
2. **Record Behavior** - Capture I/O mappings using Proxy/Spy technology
3. **Synthesize Smart Stubs** - Generate stubs with actual runtime values
4. **Prune Dead Code** - Only keep methods that were actually called

## Phase 1: Types & Interfaces

### New Type Definitions (types.ts additions)

```typescript
// Tracing configuration
interface TracingConfig {
  enabled: boolean;
  testScenarioPath?: string;     // Path to test scenarios
  traceOutputPath?: string;      // Where to save trace logs
  maxTraceTime?: number;         // Timeout for tracing (ms)
  spyModules?: string[];         // Modules to spy on
}

// Trace log entry
interface TraceEntry {
  timestamp: number;
  module: string;
  method: string;
  args: any[];
  returnValue: any;
  error?: string;
  callStack?: string[];
}

// Trace log for a complete session
interface TraceLog {
  sessionId: string;
  startTime: number;
  endTime: number;
  entries: TraceEntry[];
  callGraph: Map<string, Set<string>>;  // method -> called methods
}

// Smart stub generation config
interface SmartStubConfig {
  traceLog: TraceLog;
  preserveTypes: boolean;
  generateWarnings: boolean;     // Warn on untraced calls
  fallbackBehavior: 'throw' | 'return-default' | 'warn';
}
```

## Phase 2: New Skills

### 2.1 Runtime Tracer Skill (runtime-tracer.ts)

Creates a Proxy wrapper that intercepts function calls and records I/O:

```
Key Functions:
- createModuleSpy(modulePath, targetMethods): Proxy
- runWithTracing(testScenario, spiedModules): TraceLog
- saveTraceLog(log, outputPath): void
```

### 2.2 Test Scenario Generator (generate-scenarios.ts)

Analyzes entry files and generates test scenarios:

```
Key Functions:
- analyzeEntryPoint(filePath): ScenarioHints
- generateTestScenario(hints): TestScenario
- validateScenario(scenario): ValidationResult
```

### 2.3 Smart Stub Synthesizer (synthesize-stubs.ts)

Generates stubs from trace logs with real values:

```
Key Functions:
- synthesizeStub(traceLog, modulePath): string
- generateTypePreservingStub(originalFile, traces): string
- pruneUnusedMethods(stubContent, calledMethods): string
```

## Phase 3: Updated Pipeline

```
Current Pipeline:
analyze → migrate → refactor → package → build

New T-DAERA Pipeline:
analyze → [trace] → migrate → synthesize → refactor → package → build → verify
         ↑ new       ↑ new

Where:
- [trace]: Run test scenarios, capture behavior logs
- synthesize: Generate smart stubs from trace data
- verify: Re-run scenarios in new environment to validate
```

## Phase 4: CLI Updates

New CLI options:
```
--trace              Enable dynamic tracing mode
--scenario <path>    Custom test scenario file
--trace-timeout <ms> Max time for tracing (default: 30000)
--verify            Re-run scenarios after extraction to verify
```

## Implementation Order

1. ✅ Create plan (this document)
2. Add tracing types to types.ts
3. Create runtime-tracer.ts skill
4. Create generate-scenarios.ts skill  
5. Create synthesize-stubs.ts skill
6. Update agent.ts pipeline
7. Update cli.ts with new options
8. Update ARCHITECTURE.md documentation

## Success Criteria

- [ ] Tracing captures all external module calls
- [ ] Smart stubs contain actual runtime values
- [ ] Dead code is removed from stubs
- [ ] Verification passes in new environment
- [ ] Build compiles with 0 TypeScript errors
