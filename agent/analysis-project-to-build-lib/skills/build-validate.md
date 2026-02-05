# Build and Validate Skill

This skill builds the extracted library and validates it compiles correctly.

## Purpose

Final validation step to ensure the extracted library:
1. Has all required dependencies installed
2. Has proper exports defined
3. Compiles without TypeScript errors

## Usage

```typescript
import { buildAndValidateLib } from './build-validate';

const result = await buildAndValidateLib('/path/to/lib');
```

## Input Parameters

- `libPath`: Path to the library root

## Output

Returns `MigrationResult` containing:
- `success`: Whether all validations passed
- `libPath`: Path to the library
- `migratedFiles`: List of all TypeScript files in the library
- `errors`: Detailed error information with file and phase

## Validation Steps

### 1. Dependency Installation
- Runs `npm install` in the library directory
- Reports any installation failures

### 2. Export Validation
- Checks that `src/index.ts` exists
- Verifies it contains export statements
- Reports if no exports are found

### 3. TypeScript Type Check
- Runs `tsc --noEmit` to check for type errors
- Parses TypeScript error output
- Reports errors with file, line, and message

## Error Phases

Errors are tagged with their phase:
- `analysis`: Issues during dependency analysis
- `copy`: Issues during file copying
- `refactor`: Issues during path refactoring
- `build`: Issues during compilation

## Key Features

- Non-blocking error collection (continues after non-fatal errors)
- Detailed error reporting with line numbers
- Progress logging to console
- Returns comprehensive migration result
