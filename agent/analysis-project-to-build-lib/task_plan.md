# Task Plan: 测试 Analysis Agent CLI - 抽取 Browser 功能

## 目标
测试 analysis-agent CLI 从 openclaw 项目中抽取 browser 相关功能模块

## 命令参数
```bash
-p projects/openclaw 
-m '抽取 agent 使用 browser 的功能, 包括projects/openclaw/assets/chrome-extension, 以及projects/openclaw/src/browser等相关代码'
```

## 阶段

### Phase 1: 环境准备 [complete]
- [x] 检查项目结构
- [x] 确认 TypeScript 编译状态
- [x] 验证依赖安装

### Phase 2: 首次运行 CLI [complete]
- [x] 运行 CLI 命令
- [x] 记录输出和错误
- [x] 分析失败原因

### Phase 3: 修复错误 [complete]
- [x] 修复 tsconfig.json 生成 (添加 DOM, ES2023)
- [x] 修复依赖过滤 (排除 node:* 前缀)
- [x] 修复 index.ts 导出路径 (添加 .js 扩展名)
- [x] 增强 findEntryPoints 函数

### Phase 4: 生成报告 [complete]
- [x] 总结发现的问题
- [x] 提出改进方案
- [x] 输出最终报告 (TEST_REPORT.md)

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| DOM types undefined | Run 2 | 添加 lib: ['ES2023', 'DOM'] 到 tsconfig |
| node:* in deps | Run 3 | 过滤 node: 前缀的依赖 |
| 入口点过多 (1770) | Run 3 | 需要添加 -d 参数限定目录 |
| .ts.js 扩展名错误 | Run 3 | 待修复 refactor-paths.ts |
| 导出冲突 | Run 3 | 待实现命名空间导出 |

## Progress Log
- Started: 2026-02-05
- Run 1: 首次执行，发现多个问题
- Run 2: 修复 tsconfig 后仍有错误
- Run 3: 修复依赖过滤后执行成功，但构建有错误
- 生成 TEST_REPORT.md 报告
