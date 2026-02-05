export interface AnalysisInput {
    projectPath: string;
    moduleDescription: string;
    entryFiles?: string[];
    outputLibName?: string;
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
    fileGraph: Map<string, string[]>;
    suggestedLibStructure: LibStructure;
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
