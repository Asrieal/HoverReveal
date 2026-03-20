# AGENTS.md

这个文件为 Codex (Codex.ai/code) 提供在这个代码库中工作的指导。

## 项目概述
这是一个名为 "Hover Reveal" 的 Obsidian 插件，当鼠标悬停在标记元素上时，使用 `[可见文本]{提示文本}` 语法显示隐藏文本的工具提示。

## 构建命令
- `npm run dev` - 启动开发模式，自动重新编译
- `npm run build` - 构建生产版本
- `npm run version` - 更新版本并更新清单文件

## 架构说明
- **主插件类**: `HoverRevealPlugin` 位于 `main.ts` - 处理插件生命周期、设置和初始化
- **设置管理**: `HoverRevealSettingTab` 类管理4个可自定义的颜色设置
- **渲染系统**:
  - Markdown后置处理器用于阅读模式
  - CodeMirror 扩展用于编辑模式的实时预览
- **工具提示定位**: 智能边界检测，确保工具提示在视口范围内

## 关键文件
- `main.ts` - 插件逻辑、设置和两种渲染系统
- `styles.css` - 工具提示样式和动画
- `manifest.json` - 插件元数据和版本信息
- `esbuild.config.mjs` - TypeScript打包构建配置

## 开发流程
1. 运行 `npm run dev` 进行开发期间的自动编译
2. 将构建后的文件复制到你的仓库的 `.obsidian/plugins/HoverReveal/` 目录
3. 重启Obsidian重新加载插件
4. 测试语法：在任意笔记中使用 `[你好]{这是一个提示}`
- 使用中文回答问题，使用英文编写注释内容