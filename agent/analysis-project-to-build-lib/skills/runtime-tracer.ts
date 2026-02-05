/**
 * Runtime Tracer Skill
 * 
 * T-DAERA Phase 2: Dynamic Tracing
 * 
 * This skill creates Proxy wrappers to intercept function calls in the original
 * project environment, recording all input-output mappings for smart stub generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import type {
    TracingConfig,
    TraceEntry,
    TraceLog,
    TraceStats,
    TestScenario,
    AnalysisResult
} from '../types.js';

// Generate unique session ID
function generateSessionId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a tracer bootstrap script that will be injected into the target process.
 * This script sets up Proxy wrappers for specified modules.
 */
function generateTracerBootstrap(modulesToSpy: string[], outputPath: string): string {
    return `
// T-DAERA Runtime Tracer Bootstrap
// Auto-generated - do not edit

const fs = require('fs');
const path = require('path');
const Module = require('module');

const TRACE_OUTPUT = ${JSON.stringify(outputPath)};
const MODULES_TO_SPY = new Set(${JSON.stringify(modulesToSpy)});

// Trace entries storage
const traceEntries = [];
const callGraph = new Map();
let currentCaller = null;

// Serialize value for logging (handle circular refs)
function safeSerialize(value, depth = 3) {
    if (depth <= 0) return '[max-depth]';
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'function') return '[Function: ' + (value.name || 'anonymous') + ']';
    if (typeof value === 'symbol') return value.toString();
    if (value instanceof Error) return { __error: true, message: value.message, stack: value.stack };
    if (value instanceof Promise) return '[Promise]';
    if (Buffer.isBuffer(value)) return '[Buffer: ' + value.length + ' bytes]';
    if (typeof value !== 'object') return value;
    
    try {
        const seen = new WeakSet();
        return JSON.parse(JSON.stringify(value, (key, val) => {
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            if (typeof val === 'function') return '[Function]';
            if (typeof val === 'symbol') return val.toString();
            return val;
        }));
    } catch {
        return '[Unserializable: ' + typeof value + ']';
    }
}

// Create a spy wrapper for a function
function createFunctionSpy(fn, moduleName, methodName) {
    return function(...args) {
        const entry = {
            timestamp: Date.now(),
            module: moduleName,
            method: methodName,
            args: args.map(a => safeSerialize(a)),
            returnValue: undefined,
            isAsync: false,
            error: undefined,
            duration: 0
        };
        
        // Track call graph
        if (currentCaller) {
            if (!callGraph.has(currentCaller)) {
                callGraph.set(currentCaller, new Set());
            }
            callGraph.get(currentCaller).add(moduleName + '.' + methodName);
        }
        
        const prevCaller = currentCaller;
        currentCaller = moduleName + '.' + methodName;
        
        const startTime = performance.now();
        
        try {
            const result = fn.apply(this, args);
            
            // Handle promises
            if (result && typeof result.then === 'function') {
                entry.isAsync = true;
                return result.then(
                    (resolved) => {
                        entry.returnValue = safeSerialize(resolved);
                        entry.duration = performance.now() - startTime;
                        traceEntries.push(entry);
                        currentCaller = prevCaller;
                        return resolved;
                    },
                    (rejected) => {
                        entry.error = rejected?.message || String(rejected);
                        entry.duration = performance.now() - startTime;
                        traceEntries.push(entry);
                        currentCaller = prevCaller;
                        throw rejected;
                    }
                );
            }
            
            entry.returnValue = safeSerialize(result);
            entry.duration = performance.now() - startTime;
            traceEntries.push(entry);
            currentCaller = prevCaller;
            return result;
        } catch (error) {
            entry.error = error?.message || String(error);
            entry.duration = performance.now() - startTime;
            traceEntries.push(entry);
            currentCaller = prevCaller;
            throw error;
        }
    };
}

// Create a spy wrapper for an object (class instance or module exports)
function createObjectSpy(obj, moduleName) {
    const handler = {
        get(target, prop) {
            const value = target[prop];
            if (typeof value === 'function') {
                return createFunctionSpy(value.bind(target), moduleName, String(prop));
            }
            return value;
        }
    };
    return new Proxy(obj, handler);
}

// Create a spy wrapper for a class constructor
function createClassSpy(Class, moduleName) {
    return new Proxy(Class, {
        construct(target, args) {
            const instance = new target(...args);
            return createObjectSpy(instance, moduleName);
        },
        apply(target, thisArg, args) {
            return target.apply(thisArg, args);
        }
    });
}

// Wrap module exports with spies
function wrapModuleExports(exports, moduleName) {
    if (typeof exports === 'function') {
        // Could be a class or a function
        if (exports.prototype && Object.getOwnPropertyNames(exports.prototype).length > 1) {
            return createClassSpy(exports, moduleName);
        }
        return createFunctionSpy(exports, moduleName, 'default');
    }
    
    if (typeof exports === 'object' && exports !== null) {
        const wrapped = {};
        for (const key of Object.keys(exports)) {
            const value = exports[key];
            if (typeof value === 'function') {
                if (value.prototype && Object.getOwnPropertyNames(value.prototype).length > 1) {
                    wrapped[key] = createClassSpy(value, moduleName);
                } else {
                    wrapped[key] = createFunctionSpy(value, moduleName, key);
                }
            } else {
                wrapped[key] = value;
            }
        }
        return wrapped;
    }
    
    return exports;
}

// Hook into module loading
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    const exports = originalRequire.apply(this, arguments);
    
    // Check if this module should be spied
    const resolvedPath = Module._resolveFilename(id, this);
    const moduleName = id.startsWith('.') ? path.relative(process.cwd(), resolvedPath) : id;
    
    const shouldSpy = MODULES_TO_SPY.has(id) || 
                      MODULES_TO_SPY.has(moduleName) ||
                      Array.from(MODULES_TO_SPY).some(pattern => {
                          if (pattern.includes('*')) {
                              const regex = new RegExp('^' + pattern.replace(/\\*/g, '.*') + '$');
                              return regex.test(id) || regex.test(moduleName);
                          }
                          return moduleName.includes(pattern);
                      });
    
    if (shouldSpy) {
        console.log('[T-DAERA Tracer] Spying on module:', moduleName);
        return wrapModuleExports(exports, moduleName);
    }
    
    return exports;
};

// Save trace on exit
function saveTrace() {
    const callGraphObj = {};
    for (const [caller, callees] of callGraph.entries()) {
        callGraphObj[caller] = Array.from(callees);
    }
    
    const traceLog = {
        sessionId: '${generateSessionId()}',
        startTime: Date.now(),
        endTime: Date.now(),
        entries: traceEntries,
        callGraph: callGraphObj,
        stats: {
            totalCalls: traceEntries.length,
            uniqueModules: new Set(traceEntries.map(e => e.module)).size,
            uniqueMethods: new Set(traceEntries.map(e => e.module + '.' + e.method)).size,
            errorCount: traceEntries.filter(e => e.error).length,
            totalDuration: traceEntries.reduce((sum, e) => sum + (e.duration || 0), 0)
        }
    };
    
    fs.writeFileSync(TRACE_OUTPUT, JSON.stringify(traceLog, null, 2));
    console.log('[T-DAERA Tracer] Saved', traceEntries.length, 'trace entries to', TRACE_OUTPUT);
}

process.on('exit', saveTrace);
process.on('SIGINT', () => { saveTrace(); process.exit(0); });
process.on('SIGTERM', () => { saveTrace(); process.exit(0); });

console.log('[T-DAERA Tracer] Bootstrap loaded, spying on:', Array.from(MODULES_TO_SPY));
`;
}

