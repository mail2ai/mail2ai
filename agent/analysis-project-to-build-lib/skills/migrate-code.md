# Migrate Code Skill

This skill handles the physical extraction and copying of code files to the new library location.

## Purpose

Extract identified code files from the source project and set up the basic structure of the new library.

## Usage

```typescript
import { extractAndMigrateCode } from './migrate-code';

const result = await extractAndMigrateCode(analysisResult, '/path/to/output/lib');
```

## Input Parameters

- `analysisResult`: The result from `analyzeProjectDependencies`
- `outputPath`: Absolute path where the new library should be created

## Output

Returns `MigrationProgress` containing:
- `copiedFiles`: Array of successfully copied file paths
- `errors`: Array of any errors encountered during copying

## Process

1. Create the output directory structure (`{outputPath}/src/`)
2. Copy each identified file maintaining relative path structure
3. Generate an `index.ts` that re-exports from all files with exports
4. Track progress and errors

## Key Features

- Creates directories recursively as needed
- Maintains original file structure within `src/`
- Auto-generates index.ts with re-exports
- Provides detailed error reporting per file

## Generated Index File

The skill automatically generates an `index.ts` that:
- Re-exports all public APIs from copied files
- Only includes files that have exports
- Uses correct relative paths
