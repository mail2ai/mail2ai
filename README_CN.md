# Mail2AI 项目简介

Mail2AI 是一个基于邮件驱动的任务处理管道，支持通过 IMAP 监控邮箱、任务队列管理、调度执行、结果邮件通知等功能。核心模块包括 EmailMonitor、TaskQueue、Scheduler、IAgent 和 EmailService。支持插件式 Agent 实现，可选集成 Copilot SDK。

## 主要架构
- 邮件监控（IMAP） ➜ 任务队列（JSON + 文件锁） ➜ 调度器（轮询 + 超时） ➜ IAgent ➜ 邮件服务（SMTP）
- 任务以 JSON 文件持久化，原子更新，支持重试和状态流转
- 调度器支持最大并发和任务超时，自动更新任务状态并可发送结果邮件
- Agent 可插拔，CLI 支持动态加载 Copilot SDK

## 关键工作流
- 错误需优雅处理，日志和状态更新由 TaskQueue 管理
- 所有文档、注释、代码均为英文
- 构建：`npm run build`，输出至 dist/
- 开发：`npm run dev`，示例见 examples/
- 测试：`npm run test` 和 `npm run test:integration`
- CLI：`npm run cli` 或 `npx mail2ai ...`

## 项目约定
- ESM：TS 源码 import 使用显式 `.js` 后缀
- 任务生命周期和日志由 TaskQueue 方法管理
- 邮件解析将 `to` 归一化为数组
- 结果邮件通过轻量级 HTML 模板渲染

## 集成点
- IMAP: imapflow，解析: mailparser，调度: node-cron，SMTP: nodemailer，配置均来自环境变量
- 可选 Copilot SDK 动态加载，默认使用 MockAgent

## 入口与核心类型
- 入口及 API: src/index.ts
- 核心类型: src/types/index.ts
- Agent 实现: 可自定义 IAgent 或使用 CLI 包装

## License
MIT