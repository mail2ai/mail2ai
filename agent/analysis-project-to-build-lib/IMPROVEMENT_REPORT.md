# Analysis Agent Improvement Report

## Summary

This report documents the improvements made to the `analysis-project-to-build-lib` agent to support focused extraction using entry files instead of directory scanning.

## Changes Made

### 1. CLI Interface Updates (cli.ts)

- **Entry file priority**: Changed from using `-d` (directories) to preferring `-e` (entry files) for more precise extraction
- **Auto-detection**: Added auto-detection of entry file paths from module description (supports both English and Chinese patterns)
- **Focus directories**: Added `-f, --focus <dirs...>` option to limit extraction to specific directories
- **Max depth**: Added `--max-depth <depth>` option to control dependency traversal depth
- **Default model**: Set default model to `gpt-5-mini`
- **Stage logging**: Added `--save-logs` option to save stage logs for optimization (enabled by default)

### 2. Analysis Logic Updates (skills/analyze-dependencies.ts)

- **Focus directories**: Added support for `focusDirectories` parameter that limits which dependencies are traversed
- **Max depth**: Added `maxDepth` parameter to control how deep the dependency graph is traversed
- **Auto-focus detection**: When entry files are specified, automatically detect focus directories from their paths
- **Better logging**: Added detailed logging for each step of the analysis process

### 3. Types Updates (types.ts)

Added new fields to `AnalysisInput`:
- `focusDirectories?: string[]` - Directories to focus extraction on
- `maxDepth?: number` - Maximum depth for dependency traversal

### 4. Agent Updates (agent.ts)

- **Stage logging**: Added saving of logs after each stage (analysis, migrate, refactor, package, build)
- **Path consistency**: Fixed issue where SDK tool calls used different paths than the intended output
- **Entry file logging**: Added logging to show which extraction method is being used

### 5. Migration Updates (skills/migrate-code.ts)

- **Path recalculation**: Fixed issue where target paths were not recalculated when the actual output path differs from the suggested path

## Test Results

### Successful Extraction

```bash
node dist/agent/analysis-project-to-build-lib/cli.js extract \
  -p projects/openclaw \
  -m 'Extract browser, entry src/browser/server.ts' \
  -e src/browser/server.ts \
  -f src/browser \
  -n browser-lib
```

**Results:**
- Entry file correctly detected: `src/browser/server.ts`
- Focus directory correctly set: `src/browser`
- Reduced from 992 files (full traversal) to 35 files (focused)
- Files correctly migrated to `browser-lib/src/browser/`
- Package.json and tsconfig.json generated
- Build has 30 errors due to missing external dependencies (expected)

### Missing Dependencies

The extracted browser module has dependencies on other parts of the project:
- `../config/config.js` - Configuration loading
- `../logging/subsystem.js` - Logging utilities
- `../infra/ws.js` - WebSocket utilities
- `../media/image-ops.js` - Image operations
- `../process/exec.js` - Process execution
- `./pw-ai.js` - Playwright AI module (not in src/browser directory)

## Recommendations

### 1. Additional Focus Directories
To extract a fully working browser library, include additional directories:
```bash
-f src/browser src/config src/logging src/infra src/media src/process
```

### 2. External Dependencies Mode
Consider adding a mode that:
- Creates stub types for external dependencies
- Moves external dependencies to peer dependencies in package.json
- Generates adapter interfaces for external modules

### 3. Shallow Extraction Mode
For simple extractions, use `--max-depth 0` to only include the entry file and its immediate imports.

### 4. Interactive Mode
Consider adding an interactive mode that:
- Shows what dependencies would be included
- Asks user to confirm or adjust focus directories
- Allows selective inclusion/exclusion of modules

### 5. Dependency Analysis Report
Generate a dependency report before extraction showing:
- Total files that would be included
- External dependencies
- Files by directory
- Circular dependencies

## Stage Logs Location

When extraction is run, stage logs are saved to:
- `<output>/logs/stage1-analysis.log`
- `<output>/logs/stage2-migrate.log`
- `<output>/logs/stage3-refactor.log`
- `<output>/logs/stage4-package.log`
- `<output>/logs/stage5-build.log`

## Usage Examples

### Minimal Extraction (single file)
```bash
node dist/agent/analysis-project-to-build-lib/cli.js extract \
  -p projects/openclaw \
  -m 'Extract server.ts' \
  -e src/browser/server.ts \
  --max-depth 0 \
  -n browser-server
```

### Focused Extraction (single directory)
```bash
node dist/agent/analysis-project-to-build-lib/cli.js extract \
  -p projects/openclaw \
  -m 'Extract browser module' \
  -e src/browser/server.ts \
  -f src/browser \
  -n browser-lib
```

### Full Extraction (multiple directories)
```bash
node dist/agent/analysis-project-to-build-lib/cli.js extract \
  -p projects/openclaw \
  -m 'Extract browser with dependencies' \
  -e src/browser/server.ts \
  -f src/browser src/config src/logging src/infra \
  -n browser-full
```

---
*Generated: 2026-02-05*
