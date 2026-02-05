# Generate Package Skill

This skill generates the necessary configuration files for the new library.

## Purpose

Create a complete, publishable npm package structure with:
- package.json with correct dependencies and scripts
- tsconfig.json configured for library output
- Proper ESM module configuration

## Usage

```typescript
import { generateLibPackageJson } from './generate-package';

const result = await generateLibPackageJson(
    '/path/to/lib',
    'my-extracted-lib',
    ['lodash', 'axios']
);
```

## Input Parameters

- `libPath`: Path to the library root
- `libName`: Name for the npm package
- `externalDeps`: (Optional) Array of external dependency names

## Output

Returns `PackageJsonResult` containing:
- `success`: Whether generation succeeded
- `packageJsonPath`: Path to generated package.json
- `content`: The generated package.json content
- `error`: Error message if failed

## Generated Files

### package.json

- ESM module type
- Proper exports field for Node.js 16+
- TypeScript build scripts
- Declaration files enabled
- Dependency versions inherited from source project when available

### tsconfig.json

- ES2022 target
- NodeNext module resolution
- Declaration and source map generation
- Strict type checking

## Key Features

- Inherits dependency versions from source project
- Configures modern ESM exports
- Sets up proper TypeScript configuration
- Includes prepublishOnly hook for npm publishing
