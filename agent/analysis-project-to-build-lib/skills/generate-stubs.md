# Stub Generation Skill

This skill generates type-safe stub files for missing external dependencies that could not be included in the extraction.

## Purpose

When extracting a module from a larger project, some dependencies may fall outside the focus directories. Instead of breaking the build, this skill generates stub implementations that:

1. Provide the correct TypeScript types for missing exports
2. Create placeholder implementations that can be replaced at runtime
3. Allow the extracted library to compile successfully

## How It Works

1. Analyzes the `missingDependencies` from the analysis result
2. Reads the original source files to understand their exports
3. Generates stub files with the same export signatures
4. Creates adapter interfaces for dependency injection

## Generated Structure

```
library/
├── src/
│   ├── stubs/           # Generated stub files
│   │   ├── config/
│   │   │   └── config.ts
│   │   ├── logging/
│   │   │   └── subsystem.ts
│   │   └── index.ts     # Re-exports all stubs
│   └── adapters/        # Adapter interfaces
│       └── types.ts     # Interface definitions
```

## Usage

The skill is called automatically when `--generate-stubs` is passed to the CLI, or can be invoked directly:

```typescript
import { generateStubs } from './skills/generate-stubs.js';

await generateStubs(analysisResult, outputPath);
```
