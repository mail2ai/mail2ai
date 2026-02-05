# Analysis Agent Improvement Report

## 执行摘要

本报告记录了使用 `@github/copilot-sdk` 实现的 analysis-project-to-build-lib agent 的测试结果和改进方案。

### 测试命令
```bash
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p projects/openclaw \
    -m '抽取 agent 使用 browser 的功能' \
    -d src/browser assets/chrome-extension \
    -n browser-lib
```

### 测试结果
- ✅ 成功找到 52 个入口点
- ✅ 成功识别 1004 个内部依赖文件
- ✅ 成功识别 58 个外部依赖
- ✅ 成功复制 1005 个文件到新库
- ⚠️ 构建验证发现 43-48 个类型错误

---

## 已完成的功能

### 1. Copilot SDK 集成 (@github/copilot-sdk)

- **CopilotClient**: 成功集成客户端创建和会话管理
- **CopilotSession**: 支持工具注册和消息处理
- **Tool Registration**: 使用 `defineTool` API 注册自定义工具
- **默认模型**: gpt-5-mini

### 2. Agent 架构

```
AnalysisAgent
├── runWithCopilotSDK()    # AI 驱动的智能编排
│   ├── createTools()      # 创建工具定义
│   └── session.sendAndWait()
└── runDirectExecution()   # 回退直接执行模式
```

### 3. 工具链

| 工具 | 功能 | 状态 |
|------|------|------|
| `analyze_project` | 使用 ts-morph 分析项目依赖 | ✅ 完成 |
| `migrate_code` | 复制源文件到新库 | ✅ 完成 |
| `refactor_imports` | 重写导入路径 | ⚠️ 需要优化 |
| `generate_package` | 生成 package.json | ✅ 完成 |
| `build_and_validate` | 构建验证 | ✅ 完成 |

### 4. 日志系统

- 支持 DEBUG/INFO/STEP/WARN/ERROR 级别
- 自动保存到 `extraction.log`
- 彩色控制台输出
- 生成 `EXTRACTION_REPORT.md`

---

## 发现的问题

### 1. 目录结构问题 (已修复)
**问题**: 文件被复制到 `src/src/` 嵌套目录
**修复**: 在 `analyze-dependencies.ts` 中检查相对路径是否已包含 `src/` 前缀

### 2. 导入路径重写不完整
**问题**: `refactor_imports` 修改了 0 个文件
**原因**: 
- 路径别名 `@/` 的解析需要完善
- ts-morph 项目配置需要与源项目 tsconfig 对齐

### 3. 类型错误

#### 缺失可选依赖
```
Cannot find module '@lydell/node-pty'
Cannot find module '@mozilla/readability'
Cannot find module 'linkedom'
Cannot find module '@napi-rs/canvas'
Cannot find module 'pdfjs-dist'
Cannot find module 'sqlite-vec'
```

#### 类型定义问题
这些是源代码中的类型问题,不是提取过程导致的:
- `Property 'params' does not exist on type 'HookOutcome'`
- `Property 'status' does not exist on type 'SessionReferenceResolution'`
- 等等...

### 4. 导出冲突
```
Module './agents/channel-tools.js' has already exported a member named '__testing'
```

---

## 改进方案

### 短期改进 (High Priority)

#### 1. 增强路径重写
```typescript
// 在 refactor-paths.ts 中:
// 1. 读取源项目的 tsconfig.json 获取 paths 配置
// 2. 构建路径映射表
// 3. 批量替换所有 @/ 开头的导入
```

#### 2. 改进可选依赖检测
```typescript
// 在 analyze-dependencies.ts 中:
// 1. 检测动态导入 (await import(...))
// 2. 检测 try/catch 包裹的导入
// 3. 自动标记为 optionalDependencies
```

#### 3. 导出去重
```typescript
// 在 migrate-code.ts 的 generateIndexFile 中:
// 1. 使用命名空间导出替代 star exports
// 2. 对内部测试模块 (__testing) 不导出
```

### 中期改进

#### 4. 增量提取模式
- 支持只提取 browser 相关代码,排除其他模块
- 添加 `--include` 和 `--exclude` 选项

#### 5. 依赖图可视化
- 生成 mermaid 格式的依赖图
- 标记循环依赖

#### 6. 交互式修复
- 利用 Copilot SDK 的 AI 能力提供修复建议
- 自动应用简单修复

### 长期改进

#### 7. 类型推断优化
- 分析类型定义文件的依赖
- 自动生成缺失的类型声明

#### 8. 测试迁移
- 自动识别和迁移相关测试文件
- 更新测试导入路径

#### 9. 多包支持
- 支持 monorepo 结构
- 生成 workspace 配置

---

## 配置建议

### tsconfig.json 模板
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 推荐的 CLI 使用方式
```bash
# 基本用法
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p <project-path> \
    -m "<module-description>" \
    -d <directories...> \
    -n <lib-name>

# 示例: 提取浏览器模块
npx tsx agent/analysis-project-to-build-lib/cli.ts extract \
    -p projects/openclaw \
    -m "browser automation functionality" \
    -d src/browser \
    -n browser-lib \
    --model gpt-5-mini
```

---

## 日志文件位置

所有日志保存在:
- `{output-lib}/extraction.log` - 详细执行日志
- `{output-lib}/EXTRACTION_REPORT.md` - 提取报告

---

## 附录: SDK 使用示例

### 创建 Agent
```typescript
import { AnalysisAgent } from './agent/analysis-project-to-build-lib';

const agent = new AnalysisAgent({
    model: 'gpt-5-mini',
    verbose: true
});

const result = await agent.run({
    projectPath: '/path/to/project',
    moduleDescription: 'browser functionality',
    directories: ['src/browser'],
    outputLibName: 'browser-lib'
});
```

### 使用 runAnalysisAgent
```typescript
import { runAnalysisAgent } from './agent/analysis-project-to-build-lib';

const result = await runAnalysisAgent({
    projectPath: '/path/to/project',
    moduleDescription: 'browser functionality',
    directories: ['src/browser']
}, {
    model: 'gpt-5-mini',
    verbose: true
});
```

---

*报告生成时间: 2026-02-05*
*Agent 版本: 1.0.0*
*SDK 版本: @github/copilot-sdk ^0.1.20*
