/**
 * @name        AM TTML Fetch
 * @id          dev.splayer.am-ttml
 * @version     0.1.0
 * @description 搜索 Apple Music 并获取 TTML 逐字歌词（含翻译 / 音译），作为内置歌词源全 miss 时的兜底
 * @author      1412
 * @type        source
 * @apiLevel    1
 * @updateUrl   https://raw.githubusercontent.com/kid141252010/am-ttml-fetch/main/apple-music-ttml.js
 * @changelog   初始版本发布：支持图形化配置、媒体 Token 注入、歌词语言/音译脚本设置及自定义匹配别名库
 */

/* ========================= 常规默认配置 =========================
 * 插件已在 splayer.register 中注册了图形化设置界面。
 * 建议直接在 SPlayer-Next 的「设置 → 插件 → Apple Music TTML → 配置」中填写。
 * 此处的常量作为 GUI 设置项未填写时的兜底默认值。
 * ============================================================ */

/**
 * Media-User-Token：取歌词必需，搜索不需要
 * 浏览器登录 music.apple.com → F12 → 应用/Application → Cookie → 复制 media-user-token 的值
 * 需要 Apple Music 订阅；退出登录或改密码会失效，失效后重新复制一次
 */
const MEDIA_USER_TOKEN = "";

/**
 * 匹配容错档位：strict 严格 / standard 标准（推荐）/ loose 宽松
 * 详见下方 MATCH_LEVELS 说明
 */
const MATCH_LEVEL = "standard";

/**
 * 原文曲库：账号地区曲库会把中日韩曲名译成英文导致匹配不上，
 * 这里指定保留原文的曲库一起搜索，逗号分隔。只听欧美可留空以减少请求
 */
const SEARCH_REGIONS = "cn,jp,tw,kr";

/** 歌词翻译 / 音译语言标签，留空则只取原文 */
const TRANSLATION_LANG = "zh-Hans-CN";

/** 歌词音译 / 脚本标签（l[script]），留空自动由语言标签截取推导 */
const TRANSLATION_SCRIPT = "";

/** 自定义歌手 / 专辑 / 歌名别名映射库，格式为 原词=别名，分号或逗号分隔 */
const CUSTOM_ALIAS_MAP = "五月天=Mayday, 茄子蛋=EggPlantEgg, 告五人=Accusefive";

/** 账号曲库地区，留空自动读取。歌词只存在于账号所属地区曲库，填错会全部取不到 */
const STOREFRONT = "";

/* ======================= 配置声明结束 ======================= */

/** amp-api 校验 Origin，缺失一律 401 */
const AMP_ORIGIN = "https://music.apple.com";
const AMP_BASE = "https://amp-api.music.apple.com/v1";

