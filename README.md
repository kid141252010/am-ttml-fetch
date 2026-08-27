# AM TTML Fetch 逐字歌词插件 for SPlayer-Next

[![SPlayer-Next Plugin](https://img.shields.io/badge/SPlayer--Next-Plugin-blue.svg)](https://github.com/SPlayer-Dev/SPlayer-Next)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.2.3-orange.svg)](am-ttml-fetch.js)

针对 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 播放器的音源与歌词拓展插件。搜索 Apple Music 全球曲库，提取 TTML 逐字/行级歌词（含内嵌翻译与音译）。

---

## ✨ 核心特性

- 🎵 **TTML 逐字歌词提取**：支持原生 syllable-level 逐字高亮动画与丰富样式，自动过滤无逐字标记的普通逐行歌词。
- 🇨🇳 **简体替换段无损融合**：自动将 Apple Music 内嵌的 `zh-Hans` 替换段（`type="replacement"`）合并进繁体主歌词，并自动同步语言声明。
- 🌏 **全球曲库跨区检索**：支持同时在 `cn`、`jp`、`tw`、`kr` 等多个地区曲库发起并发搜索。
- ⚙️ **图形化配置界面**：无需修改代码，在 SPlayer-Next「设置 → 插件 → Apple Music TTML → 配置」中直接填写参数。
  > 此功能尚未被上游合并。
- 🔤 **歌词翻译与音译控制**：自定义 `l[lyrics]` 语言（如 `zh-Hans-CN`）与 `l[script]` 脚本（如 `zh-Kana`, `zh-Latn`）。
- 🔀 **自定义匹配别名库**：支持配置 `五月天=Mayday` 等别名映射，方便外区曲库精准检索与盲匹打分。
- 🔄 **支持在线自动更新**：内嵌规范 Header，SPlayer-Next 客户端在发现新版本时提示一键更新。

---

## 🛠️ 安装与使用

### 1. 安装插件
在 SPlayer-Next 客户端中打开 **「设置 → 插件管理」**，点击 **【在线导入】** 并粘贴 [`https://raw.githubusercontent.com/kid141252010/am-ttml-fetch/refs/heads/main/am-ttml-fetch.js`](https://raw.githubusercontent.com/kid141252010/am-ttml-fetch/refs/heads/main/am-ttml-fetch.js) 以完成安装。

### 2. 获取 Media-User-Token
1. 在浏览器中打开并登录 [Apple Music Web Player](https://music.apple.com)。
2. 按 `F12` 打开开发者工具，切换到 **应用 (Application) / 存储 (Storage) → Cookie → https://music.apple.com**。
3. 复制 `media-user-token` 的值（格式通常为 `0.Avks...` 开头的字符串）。

### 3. 配置参数
在 SPlayer-Next **「设置 → 插件管理 → AM TTML Fetch」** 卡片上点击 **【配置】** 按钮：
- **Media-User-Token**：粘贴上一步复制的 Token 字符串。
- **账号曲库地区**：填入订阅账号所属地区（如 `cn`, `us`, `jp`，留空自动读取）。
- **歌词翻译/语言 (l[lyrics])**：请求歌词语言（默认 `zh-Hans-CN`，推荐的还有 `zh-Hant-TW`）。
- **歌词音译/脚本 (l[script])**：请求音译/字形脚本（如 `zh-Latn`, `ja-Kana`, `zh-Hans`，留空自动推导）。
- **自定义匹配别名库**：格式为 `原词=别名`（如 `五月天=Mayday, 茄子蛋=EggPlantEgg`），提升外区检索匹配率。

---

## 📄 开源协议与声明

- 本项目采用 [GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSE) 协议开源。仅供技术交流与个人测试使用。
