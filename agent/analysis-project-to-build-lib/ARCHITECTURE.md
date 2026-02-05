# Analysis Agent Architecture Documentation

## T-DAERA Enhancement (v2.0)

This architecture now includes **T-DAERA (Trace-Driven Automated Extraction & Refactoring Architecture)**, which adds dynamic tracing capabilities for generating smart stubs with actual runtime values.

### T-DAERA Key Benefits

1. **Smart Stubs**: Generated stubs contain actual recorded return values, not just "throw Error"
2. **Behavior Recording**: Captures real I/O mappings during test execution
3. **Precision Pruning**: Only includes methods that were actually called
4. **Verification**: Re-runs scenarios in new environment to validate extraction

### T-DAERA CLI Options

```bash
analysis-agent extract -p <project> -m "module" --trace    # Enable tracing
  --scenario <path>     # Custom test scenario file
  --trace-timeout <ms>  # Timeout for tracing (default: 30000)
  --spy-modules <mods>  # Specific modules to spy on
  --verify              # Verify after extraction
```

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLI Entry Point                                   │
│                              (cli.ts)                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ -p project  │  │ -m module   │  │ -e entry    │  │ -f focus / --depth  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  --trace    │  │ --scenario  │  │  --verify   │  │ T-DAERA Options     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Analysis Agent (agent.ts)                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         AnalysisAgent Class                            │ │
│  │  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │ │
│  │  │     Logger       │    │   AgentConfig    │    │  SkillContext    │  │ │
│  │  │   (logger.ts)    │    │  (model, temp)   │    │ (+ traceLog)     │  │ │
│  │  └──────────────────┘    └──────────────────┘    └──────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│    Copilot SDK Execution      │   │       Direct Skill Execution          │
│   (runWithCopilotSDK)         │   │     (runDirectExecution)              │
│  ┌─────────────────────────┐  │   │                                       │
│  │  CopilotClient          │  │   │   Sequential skill calls:             │
│  │  CopilotSession         │  │   │   1. analyzeProjectDependencies       │
│  │  Tool Definitions       │  │   │   1.5 [T-DAERA] runTracing            │
│  └─────────────────────────┘  │   │   2. extractAndMigrateCode            │
└───────────────────────────────┘   │   2.5 synthesizeSmartStubs            │
                    │               │   3. refactorImportPaths              │
                    └───────────────│   4. generateLibPackageJson           │
                                    │   5. buildAndValidateLib              │
                                    │   6. [T-DAERA] verify                 │
                                    └───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Skills Layer                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ analyze-deps.ts │  │ migrate-code.ts │  │ refactor-paths.ts           │  │