/** 开发者 token 藏在 web 播放器主 bundle 里，取回后按 exp 缓存复用 */
const WEB_HOME = "https://music.apple.com/";
const BUNDLE_RE = /["'](\/assets\/index~[A-Za-z0-9]+\.js)["']/;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/** 单个曲库的搜索条数 */
const SEARCH_LIMIT = 10;

/** 歌词缓存条目上限，超出按写入顺序淘汰 */
const LYRIC_CACHE_MAX = 50;

/**
 * 匹配容错档位
 *
 * 打分与门槛都在宿主侧，插件唯一的调节手段是上报候选时补不补歌手别名
 * （Apple 常用本名 / 罗马字，与其它平台写法对不上，宿主的歌手门槛会拒掉本该采纳的候选）：
 * - strict：原样上报 Apple 数据，歌手写法不一致就放弃
 * - standard：候选曲名与关键词开头完全吻合时补别名
 * - loose：曲名带 (Live) 等后缀、只与关键词共享前缀时也补别名
 */
const MATCH_LEVELS = {
  strict: { alias: "off" },
  standard: { alias: "exact" },
  loose: { alias: "prefix" },
};

/** loose 档下，曲名与关键词的公共前缀至少要有这么长才认为指向同一首歌 */
const MIN_COMMON_PREFIX = 2;

splayer.register({
  sources: {
    am: {
      name: "Apple Music",
      actions: ["musicSearch", "musicLyric"],
      qualities: [],
    },
  },
  settings: [
    {
      key: "mediaUserToken",
      type: "text",
      label: "Media-User-Token",
      description: "Apple Music 登录 Token（Cookie 中以 0.Avks... 开头，取歌词必需）",
      default: "",
      placeholder: "粘贴 media-user-token 字符串",
    },
    {
      key: "storefront",
      type: "text",
      label: "账号曲库地区",
      description: "订阅账号所属 2 位地区代码（如 cn, us, ca, jp），留空自动获取",
      default: "",
      placeholder: "留空自动读取",
    },
    {
      key: "matchLevel",
      type: "select",
      label: "匹配容错档位",
      description: "歌手别名补偿策略（针对 Apple 歌手译名差异）",
      default: "standard",
      options: [
        { label: "严格 (strict) - 不补偿歌手别名", value: "strict" },
        { label: "标准 (standard) - 推荐，曲名精确吻合时补别名", value: "standard" },
        { label: "宽松 (loose) - 允许带 (Live) 等后缀匹配时补别名", value: "loose" },
      ],
    },
    {
      key: "searchRegions",
      type: "text",
      label: "原文辅助搜索曲库",
      description: "保留原文搜索的地区列表（逗号分隔），防止中日韩曲名被自动英译后匹配失败",
      default: "cn,jp,tw,kr",
      placeholder: "cn,jp,tw,kr",
    },
    {
      key: "translationLang",
      type: "text",
      label: "歌词翻译/语言 (l[lyrics])",
      description: "请求歌词时的语言标签（如 zh-Hans-CN），留空只获取原文",
      default: "zh-Hans-CN",
      placeholder: "zh-Hans-CN",
    },
    {
      key: "translationScript",
      type: "text",
      label: "歌词音译/脚本 (l[script])",
      description: "歌词音译或字形体系（如 Japanese, Romaji, zh-Hans），留空自动推导",
      default: "",
      placeholder: "留空自动推导",
    },
    {
      key: "customAliasMap",
      type: "text",
      label: "自定义匹配别名库",
      description: "格式为「原词=别名」，逗号或换行分隔（如 五月天=Mayday, 茄子蛋=EggPlantEgg）。用于外区搜索与准确比对",
      default: "五月天=Mayday, 茄子蛋=EggPlantEgg, 告五人=Accusefive",
      placeholder: "五月天=Mayday, 茄子蛋=EggPlantEgg",
    },
  ],
});

/** 解析用户配置的自定义别名映射清单 [{ raw, alias }, ...] */
const getCustomAliasEntries = () => {
  const str = getSettingOrConst("customAliasMap", CUSTOM_ALIAS_MAP);
  if (!str) return [];
  const items = String(str).split(/[\n,;]+/);
  const entries = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const raw = trimmed.slice(0, eqIndex).trim();
      const alias = trimmed.slice(eqIndex + 1).trim();
      if (raw && alias) {
        entries.push({ raw, alias });
      }
    }
  }
  return entries;
};

/** 优先读取图形设置界面的值，若未配置或为空则使用脚本静态常量 */
const getSettingOrConst = (key, fallbackConst) => {
  const val = splayer.getSetting(key);
  if (val !== undefined && val !== null && String(val).trim() !== "") {
    return String(val).trim();
  }
  return fallbackConst;
};

/** base64url 解码为字符串 */
const decodeBase64Url = (input) => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
};

/** 读取 JWT 载荷，非法则返回 null */
const readJwtPayload = (token) => {
  try {
    return JSON.parse(decodeBase64Url(token.split(".")[1]));
  } catch {
    return null;
  }
};

