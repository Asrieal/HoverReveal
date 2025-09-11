# Hover Reveal | 悬浮提示插件

[English](#english) | [中文](#中文)

## English

Shows hidden text in tooltips when hovering over marked elements using [visibleText]{tooltipText} syntax.

### Installation

1. Download the latest release `.zip` file
2. Extract the zip file to your Obsidian vault's plugins folder: `.obsidian/plugins/`
3. Restart Obsidian and enable the plugin

### Usage

Use the following syntax in your notes:
`[Hello]{This is a tooltip}`

Example:
- Input: `[Hello]{This is a tooltip}`
- Result: You'll see "Hello" (underlined and bold), and when you hover over it, "This is a tooltip" appears.

![image](https://github.com/user-attachments/assets/20f32437-07ee-4d51-9549-67a102f649ff)

#### Commands & Hotkeys

The plugin provides two commands that you can assign custom hotkeys to:

1. **Insert Hover Reveal Syntax**
   - Inserts `[]{}` template at cursor position
   - If text is selected, wraps it as `[selectedText]{}` and positions cursor in tooltip area
   - Access via Command Palette (Ctrl/Cmd + P) or assign a custom hotkey

2. **Navigate in Hover Reveal Syntax**
   - Toggles cursor between visible text and tooltip text within existing `[text]{tooltip}` syntax
   - Useful for quick editing of hover reveal elements
   - Only works when cursor is positioned within a hover reveal syntax

**To assign custom hotkeys:**
1. Go to Settings → Hotkeys
2. Search for "Hover Reveal" 
3. Assign your preferred key combinations to the commands


### Features
- Hover to reveal hidden text
- Automatic theme adaptation
- Live preview support
- Customizable styles

### Settings

You can customize the following styles in the plugin settings:
1. **Tooltip Text Color**: The color of text in the tooltip
2. **Tooltip Background Color**: The background color of the tooltip
3. **Tooltip Border Color**: The border color of the tooltip
4. **Bold Text Color**: The color of the visible text

Each setting supports:
- Color picker
- CSS variables
- Manual color input

Use the Reset button to restore default settings.

---

## 中文

一个在鼠标悬停时显示隐藏文本的 Obsidian 插件。

### 安装方法

1. 下载最新版本的 `.zip` 文件
2. 解压文件到你的 Obsidian 插件文件夹：`.obsidian/plugins/`
3. 重启 Obsidian，并启用插件

### 使用方法

在笔记中使用以下语法：
`[可见文本]{提示文本}`

示例：
- 输入：`[你好]{这是一个提示}`
- 效果：显示"你好"（带下划线和加粗），鼠标悬停时会显示"这是一个提示"

![image](https://github.com/user-attachments/assets/44d3d380-7452-4fd3-911f-eef3498c2467)

#### 命令和快捷键

插件提供两个命令，你可以为它们分配自定义快捷键：

1. **插入悬浮提示语法**
   - 在光标位置插入 `[]{}` 模板
   - 如果选中了文本，会自动包装为 `[选中文本]{}` 并将光标定位到提示区域
   - 可通过命令面板 (Ctrl/Cmd + P) 访问或分配自定义快捷键

2. **在悬浮提示语法中导航**
   - 在现有的 `[文本]{提示}` 语法中，在可见文本和提示文本之间切换光标位置
   - 便于快速编辑悬浮提示元素
   - 仅在光标位于悬浮提示语法内时有效

**分配自定义快捷键：**
1. 进入 设置 → 快捷键
2. 搜索 "Hover Reveal"
3. 为命令分配你偏好的按键组合


### 功能特点
- 悬停显示隐藏文本
- 自动适应主题
- 支持实时预览
- 可自定义样式

### 设置选项

在插件设置中可以自定义以下样式：
1. **提示文本颜色**：提示框中文字的颜色
2. **提示背景颜色**：提示框的背景颜色
3. **提示边框颜色**：提示框的边框颜色
4. **加粗文本颜色**：可见文本的颜色

每个设置支持：
- 颜色选择器
- CSS 变量
- 手动输入颜色

使用重置按钮可以恢复默认设置。
