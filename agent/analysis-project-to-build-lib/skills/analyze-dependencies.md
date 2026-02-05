# Analyze Dependencies Skill

This skill uses `ts-morph` to analyze TypeScript projects and identify all dependencies of a given module.

## Purpose

Analyze a TypeScript project starting from entry points to:
1. Identify all internal file dependencies (files within the project)
2. Identify all external dependencies (npm packages)
3. Build a dependency graph
4. Catalog all exports from each file

## Usage

```typescript
import { analyzeProjectDependencies } from './analyze-dependencies';

const result = await analyzeProjectDependencies({
    projectPath: '/path/to/project',
    moduleDescription: 'email handling utilities',
    entryFiles: ['src/email/index.ts'] // optional
});
```

## Input Parameters

- `projectPath`: Absolute path to the project root containing tsconfig.json
- `moduleDescription`: Natural language description of the module to extract (used for auto-detection)
- `entryFiles`: (Optional) Explicit entry file paths relative to project root
- `outputLibName`: (Optional) Name for the output library

## Output

Returns `AnalysisResult` containing:
- `entryPoints`: Array of absolute paths to identified entry files
- `internalDependencies`: Detailed info about each internal file
- `externalDependencies`: List of npm package names
- `fileGraph`: Map of file -> dependencies relationships
- `suggestedLibStructure`: Proposed structure for the new library

## Algorithm

1. Load project using ts-morph with tsconfig.json
2. Find entry points based on:
   - Explicitly provided entry files
   - File/directory names matching keywords from moduleDescription
3. Recursively traverse all imports and re-exports
4. Collect dependency information for each file
5. Build suggested library structure

## Key Features

- Handles path aliases (like @/...)
- Distinguishes internal vs external dependencies
- Analyzes all export types (functions, classes, interfaces, types)
- Builds complete dependency graph