│  │  (ts-morph)     │  │  (fs.copy)      │  │ (import rewrite)            │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ generate-pkg.ts │  │ build-validate  │  │ generate-stubs.ts           │  │
│  │ (package.json)  │  │  (tsc check)    │  │ (static stubs)              │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│                                                                             │
│  T-DAERA Skills (NEW):                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ runtime-tracer  │  │ generate-       │  │ synthesize-stubs.ts         │  │
│  │  (Proxy/Spy)    │  │ scenarios.ts    │  │ (smart stubs from trace)    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Output Library                                   │
│  projects/libs/<lib-name>/                                                  │
│  ├── src/                                                                   │
│  │   ├── index.ts          (auto-generated re-exports)                     │
│  │   └── browser/          (migrated files)                                │
│  ├── package.json                                                           │
│  ├── tsconfig.json                                                          │
│  ├── logs/                 (stage logs)                                     │
│  └── EXTRACTION_REPORT.md                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT PHASE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Input                          AnalysisInput                         │
│   ┌────────────────┐                  ┌────────────────────────────────┐    │
│   │ CLI Arguments  │ ─────────────────│ projectPath: string            │    │
│   │ -p, -m, -e, -f │                  │ moduleDescription: string      │    │
│   └────────────────┘                  │ entryFiles?: string[]          │    │
│                                       │ focusDirectories?: string[]    │    │
│                                       │ maxDepth?: number              │    │
│                                       └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ANALYSIS PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ts-morph Project                    AnalysisResult                        │
│   ┌────────────────┐                  ┌────────────────────────────────┐    │
│   │ SourceFile[]   │ ─────────────────│ entryPoints: string[]          │    │
│   │ AST Traversal  │                  │ internalDependencies: DepInfo[]│    │
│   │ Import/Export  │                  │ externalDependencies: string[] │    │
│   └────────────────┘                  │ fileGraph: Map<string,string[]>│    │
│                                       │ suggestedLibStructure          │    │
│                                       └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MIGRATION PHASE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   File Operations                     MigrationProgress                     │
│   ┌────────────────┐                  ┌────────────────────────────────┐    │
│   │ Copy Files     │ ─────────────────│ copiedFiles: string[]          │    │
│   │ Create Dirs    │                  │ errors: {file, error}[]        │    │
│   │ Gen index.ts   │                  └────────────────────────────────┘    │
│   └────────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REFACTOR & BUILD PHASE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Import Rewrite                      Build & Validate                      │
│   ┌────────────────┐                  ┌────────────────────────────────┐    │
│   │ Path aliases   │                  │ npm install                    │    │
│   │ Relative paths │ ─────────────────│ tsc --noEmit                   │    │
│   │ ESM extensions │                  │ Error collection               │    │
│   └────────────────┘                  └────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   MigrationResult                                                           │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │ success: boolean                                                   │    │
│   │ libPath: string                                                    │    │
│   │ migratedFiles: string[]                                            │    │
│   │ errors: MigrationError[]                                           │    │
│   └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2.5 T-DAERA: Dynamic Tracing Flow (NEW)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        T-DAERA TRACING PHASE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   After Analysis, Before Migration (Step 1.5)                               │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  1. Identify Modules to Spy                                          │  │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐    │  │
│   │     │ External    │ +  │ Missing     │ =  │ Spy Target List     │    │  │
│   │     │ Dependencies│    │ Internal    │    │ (modules to trace)  │    │  │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘    │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                         │                                   │
│                                         ▼                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  2. Generate Test Scenarios                                          │  │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐    │  │
│   │     │ Analyze     │───▶│ Detect      │───▶│ Generate            │    │  │
│   │     │ Entry Point │    │ Type (srv/  │    │ Execute Commands    │    │  │
│   │     │             │    │  cli/lib)   │    │                     │    │  │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘    │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                         │                                   │
│                                         ▼                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  3. Execute with Spying (Proxy Injection)                            │  │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐    │  │
│   │     │ Generate    │───▶│ Run Test    │───▶│ Capture All         │    │  │
│   │     │ Bootstrap   │    │ Scenarios   │    │ Function Calls      │    │  │
│   │     │ (NODE_OPTS) │    │             │    │ + Return Values     │    │  │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘    │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                         │                                   │
│                                         ▼                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  TraceLog Output                                                     │  │
│   │  ┌────────────────────────────────────────────────────────────────┐  │  │
│   │  │ entries: [{ module, method, args, returnValue, duration }]     │  │  │
│   │  │ callGraph: { caller -> [callees] }                             │  │  │
│   │  │ stats: { totalCalls, uniqueMethods, errorCount }               │  │  │
│   │  └────────────────────────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     T-DAERA SMART STUB SYNTHESIS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   After Migration (Step 2.5) - Uses TraceLog instead of static analysis    │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  Smart Return Value Generation                                       │  │
│   │                                                                      │  │
│   │  TraceLog:                        Generated Stub:                    │  │
│   │  ┌───────────────────────┐        ┌────────────────────────────┐     │  │
│   │  │ get("port") → 18792   │   →    │ if (arg === "port")        │     │  │
│   │  │ get("env") → "prod"   │   →    │   return 18792;            │     │  │
│   │  │ get("host") → "0.0.0" │   →    │ if (arg === "env")         │     │  │
│   │  └───────────────────────┘        │   return "prod";           │     │  │
│   │                                   │ // fallback for untraced   │     │  │
│   │                                   │ console.warn(...);         │     │  │
│   │                                   └────────────────────────────┘     │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  Stub Quality Markers                                                │  │
│   │                                                                      │  │
│   │  // [TRACED] - Method has recorded values                            │  │
│   │  export function getConfig(key) { ... actual values ... }            │  │
│   │                                                                      │  │
│   │  // [FALLBACK] - Method was not called during tracing                │  │
│   │  export function setConfig(key, val) { throw Error('Not traced'); }  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     T-DAERA VERIFICATION (Optional)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   After Build (Step 6) - Re-runs scenarios in new environment              │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  1. Compile new library                                              │  │
│   │  2. Execute same scenarios against compiled output                   │  │
│   │  3. Compare behavior (should work with smart stubs)                  │  │
│   │  4. Report: passed/failed scenarios                                  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Skill Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SKILL PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  1. analyzeProjectDependencies                                      │   │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │   │
│   │     │ Load Entry  │───▶│ Traverse    │───▶│ Build Dependency    │   │   │
│   │     │ Files       │    │ AST         │    │ Graph               │   │   │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘   │   │
│   │                                                     │               │   │
│   │                                                     ▼               │   │
│   │     ┌─────────────────────────────────────────────────────────────┐ │   │
│   │     │ AnalysisResult: entryPoints, dependencies, externalDeps     │ │   │
│   │     └─────────────────────────────────────────────────────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                         │                                   │
│                                         ▼                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  2. extractAndMigrateCode                                           │   │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │   │
│   │     │ Create      │───▶│ Copy Each   │───▶│ Generate            │   │   │
│   │     │ Output Dir  │    │ Source File │    │ index.ts            │   │   │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                         │                                   │
│                                         ▼                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  3. refactorImportPaths                                             │   │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │   │
│   │     │ Find TS     │───▶│ Rewrite     │───▶│ Handle Path         │   │   │
│   │     │ Files       │    │ Imports     │    │ Aliases             │   │   │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                         │                                   │
│                                         ▼                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  4. generateLibPackageJson                                          │   │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │   │
│   │     │ Collect     │───▶│ Generate    │───▶│ Create              │   │   │
│   │     │ Deps        │    │ package.json│    │ tsconfig.json       │   │   │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                         │                                   │
│                                         ▼                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  5. buildAndValidateLib                                             │   │
│   │     ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │   │
│   │     │ npm         │───▶│ tsc         │───▶│ Report              │   │   │
│   │     │ install     │    │ --noEmit    │    │ Errors              │   │   │
│   │     └─────────────┘    └─────────────┘    └─────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4. Problem Analysis from browser-lib