/** 带鉴权头请求 amp-api */
const ampRequest = async (path, devToken, mediaUserToken) => {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${devToken}`,
    Origin: AMP_ORIGIN,
  };
  if (mediaUserToken) headers["Media-User-Token"] = mediaUserToken;
  const resp = await splayer.request(`${AMP_BASE}${path}`, { headers, responseType: "json" });
  return { status: resp.status, body: resp.body };
};

/**
 * 从 web 端 bundle 里抓可用的开发者 token
 * bundle 内混有多个签发方的 JWT，AMPWebPlay 优先，逐个探测直到接口放行
 * @returns token 与过期时间戳（秒）
 */
const fetchDevToken = async () => {
  const home = await splayer.request(WEB_HOME, { timeout: 20_000 });
  const bundlePath = BUNDLE_RE.exec(String(home.body ?? ""))?.[1];
  if (!bundlePath) throw new Error("未能在首页定位到 web player bundle");

  const bundle = await splayer.request(`${AMP_ORIGIN}${bundlePath}`, { timeout: 45_000 });
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set();
  const candidates = [];
  for (const token of String(bundle.body ?? "").match(JWT_RE) ?? []) {
    if (seen.has(token)) continue;
    seen.add(token);
    const payload = readJwtPayload(token);
    if (!payload?.exp || payload.exp <= now) continue;
    candidates.push({ token, exp: payload.exp, iss: payload.iss });
  }
  if (candidates.length === 0) throw new Error("bundle 中没有未过期的开发者 token");
  candidates.sort((a, b) => Number(b.iss === "AMPWebPlay") - Number(a.iss === "AMPWebPlay"));

  for (const candidate of candidates) {
    const probe = await ampRequest(
      "/catalog/us/search?term=a&types=songs&limit=1",
      candidate.token,
    );
    if (probe.status === 200) return candidate;
  }
  throw new Error("bundle 中的开发者 token 均被拒绝");
};

/** 进程内 token 缓存，避免同一次会话反复读 storage */
let devTokenCache = null;
let devTokenTask = null;

/**
 * 取可用的开发者 token
 * 顺序：内存 → storage → 重新抓取；并发调用共享同一次抓取
 * @param force - 忽略缓存强制重取（token 被服务端提前作废时用）
 */
const getDevToken = async (force = false) => {
  const now = Math.floor(Date.now() / 1000);
  // 留 5 分钟余量，避免边界期取到刚过期的 token
  const valid = (entry) => entry?.token && entry.exp - 300 > now;

  if (!force && valid(devTokenCache)) return devTokenCache.token;
  if (!force) {
    const stored = await splayer.storage.get("devToken");
    if (valid(stored)) {
      devTokenCache = stored;
      return stored.token;
    }
  }
  if (!devTokenTask) {
    devTokenTask = fetchDevToken()
      .then(async (entry) => {
        devTokenCache = entry;
        await splayer.storage.set("devToken", entry);
        splayer.log.info(`开发者 token 已就绪，issuer=${entry.iss}`);
        return entry.token;
      })
      .finally(() => {
        devTokenTask = null;
      });
  }
  return devTokenTask;
};

/** 读取用户配置或脚本顶部的 Media-User-Token */
const requireMediaUserToken = () => {
  const token = getSettingOrConst("mediaUserToken", MEDIA_USER_TOKEN);
  if (!token) {
    throw new Error(
      "请先在插件设置中填写 Media-User-Token（设置 → 插件 → Apple Music TTML → 配置）",
    );
  }
  return token;
};

/**
 * 请求 amp-api，401 时重取一次开发者 token 后重试
 * Apple 会提前轮换 token，重试一次即可自愈，无需用户干预
 */
const ampRequestWithRetry = async (path, mediaUserToken) => {
  let resp = await ampRequest(path, await getDevToken(), mediaUserToken);
  if (resp.status === 401) {
    resp = await ampRequest(path, await getDevToken(true), mediaUserToken);
  }
  return resp;
};

/**
 * 取账号所属曲库地区
 * 用户显式填写优先，否则读账号地区并按 token 缓存
 */
const getAccountStorefront = async (mediaUserToken) => {
  const manual = getSettingOrConst("storefront", STOREFRONT).toLowerCase();
  if (manual) return manual;

  const md5Fn = (splayer.crypto || splayer.utils?.crypto)?.md5;
  const cacheKey = `storefront:${md5Fn ? md5Fn(mediaUserToken) : mediaUserToken}`;
  const cached = await splayer.storage.get(cacheKey);
  if (cached) return cached;

  const resp = await ampRequestWithRetry("/me/storefront", mediaUserToken);
  const storefront = resp.body?.data?.[0]?.id;
  if (!storefront) {
    throw new Error(`无法读取账号地区（HTTP ${resp.status}），请检查 Media-User-Token 是否有效`);
  }
  await splayer.storage.set(cacheKey, storefront);
  splayer.log.info(`账号曲库地区：${storefront}`);
  return storefront;
};

/** 解析原文曲库列表，账号地区置首（它的 id 能直接取词，无需桥接） */
const getSearchStorefronts = (accountStorefront) => {
  const regions = getSettingOrConst("searchRegions", SEARCH_REGIONS);
  const extra = String(regions ?? "")
    .toLowerCase()
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== accountStorefront);
  return [accountStorefront, ...new Set(extra)];
};

/** 读取匹配容错档位，未识别的值退回标准档 */
const getMatchLevel = () => {
  const levelKey = getSettingOrConst("matchLevel", MATCH_LEVEL);
  return MATCH_LEVELS[levelKey] ?? MATCH_LEVELS.standard;
};

/** 与宿主 normalize 对齐，用于比对曲名并从关键词里剥出歌手 */
const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");

/**
 * 从搜索关键词里剥出歌手部分
 *
 * 宿主关键词为 `歌名 + 歌手`，候选曲名与关键词开头吻合时，余下即宿主看到的歌手写法。
 * Apple 常用歌手本名或罗马字（买辣椒也用券 → 冯沁苑LaJiao），与其它平台写法对不上，
 * 宿主的歌手门槛会因此拒掉本可采纳的候选；此处把宿主自己的写法作为别名补回去。
 * @param mode - off 不补 / exact 曲名须为关键词前缀 / prefix 允许曲名带后缀
 * @returns 歌手别名，无法可靠剥出时返回空串
 */
const deriveArtistAlias = (keyword, candidateName, mode) => {
  if (mode === "off") return "";
  const flatKeyword = normalize(keyword);
  const flatName = normalize(candidateName);
  if (!flatName) return "";

  if (flatKeyword.startsWith(flatName)) {
    const rest = flatKeyword.slice(flatName.length);
    return rest.length >= 2 ? rest : "";
  }
  if (mode !== "prefix") return "";

  // 曲名带 (Live) 等后缀时与关键词只共享前缀，公共部分够长才认为是同一首
  let common = 0;
  while (common < flatName.length && common < flatKeyword.length) {
    if (flatName[common] !== flatKeyword[common]) break;
    common++;
  }
  if (common < MIN_COMMON_PREFIX) return "";
  const rest = flatKeyword.slice(common);
  return rest.length >= 2 ? rest : "";
};

/** 在单个曲库里搜候选，失败不影响其它曲库 */
const searchStorefront = async (storefront, keyword, mediaUserToken) => {
  const path = `/catalog/${storefront}/search?term=${encodeURIComponent(keyword)}&types=songs&limit=${SEARCH_LIMIT}`;
  const resp = await ampRequestWithRetry(path, mediaUserToken);
  if (resp.status !== 200) {
    splayer.log.warn(`搜索失败 sf=${storefront} HTTP ${resp.status}`);
    return [];
  }
  const list = [];
  for (const item of resp.body?.results?.songs?.data ?? []) {
    const attrs = item.attributes ?? {};
    if (!attrs.hasLyrics) continue;
    list.push({
      id: String(item.id),
      name: attrs.name ?? "",
      singer: attrs.artistName ?? "",
      album: attrs.albumName ?? "",
      durationMs: attrs.durationInMillis,
      storefront,
      isrc: attrs.isrc ?? "",
    });
  }
  return list;
};

/** 时长足够接近，视为同一录音 */
const sameRecording = (leftMs, rightMs) =>
  Boolean(leftMs) && Boolean(rightMs) && Math.abs(leftMs - rightMs) <= 2000;

splayer.on("musicSearch", async ({ keyword }) => {
  const mediaUserToken = requireMediaUserToken();
  const accountStorefront = await getAccountStorefront(mediaUserToken);
  const storefronts = getSearchStorefronts(accountStorefront);
  const aliasEntries = getCustomAliasEntries();

  // 若关键词命中了自定义别名映射（如 "五月天" -> "Mayday"），自动追加衍生词并发搜索
  const searchKeywords = [keyword];
  for (const entry of aliasEntries) {
    if (keyword.toLowerCase().includes(entry.raw.toLowerCase())) {
      const expanded = keyword.replace(new RegExp(entry.raw, "gi"), entry.alias);
      if (!searchKeywords.includes(expanded)) searchKeywords.push(expanded);
    } else if (keyword.toLowerCase().includes(entry.alias.toLowerCase())) {
      const expanded = keyword.replace(new RegExp(entry.alias, "gi"), entry.raw);
      if (!searchKeywords.includes(expanded)) searchKeywords.push(expanded);
    }
  }

  // 对原词及别名扩充词在各曲库并发搜索
  const searchTasks = [];
  for (const kw of searchKeywords) {
    for (const sf of storefronts) {
      searchTasks.push(
        searchStorefront(sf, kw, mediaUserToken).catch((err) => {
          splayer.log.warn(`搜索异常 sf=${sf} kw=${kw}`, err?.message);
          return [];
        }),
      );
    }
  }
  const groups = await Promise.all(searchTasks);
  const all = groups.flat();
  const accountItems = all.filter((item) => item.storefront === accountStorefront);
  const flatKeyword = normalize(keyword);

  // 同一 catalog id 在各曲库是同一录音、仅曲名本地化不同；按 id 合并，
  // 取「曲名恰为宿主关键词前缀」的那份，宿主的曲名门槛才过得去
  const merged = new Map();
  for (const item of all) {
    const kept = merged.get(item.id);
    if (!kept) {
      merged.set(item.id, { ...item, inAccount: item.storefront === accountStorefront });
      continue;
    }
    kept.inAccount = kept.inAccount || item.storefront === accountStorefront;
    const keptMatches = flatKeyword.startsWith(normalize(kept.name));
    if (!keptMatches && flatKeyword.startsWith(normalize(item.name))) {
      kept.name = item.name;
      kept.singer = item.singer;
      kept.album = item.album;
    }
  }

  const level = getMatchLevel();
  const list = [];
  for (const item of merged.values()) {
    // 不在账号库的候选按时长认领一条账号库同录音，取词时免去桥接
    if (!item.inAccount) {
      const twin = accountItems.find((cand) => sameRecording(cand.durationMs, item.durationMs));
      if (twin) item.accountId = twin.id;
    }
    const alias = deriveArtistAlias(keyword, item.name, level.alias);
    let singer = item.singer;
    if (alias) {
      singer = `${singer}/${alias}`;
    }
    // 根据自定义别名映射表（如 五月天=Mayday），自动双向补全别名
    for (const entry of aliasEntries) {
      const normSinger = normalize(singer);
      const normRaw = normalize(entry.raw);
      const normAlias = normalize(entry.alias);
      if (normSinger.includes(normRaw) && !singer.split("/").includes(entry.alias)) {
        singer = `${singer}/${entry.alias}`;
      } else if (normSinger.includes(normAlias) && !singer.split("/").includes(entry.raw)) {
        singer = `${singer}/${entry.raw}`;
      }
    }
    list.push({ ...item, singer });
  }
  return { list };
});

/**
 * 定位候选在账号曲库里的歌曲 id
 * 歌词只存在于账号所属曲库，原文库搜到的 id 直接取词多半 404
 * 顺序：搜索阶段认领的同录音 id → 同 id 在账号库直接可用 → ISRC 反查
 * @returns 账号曲库内的歌曲 id，定位不到返回 null
 */
const resolveAccountSongId = async (musicInfo, accountStorefront, mediaUserToken) => {
  if (musicInfo.inAccount || musicInfo.storefront === accountStorefront) return musicInfo.id;
  if (musicInfo.accountId) return String(musicInfo.accountId);

  const cacheKey = `bridge:${accountStorefront}:${musicInfo.storefront}:${musicInfo.id}`;
  const cached = await splayer.storage.get(cacheKey);
  if (cached) return cached;

  // 同一 catalog id 常在多个曲库通用，先直接探一次
  const direct = await ampRequestWithRetry(
    `/catalog/${accountStorefront}/songs/${musicInfo.id}`,
    mediaUserToken,
  );
  if (direct.status === 200) {
    await splayer.storage.set(cacheKey, musicInfo.id);
    return musicInfo.id;
  }

  if (!musicInfo.isrc) return null;
  const path = `/catalog/${accountStorefront}/songs?filter%5Bisrc%5D=${encodeURIComponent(musicInfo.isrc)}`;
  const resp = await ampRequestWithRetry(path, mediaUserToken);
  if (resp.status !== 200) return null;

  // 同一 ISRC 可能对应多个版本，优先带逐字歌词、且时长确属同一录音的那条
  const matches = (resp.body?.data ?? []).filter(
    (item) =>
      !musicInfo.durationMs ||
      sameRecording(item.attributes?.durationInMillis, musicInfo.durationMs),
  );
  const best =
    matches.find((item) => item.attributes?.hasTimeSyncedLyrics) ??
    matches.find((item) => item.attributes?.hasLyrics);
  if (!best) return null;
  const id = String(best.id);
  await splayer.storage.set(cacheKey, id);
  return id;
};

/** 从歌词响应里取出 TTML，带翻译的本地化版本优先 */
const pickTTML = (body) => {
  const attrs = body?.data?.[0]?.attributes;
  if (!attrs) return "";
  const localized = attrs.ttmlLocalizations;
  return String((typeof localized === "string" && localized) || attrs.ttml || "");
};

/**
 * 预处理 TTML：
 * 若翻译段标头包含 type="replacement" 且 xml:lang 包含 zh-Hans（简体中文替换型翻译），
 * 直接丢弃整块 <translation>...</translation> 完整翻译。
 */
const filterReplacementZhHansTranslation = (ttml) => {
  if (!ttml || typeof ttml !== "string") return ttml;
  return ttml
    .replace(/<translation\b[\s\S]*?<\/translation>/gi, (block) => {
      const isReplacement = /\btype=["']replacement["']/i.test(block);
      const isZhHans = /\bxml:lang=["']zh-Hans/i.test(block);
      if (isReplacement && isZhHans) {
        splayer.log.info("检测到 type=replacement 且 xml:lang=zh-Hans 标头，直接丢弃完整翻译");
        return "";
      }
      return block;
    })
    .replace(/<translation\b[^>]*\/>/gi, (tag) => {
      const isReplacement = /\btype=["']replacement["']/i.test(tag);
      const isZhHans = /\bxml:lang=["']zh-Hans/i.test(tag);
      return isReplacement && isZhHans ? "" : tag;
    });
};

/** 写入歌词缓存，按写入顺序淘汰最旧条目 */
const cacheLyric = async (key, ttml) => {
  const index = (await splayer.storage.get("lyricIndex")) ?? [];
  const next = index.filter((item) => item !== key);
  next.push(key);
  while (next.length > LYRIC_CACHE_MAX) {
    await splayer.storage.remove(next.shift());
  }
  await splayer.storage.set(key, ttml);
  await splayer.storage.set("lyricIndex", next);
};

/** 拼歌词请求的翻译 / 音译参数 */
const buildLyricQuery = (lang, script) => {
  const query = ["extend=ttmlLocalizations"];
  if (lang) {
    query.push(`l%5Blyrics%5D=${encodeURIComponent(lang)}`);
  }
  const finalScript = script || (lang ? lang.split("-").slice(0, 2).join("-") : "");
  if (finalScript) {
    query.push(`l%5Bscript%5D=${encodeURIComponent(finalScript)}`);
  }
  return `?${query.join("&")}`;
};

splayer.on("musicLyric", async ({ musicInfo }) => {
  const mediaUserToken = requireMediaUserToken();
  const accountStorefront = await getAccountStorefront(mediaUserToken);

  const songId = await resolveAccountSongId(musicInfo, accountStorefront, mediaUserToken);
  if (!songId) {
    splayer.log.warn(`候选不在账号曲库内，跳过 id=${musicInfo.id} sf=${musicInfo.storefront}`);
    return { lyric: "" };
  }

  const lang = getSettingOrConst("translationLang", TRANSLATION_LANG);
  const script = getSettingOrConst("translationScript", TRANSLATION_SCRIPT);
  const cacheKey = `lyric:${accountStorefront}:${songId}:${lang}:${script}`;
  const cached = await splayer.storage.get(cacheKey);
  if (cached) return { lyric: cached, awlyric: cached };

  // 逐字接口取不到时退到行级歌词，两者都是 TTML，宿主解析路径一致
  const suffix = buildLyricQuery(lang, script);
  const base = `/catalog/${accountStorefront}/songs/${songId}`;
  let resp = await ampRequestWithRetry(`${base}/syllable-lyrics${suffix}`, mediaUserToken);
  if (resp.status === 404) {
    resp = await ampRequestWithRetry(`${base}/lyrics${suffix}`, mediaUserToken);
  }
  if (resp.status === 403) {
    throw new Error("Media-User-Token 无效或已过期，请在插件设置里重新填写");
  }
  if (resp.status !== 200) {
    splayer.log.warn(`歌词请求失败 HTTP ${resp.status} id=${songId} sf=${accountStorefront}`);
    return { lyric: "" };
  }

  let ttml = pickTTML(resp.body);
  if (!ttml) return { lyric: "" };
  ttml = filterReplacementZhHansTranslation(ttml);
  if (!ttml.trim()) return { lyric: "" };

  await cacheLyric(cacheKey, ttml);
  // lyric 非空是宿主采纳的门槛，awlyric 让宿主走逐字解析
  return { lyric: ttml, awlyric: ttml };
});