/**
 * Identify modules to spy on based on analysis result.
 * Returns module specifiers for external and missing dependencies.
 */
export function identifyModulesToSpy(analysisResult: AnalysisResult): string[] {
    const modules = new Set<string>();

    // Add external dependencies
    for (const dep of analysisResult.externalDependencies) {
        modules.add(dep);
    }

    // Add missing internal dependencies (these will become stubs)
    if (analysisResult.missingDependencies) {
        for (const missing of analysisResult.missingDependencies) {
            // Convert to relative import pattern
            for (const specifier of missing.importSpecifiers) {
                modules.add(specifier);
            }
        }
    }

    return Array.from(modules);
}

/**
 * Run tracing in the original project environment.
 * Executes the test scenario with spy wrappers active.
 */
export async function runTracing(
    projectPath: string,
    scenario: TestScenario,
    modulesToSpy: string[],
    config: TracingConfig
): Promise<TraceLog> {
    const sessionId = generateSessionId();
    const traceOutputPath = config.traceOutputPath || path.join(projectPath, '.trace-logs');
    const traceFilePath = path.join(traceOutputPath, `${sessionId}.json`);

    // Ensure trace output directory exists
    await fs.promises.mkdir(traceOutputPath, { recursive: true });

    // Generate bootstrap script
    const bootstrapContent = generateTracerBootstrap(modulesToSpy, traceFilePath);
    const bootstrapPath = path.join(traceOutputPath, `${sessionId}-bootstrap.js`);
    await fs.promises.writeFile(bootstrapPath, bootstrapContent);

    console.log(`  📡 Starting trace session: ${sessionId}`);
    console.log(`  📝 Spying on ${modulesToSpy.length} modules`);

    // Prepare environment
    const env = {
        ...process.env,
        ...scenario.env,
        NODE_OPTIONS: `--require "${bootstrapPath}" ${process.env.NODE_OPTIONS || ''}`
    };

    // Run setup commands
    if (scenario.setup) {
        for (const cmd of scenario.setup) {
            console.log(`  🔧 Setup: ${cmd}`);
            await runCommand(cmd, projectPath, env);
        }
    }

    // Execute the main scenario
    const commands = Array.isArray(scenario.execute) ? scenario.execute : [scenario.execute];
    const timeout = scenario.timeout || config.maxTraceTime || 30000;

    try {
        for (const cmd of commands) {
            console.log(`  ▶️  Execute: ${cmd}`);
            await runCommand(cmd, projectPath, env, timeout);
        }
    } catch (error) {
        console.error(`  ⚠️  Execution error:`, error);
        // Continue to collect partial traces
    }

    // Run teardown commands
    if (scenario.teardown) {
        for (const cmd of scenario.teardown) {
            console.log(`  🧹 Teardown: ${cmd}`);
            await runCommand(cmd, projectPath, env).catch(() => {});
        }
    }

    // Read and parse trace log
    try {
        const traceContent = await fs.promises.readFile(traceFilePath, 'utf-8');
        const traceLog = JSON.parse(traceContent) as TraceLog;
        console.log(`  ✅ Captured ${traceLog.entries.length} trace entries`);
        return traceLog;
    } catch {
        // Return empty trace log if file doesn't exist (no calls captured)
        console.log(`  ⚠️  No trace entries captured`);
        return {
            sessionId,
            startTime: Date.now(),
            endTime: Date.now(),
            entries: [],
            callGraph: {},
            stats: {
                totalCalls: 0,
                uniqueModules: 0,
                uniqueMethods: 0,
                errorCount: 0,
                totalDuration: 0
            }
        };
    }
}