### 4.1 Root Cause Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MISSING DEPENDENCY PROBLEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Source Project Structure:                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  src/                                                               │   │
│   │  ├── browser/          ◄── EXTRACTED (35 files)                    │   │
│   │  │   └── server.ts     (imports ../config, ../logging, etc.)       │   │
│   │  ├── config/           ◄── NOT EXTRACTED (missing)                 │   │
│   │  ├── logging/          ◄── NOT EXTRACTED (missing)                 │   │
│   │  ├── infra/            ◄── NOT EXTRACTED (missing)                 │   │
│   │  ├── media/            ◄── NOT EXTRACTED (missing)                 │   │
│   │  └── process/          ◄── NOT EXTRACTED (missing)                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Extracted Library:                                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  browser-lib/src/                                                   │   │
│   │  ├── browser/          (35 files with broken imports)              │   │
│   │  │   └── server.ts     import "../config/config.js" ◄── BROKEN!    │   │
│   │  └── index.ts          (re-exports)                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Error Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ERROR TYPE                         COUNT    CAUSE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Missing ../config/* imports      6       Focus limited to src/browser   │
│                                                                             │
│  2. Missing ../logging/* imports     3       Focus limited to src/browser   │
│                                                                             │
│  3. Missing ../infra/* imports       4       Focus limited to src/browser   │
│                                                                             │
│  4. Missing ./pw-ai.js              5       File not in analyzed set        │
│                                                                             │
│  5. Type errors (TargetIdResolution) 3       Incomplete type definitions    │
│                                                                             │
│  6. Missing ../media/* imports       2       Focus limited to src/browser   │
│                                                                             │
│  7. Missing ../process/* imports     1       Focus limited to src/browser   │
│                                                                             │
│  8. Missing ../cli/* imports         1       Focus limited to src/browser   │
│                                                                             │
│  9. Missing ../utils/* imports       2       Focus limited to src/browser   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 5. Solution Approaches

### 5.1 Solution A: Auto-include Required Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SOLUTION A: SMART DEPENDENCY INCLUSION                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Strategy: Automatically include all referenced files regardless of        │
│             focus directories, but mark external deps for shimming          │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  NEW: collectAllDependencies(entryFile)                              │  │
│   │       │                                                              │  │
│   │       ├── Traverse ALL imports (no focus restriction)                │  │
│   │       ├── Classify as: CORE (in focus) vs SUPPORT (outside focus)   │  │
│   │       └── Include SUPPORT files with minimal changes                 │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Pros: ✅ Complete extraction, no broken imports                          │
│   Cons: ❌ May include too many files, defeats purpose of focus            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Solution B: Generate Stubs for External Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SOLUTION B: STUB GENERATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Strategy: Generate stub files for missing dependencies                    │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  NEW: generateStubsForMissingDeps()                                  │  │
│   │       │                                                              │  │
│   │       ├── Identify missing imports after migration                   │  │
│   │       ├── Analyze required exports from original files               │  │
│   │       └── Generate stub files with proper types                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Example:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  // stubs/config/config.ts                                          │   │
│   │  export function loadConfig(): Config { return {} as Config; }      │   │
│   │  export interface Config { browser?: BrowserConfig; }               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Pros: ✅ Minimal extraction, builds pass                                 │
│   Cons: ❌ Stubs need runtime implementation                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Solution C: Dependency Adapter Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SOLUTION C: ADAPTER INTERFACES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Strategy: Create adapter interfaces and move deps to peer dependencies    │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  1. Identify external dependencies                                   │  │
│   │  2. Create interface files for each dependency                       │  │
│   │  3. Rewrite imports to use adapters                                  │  │
│   │  4. Export factory functions for dependency injection                │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Example:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  // adapters/types.ts                                               │   │
│   │  export interface IConfigAdapter {                                  │   │
│   │    loadConfig(): Config;                                            │   │
│   │  }                                                                  │   │
│   │  export interface ILoggerAdapter {                                  │   │
│   │    createSubsystemLogger(name: string): Logger;                     │   │
│   │  }                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Pros: ✅ Clean architecture, testable, flexible                          │
│   Cons: ❌ Significant refactoring required                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Solution D: Extended Focus Directories (Recommended)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│             SOLUTION D: EXTENDED FOCUS WITH DEPENDENCY ANALYSIS             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Strategy: Analyze missing deps and suggest additional focus dirs          │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  Phase 1: Initial Analysis                                           │  │
│   │  ┌────────────────────────────────────────────────────────────────┐  │  │
│   │  │ Analyze entry files with focus directories                     │  │  │
│   │  │ Collect all missing import paths                               │  │  │
│   │  │ Group missing imports by directory                             │  │  │
│   │  └────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                      │  │
│   │  Phase 2: Dependency Mapping                                         │  │
│   │  ┌────────────────────────────────────────────────────────────────┐  │  │
│   │  │ Map: ../config/* → src/config (12 refs)                        │  │  │
│   │  │ Map: ../logging/* → src/logging (5 refs)                       │  │  │
│   │  │ Map: ../infra/* → src/infra (4 refs)                           │  │  │
│   │  │ Map: ./pw-ai.js → src/browser/pw-ai.ts (5 refs)                │  │  │
│   │  └────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                      │  │
│   │  Phase 3: Auto-suggest or Auto-include                               │  │
│   │  ┌────────────────────────────────────────────────────────────────┐  │  │
│   │  │ Option A: Prompt user with suggestions                         │  │  │
│   │  │ Option B: Auto-include if refs > threshold                     │  │  │
│   │  │ Option C: Generate minimal stubs for low-ref deps              │  │  │
│   │  └────────────────────────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Pros: ✅ Balanced approach, user control, complete extraction            │
│   Cons: ❌ More complex implementation                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 6. Recommended Implementation Plan

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      IMPLEMENTATION PHASES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Phase 1: Missing Dependency Detection                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. After collectDependencies, identify unresolved imports          │   │
│   │ 2. Group by source directory (../config, ../logging, etc.)         │   │
│   │ 3. Report missing deps with file counts                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Phase 2: Auto-Include Critical Dependencies                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Add --include-deps flag to CLI                                  │   │
│   │ 2. Expand focus dirs to include required dependencies              │   │
│   │ 3. Re-run analysis with expanded focus                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Phase 3: Stub Generation for Remaining                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. For deps that can't be included, generate stubs                 │   │
│   │ 2. Create adapters/ directory with type definitions                │   │
│   │ 3. Rewrite imports to use local stubs                              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
