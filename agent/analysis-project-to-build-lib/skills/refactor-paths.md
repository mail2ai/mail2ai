# Refactor Paths Skill

This skill uses `ts-morph` to rewrite import/export paths in migrated files to work in their new location.

## Purpose

After code is migrated to a new location, import paths need to be updated because:
1. Relative paths may no longer resolve correctly
2. Path aliases (like @/...) need to be converted to relative paths
3. ESM requires explicit .js extensions

## Usage

```typescript
import { refactorImportPaths } from './refactor-paths';

const result = await refactorImportPaths('/path/to/lib', {
    '@/utils': './utils',
    '@/types': './types'
});
```

## Input Parameters

- `libPath`: Path to the migrated library root
- `customMappings`: (Optional) Custom path alias mappings

## Output

Returns `RefactorResult` containing:
- `modifiedFiles`: Array of files that were modified
- `errors`: Array of any errors encountered

## Process

1. Create a new ts-morph project for the library
2. For each source file:
   - Process all import declarations
   - Process all export declarations with module specifiers
   - Convert path aliases to relative paths
   - Ensure .js extensions for ESM compatibility
3. Save all changes

## Path Resolution Rules

1. **Path Aliases** (@/...):
   - Convert to relative paths based on file location
   - Search for matching .ts/.tsx files or index files

2. **Relative Imports**:
   - Validate they resolve correctly
   - Add .js extension if missing

3. **External Modules**:
   - Left unchanged (handled by package.json dependencies)

## Key Features

- Handles TypeScript path aliases
- Adds ESM-compatible .js extensions
- Preserves working imports
- Reports files that couldn't be resolved
