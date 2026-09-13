# SPlayer-Next 插件开发与歌词加载机制知识记忆

本文档记录针对 **SPlayer-Next** 播放器核心架构、歌词调度流程、内置平台超时机制以及插件（如 AM TTML Fetch）开发与排障的关键知识。

---

## 1. 架构与插件运行机制

- **进程架构**：
  - 宿主主进程基于 Electron，管理窗口、数据库、音频输出及 IPC；
  - 插件运行在独立的子进程 `splayer-plugin-host`（Utility 进程，内存约 70MB）；
  - 插件内的 `splayer.request(url, opts)` 通过 IPC 由宿主主进程的 `hostRequest` 代理执行，底层采用 Electron 的 `net.fetch`，遵循系统及客户端网络代理（`bypassCustomProtocolHandlers: true`）。
- **插件接口规范**：
  - `splayer.register({ sources, settings })` 声明数据源与图形化设置项；
  - `splayer.on("musicSearch", async ({ keyword }) => { return { list: [...] }; })`：候选搜索；
  - `splayer.on("musicLyric", async ({ musicInfo }) => { return { lyric, awlyric, tlyric, rlyric }; })`：
    - `lyric`：必须为非空文本（宿主采纳的门槛）；
    - `awlyric`：逐字时间戳内容（供宿主走逐字渲染管线）。
  - 宿主对插件调用设有保护性超时：`musicSearch` 15 秒，`musicLyric` 15 秒。
- **本地存储与安装路径**：
  - 配置文件：`%APPDATA%\SPlayer-Next\app-data\config\settings.json`；
  - 插件脚本：`%APPDATA%\SPlayer-Next\app-data\plugins\scripts\<pluginId>.js`；
  - 插件清单：`%APPDATA%\SPlayer-Next\app-data\plugins\manifest.json`；
  - 插件存储：`%APPDATA%\SPlayer-Next\app-data\plugins\data\<pluginId>.json`。

---

## 2. 歌词格式优先级阶梯（Format Ranking）

宿主内置格式优先级（从高到低）：
$$\text{TTML (1)} > \text{LYS (2)} > \text{QRC (3)} > \text{KRC (4)} > \text{YRC (5)} > \text{LRC (6)} > \text{ASS (7)} > \text{SRT (8)}$$

- **TTML**：顶级格式（Apple Music 等逐字歌词，支持富样式、多声部、内嵌音译/翻译）；
- **QRC**：QQ 音乐逐字格式，优先级高于 KRC（酷狗）与 YRC（网易云）；
- 当新歌词格式等级高于现有歌词时，宿主会自动无缝升级覆盖。

---

## 3. 宿主歌词解析流程（`resolveLyricForPreload`）

1. **本地仓库优先**：首先检查本地歌曲标签与本地 TTML 仓库（`F:\ttml`）；
2. **并发与串行分支**：
   - **若开启【优先使用插件歌词】（`preferPluginLyric: true`）**：
     客户端切歌时**同时并行启动**插件任务与在线源任务，谁先返回逐字歌词就直接采纳，无需等待；
   - **若未开启【优先使用插件歌词】（默认 false）**：
     客户端会**先串行尝试所有在线源**（网易云 $\to$ QQ 音乐 $\to$ 酷狗），只有在线源全部无词或失败后，才去调用插件。
3. **第三方平台顺序**：默认 `netease` $\to$ `qqmusic` $\to$ `kugou`。

---

## 4. 关键超时陷阱与事故分析（“8秒假死”之谜）

1. **内置平台 8 秒超时（`AbortSignal.timeout(8e3)`）**：
   - 宿主中网易云、QQ 音乐、酷狗的底层 HTTP 请求均硬编码了 8000ms 超时上限；
   - **QQ 音乐正常请求极快（实测约 200~400ms）**；
   - **酷狗（Kugou）**在代理或部分网络环境下极易遭遇连通性故障，一旦挂起就会死死卡满 8 秒超时。
2. **在线 AMLL TTML DB 宕机陷阱（极其重要）**：
   - 设置项中的【在线 TTML 歌词】（`enableOnlineTTMLLyric: true`）在拿到在线歌词后，会请求第三方服务器 `https://amlldb.bikonoo.com/%p/%s.ttml` 尝试升级为 TTML；
   - 该请求超时写死为 8 秒（`TIMEOUT_MS = 8e3`）；
   - **当该第三方服务器宕机/不可达时，即使 QQ 音乐在 200ms 内已经成功拿到 QRC 歌词，也会被强行挂起扣留 8 秒，等 AMLL 请求在第 8 秒超时报错后才把 QRC 释放上屏（现象为“第 8 秒闪 QRC”）**；
   - **规避方案**：在「设置 → 歌词设置」中关闭【在线 TTML 歌词】。
3. **核心网络规律**：
   - 服务器返回 HTTP 404 或空内容仅需几十毫秒，立即放行并写负缓存，**完全不卡顿**；
   - 只有丢包挂起的**网络超时**才会像堵墙一样彻底阻塞整条渲染管线。

---

## 5. 插件端性能优化准则（以 Apple Music TTML 为例）

1. **ISRC 预绑定与零请求桥接**：
   - 跨区 Catalog Song ID 互不通用（探测基本 100% 返回 404，白白浪费 500ms）；
   - 在搜索候选合并时，利用 ISRC（国际标准音像制品编码）与时长将外区候选在内存中直接与账号库歌曲预绑定；
   - 取词时直接使用绑定的账号库 ID，彻底消除 2 次跨区反查网络往返（提速 1.1s ~ 1.5s）。
2. **跳过无效探测**：若未在搜索阶段预绑定且具备 ISRC，直接走 ISRC 反查，坚决不盲测跨区 ID。
3. **负缓存（Negative Caching）不可或缺**：
   - 针对判定为纯逐行（`displayType=2` 或无 `span` 标记）或 404 的歌曲，必须向 `storage` 写入负缓存标记（如 `__NO_SYLLABLE__`）；
   - 二次切歌或列表循环时在 1ms 内瞬间返回空，避免重复经历 3~4 秒长链路。
4. **单请求超时隔离**：
   - 多个曲库并发时，单个请求设置独立超时（如 4500ms），避免单个外区长尾延迟拖死整个 `Promise.all`；
   - 针对 `ECONNRESET` 增加 1 次极简快速自愈重试。