/**
 * Run a shell command and wait for completion.
 */
async function runCommand(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout?: number
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const [cmd, ...args] = command.split(' ');
        const child: ChildProcess = spawn(cmd, args, {
            cwd,
            env,
            shell: true,
            stdio: ['inherit', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timeoutId: NodeJS.Timeout | undefined;

        if (timeout) {
            timeoutId = setTimeout(() => {
                child.kill('SIGTERM');
                resolve({ stdout, stderr }); // Resolve on timeout (graceful)
            }, timeout);
        }

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (code === 0 || code === null) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
            }
        });

        child.on('error', (error) => {
            if (timeoutId) clearTimeout(timeoutId);
            reject(error);
        });
    });
}

/**
 * Create a default test scenario for a given entry file.
 * This is a fallback when no custom scenario is provided.
 */
export function createDefaultScenario(
    entryFile: string,
    analysisResult: AnalysisResult
): TestScenario {
    const fileName = path.basename(entryFile, path.extname(entryFile));
    
    // Detect scenario type based on exports
    const entryDep = analysisResult.internalDependencies.find(
        d => d.filePath.endsWith(entryFile) || d.relativePath === entryFile
    );

    let executeCommand: string;
    
    if (entryDep) {
        // Check for common patterns in exports
        const hasServer = entryDep.exports.some(e => 
            /server|app|listen|start/i.test(e.name)
        );
        const hasMain = entryDep.exports.some(e => 
            /main|run|init|bootstrap/i.test(e.name)
        );

        if (hasServer) {
            // Server pattern: start, wait, then stop
            executeCommand = `node -e "
                const m = require('./${entryFile}');
                const server = m.createServer?.() || m.default?.();
                if (server?.listen) {
                    server.listen(0, () => {
                        console.log('Server started');
                        setTimeout(() => {
                            server.close?.();
                            process.exit(0);
                        }, 2000);
                    });
                }
            "`;
        } else if (hasMain) {
            executeCommand = `node -e "require('./${entryFile}').main?.() || require('./${entryFile}').run?.()"`;
        } else {
            // Just import the module to trigger top-level code
            executeCommand = `node -e "require('./${entryFile}')"`;
        }
    } else {
        executeCommand = `node -e "require('./${entryFile}')"`;
    }

    return {
        name: `auto-${fileName}`,
        entryFile,
        execute: executeCommand,
        timeout: 10000
    };
}

