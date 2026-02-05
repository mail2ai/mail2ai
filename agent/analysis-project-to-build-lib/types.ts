export interface AnalysisInput {
    projectPath: string;
    moduleDescription: string;
    entryFiles?: string[];
    outputLibName?: string;
    /** Directories to search for files (relative to project). If provided, only files in these directories are analyzed. */
    directories?: string[];
    /** Focus directories - only include files from these directories in the extraction (relative to project). */
    focusDirectories?: string[];
    /** Maximum depth for dependency traversal (default: unlimited). Use 1 for shallow extraction. */
    maxDepth?: number;
    /** Automatically include all required dependencies (ignores focus restrictions) */
    includeDeps?: boolean;
    /** Generate stub files for missing external dependencies */
    generateStubs?: boolean;
}

/** Configuration for the Analysis Agent */
export interface AgentConfig {
    /** AI model to use (default: gpt-5-mini) */
    model?: string;
    /** Maximum tokens for AI responses */
    maxTokens?: number;
    /** Temperature for AI responses (0-1) */
    temperature?: number;
    /** Enable verbose logging */
    verbose?: boolean;
    /** Whether to use the Copilot SDK (default: true) */
    useSdk?: boolean;
}

export interface DependencyInfo {
    filePath: string;
    relativePath: string;
    imports: ImportInfo[];
    exports: ExportInfo[];
    isInternal: boolean;
}

export interface ImportInfo {
    moduleSpecifier: string;
    namedImports: string[];
    defaultImport?: string;
    isExternal: boolean;
    resolvedPath?: string;
}

export interface ExportInfo {
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'default';
    isReExport: boolean;
}

export interface AnalysisResult {
    entryPoints: string[];
    internalDependencies: DependencyInfo[];
    externalDependencies: string[];
    /** Missing internal dependencies - files referenced but not included due to focus restrictions */
    missingDependencies: MissingDependency[];
    fileGraph: Map<string, string[]>;
    suggestedLibStructure: LibStructure;
}

/** Represents a dependency that is referenced but not included in the extraction */
export interface MissingDependency {
    /** Absolute path to the missing file */
    filePath: string;
    /** Relative path from project root */
    relativePath: string;
    /** Directory containing the file (e.g., "src/config") */
    directory: string;
    /** Files that import this missing dependency */
    referencedBy: string[];
    /** The import specifiers used to reference this file */
    importSpecifiers: string[];
}

export interface LibStructure {
    name: string;
    outputPath: string;
    files: FileToMigrate[];
    packageJson: PackageJsonConfig;
}

export interface FileToMigrate {
    sourcePath: string;
    targetPath: string;
    pathMappings: PathMapping[];
}

export interface PathMapping {
    originalImport: string;
    newImport: string;
}

export interface PackageJsonConfig {
    name: string;
    version: string;
    main: string;
    types: string;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
}

export interface MigrationResult {
    success: boolean;
    libPath: string;
    migratedFiles: string[];
    errors: MigrationError[];
}

export interface MigrationError {
    file: string;
    error: string;
    phase: 'analysis' | 'copy' | 'refactor' | 'build';
}

export interface SkillContext {
    projectPath: string;
    moduleDescription: string;
    analysisResult?: AnalysisResult;
    migrationResult?: MigrationResult;
}
