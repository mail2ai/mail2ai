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
    /** T-DAERA: Enable dynamic tracing mode */
    tracing?: TracingConfig;
    /** T-DAERA: Verify extraction by running scenarios in new environment */
    verify?: boolean;
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
    traceLog?: TraceLog;
}

// ============================================================================
// T-DAERA: Trace-Driven Automated Extraction & Refactoring Architecture
// ============================================================================

/**
 * Configuration for runtime tracing.
 * Enables dynamic behavior recording during test execution.
 */
export interface TracingConfig {
    /** Enable tracing mode */
    enabled: boolean;
    /** Path to test scenario file(s) */
    testScenarioPath?: string;
    /** Directory to save trace logs */
    traceOutputPath?: string;
    /** Maximum time to wait for tracing (ms, default: 30000) */
    maxTraceTime?: number;
    /** Specific modules to spy on (if empty, spy on all external deps) */
    spyModules?: string[];
    /** Whether to capture call stacks */
    captureCallStack?: boolean;
    /** Serialize complex objects to JSON depth */
    serializeDepth?: number;
}

/**
 * A single traced function call entry.
 * Records input-output mapping for stub generation.
 */
export interface TraceEntry {
    /** Timestamp of the call */
    timestamp: number;
    /** Module path (relative or package name) */
    module: string;
    /** Function/method name */
    method: string;
    /** Function arguments (serialized) */
    args: unknown[];
    /** Return value (serialized) */
    returnValue: unknown;
    /** Whether the call was async */
    isAsync: boolean;
    /** Error message if the call threw */
    error?: string;
    /** Call stack for debugging */
    callStack?: string[];
    /** Execution duration in ms */
    duration?: number;
}

/**
 * Complete trace log for a tracing session.
 * Contains all captured function calls and the derived call graph.
 */
export interface TraceLog {
    /** Unique session identifier */
    sessionId: string;
    /** Start timestamp */
    startTime: number;
    /** End timestamp */
    endTime: number;
    /** All traced entries */
    entries: TraceEntry[];
    /** Call graph: method -> set of called methods */
    callGraph: Record<string, string[]>;
    /** Statistics about the tracing session */
    stats: TraceStats;
}

/**
 * Statistics from a tracing session.
 */
export interface TraceStats {
    /** Total number of calls captured */
    totalCalls: number;
    /** Number of unique modules traced */
    uniqueModules: number;
    /** Number of unique methods traced */
    uniqueMethods: number;
    /** Number of errors encountered */
    errorCount: number;
    /** Total execution time */
    totalDuration: number;
}

/**
 * Test scenario definition for tracing.
 * Describes how to exercise the code to capture its behavior.
 */
export interface TestScenario {
    /** Scenario name/description */
    name: string;
    /** Entry point file to execute */
    entryFile: string;
    /** Setup commands to run before */
    setup?: string[];
    /** Main execution commands/script */
    execute: string | string[];
    /** Teardown commands to run after */
    teardown?: string[];
    /** Expected outcomes for validation */
    expectations?: ScenarioExpectation[];
    /** Environment variables to set */
    env?: Record<string, string>;
    /** Timeout in ms */
    timeout?: number;
}

/**
 * Expected outcome from a test scenario.
 */
export interface ScenarioExpectation {
    /** Type of expectation */
    type: 'call' | 'return' | 'error' | 'output';
    /** Module/method pattern to match */
    pattern: string;
    /** Expected value (for return/output) */
    value?: unknown;
    /** Whether this is optional */
    optional?: boolean;
}

/**
 * Configuration for smart stub synthesis.
 */
export interface SmartStubConfig {
    /** Trace log to use for stub generation */
    traceLog: TraceLog;
    /** Preserve original TypeScript types */
    preserveTypes: boolean;
    /** Generate console warnings for untraced calls */
    generateWarnings: boolean;
    /** Behavior when an untraced call is made */
    fallbackBehavior: 'throw' | 'return-default' | 'warn';
    /** Remove methods that were never called */
    pruneUncalled: boolean;
}

/**
 * Result of smart stub synthesis.
 */
export interface StubSynthesisResult {
    /** Generated stub files */
    files: GeneratedStub[];
    /** Methods that were pruned (never called) */
    prunedMethods: string[];
    /** Warnings during generation */
    warnings: string[];
}

/**
 * A generated smart stub file.
 */
export interface GeneratedStub {
    /** Output file path */
    filePath: string;
    /** Original source file path */
    originalPath: string;
    /** Generated content */
    content: string;
    /** Methods with traced values */
    tracedMethods: string[];
    /** Methods with fallback stubs */
    fallbackMethods: string[];
}

/**
 * Verification result after running scenarios in new environment.
 */
export interface VerificationResult {
    /** Whether verification passed */
    success: boolean;
    /** Scenarios that passed */
    passed: string[];
    /** Scenarios that failed */
    failed: VerificationFailure[];
    /** Comparison with original trace */
    comparison?: TraceComparison;
}

/**
 * Details of a verification failure.
 */
export interface VerificationFailure {
    /** Scenario name */
    scenario: string;
    /** Error message */
    error: string;
    /** Expected vs actual difference */
    diff?: string;
}

/**
 * Comparison between original and new environment traces.
 */
export interface TraceComparison {
    /** Calls that match */
    matchingCalls: number;
    /** Calls with different return values */
    mismatchedReturns: TraceMismatch[];
    /** Calls that occurred in original but not new */
    missingCalls: string[];
    /** New calls not in original */
    extraCalls: string[];
}

/**
 * A mismatched return value between traces.
 */
export interface TraceMismatch {
    /** Module.method identifier */
    call: string;
    /** Original return value */
    expected: unknown;
    /** New return value */
    actual: unknown;
}