/**
 * Save trace log to file for later analysis.
 */
export async function saveTraceLog(
    traceLog: TraceLog,
    outputPath: string
): Promise<string> {
    const filePath = path.join(outputPath, `trace-${traceLog.sessionId}.json`);
    await fs.promises.mkdir(outputPath, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(traceLog, null, 2));
    return filePath;
}

/**
 * Load a trace log from file.
 */
export async function loadTraceLog(filePath: string): Promise<TraceLog> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as TraceLog;
}

/**
 * Merge multiple trace logs into one.
 * Useful when running multiple scenarios.
 */
export function mergeTraceLogs(logs: TraceLog[]): TraceLog {
    if (logs.length === 0) {
        return {
            sessionId: generateSessionId(),
            startTime: Date.now(),
            endTime: Date.now(),
            entries: [],
            callGraph: {},
            stats: {
                totalCalls: 0,
                uniqueModules: 0,
                uniqueMethods: 0,
                errorCount: 0,
                totalDuration: 0
            }
        };
    }

    if (logs.length === 1) {
        return logs[0];
    }

    const merged: TraceLog = {
        sessionId: generateSessionId(),
        startTime: Math.min(...logs.map(l => l.startTime)),
        endTime: Math.max(...logs.map(l => l.endTime)),
        entries: [],
        callGraph: {},
        stats: {
            totalCalls: 0,
            uniqueModules: 0,
            uniqueMethods: 0,
            errorCount: 0,
            totalDuration: 0
        }
    };

    const allEntries: TraceEntry[] = [];
    const mergedCallGraph: Record<string, Set<string>> = {};

    for (const log of logs) {
        allEntries.push(...log.entries);
        
        for (const [caller, callees] of Object.entries(log.callGraph)) {
            if (!mergedCallGraph[caller]) {
                mergedCallGraph[caller] = new Set();
            }
            for (const callee of callees) {
                mergedCallGraph[caller].add(callee);
            }
        }
    }

    // Sort entries by timestamp
    merged.entries = allEntries.sort((a, b) => a.timestamp - b.timestamp);

    // Convert call graph sets to arrays
    for (const [caller, callees] of Object.entries(mergedCallGraph)) {
        merged.callGraph[caller] = Array.from(callees);
    }

    // Calculate stats
    merged.stats = {
        totalCalls: merged.entries.length,
        uniqueModules: new Set(merged.entries.map(e => e.module)).size,
        uniqueMethods: new Set(merged.entries.map(e => `${e.module}.${e.method}`)).size,
        errorCount: merged.entries.filter(e => e.error).length,
        totalDuration: merged.entries.reduce((sum, e) => sum + (e.duration || 0), 0)
    };

    return merged;
}

export default {
    identifyModulesToSpy,
    runTracing,
    createDefaultScenario,
    saveTraceLog,
    loadTraceLog,
    mergeTraceLogs
};
