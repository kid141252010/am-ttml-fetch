/**
 * @name        AM TTML Fetch
 * @id          dev.splayer.am-ttml-fetch
 * @version     0.2.0
 * @description 搜索 Apple Music 并获取 TTML 逐字歌词（含翻译 / 音译），作为内置歌词源全 miss 时的兜底
 * @author      1412
 * @type        source
 * @apiLevel    1
 * @updateUrl   https://raw.githubusercontent.com/kid141252010/am-ttml-fetch/main/am-ttml-fetch.js
 * @changelog   修复多版本专辑中 Live 现场版抢占正式录音室专辑版导致取到逐行歌词的 Bug
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

/** 与宿主 normalize 对齐，用于比对曲名并从关键词里剥出歌手（强化标点、全角符号与省略号） */
const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[、&;，,/|()（）\[\]【】{}《》·・\s\-_'"`~!?？！.。…\^]+/g, "");

/** 合作伴唱后缀正则（如 (feat. xxx), （feat. xxx）, [with xxx] 等） */
const FEAT_PATTERN = /[\(\（\[\【](?:feat|ft|featuring|with)\b[^\)\）\]\】]*[\)\）\]\】]/gi;

/** 剥离曲名或关键词中的 feat / with 等伴唱后缀 */
const stripFeat = (text) => String(text ?? "").replace(FEAT_PATTERN, "").trim();

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
  const cleanKw = stripFeat(keyword);
  const flatKeyword = normalize(cleanKw);
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
      hasTimeSyncedLyrics: Boolean(attrs.hasTimeSyncedLyrics),
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

  // 1. 基础词与剥离 feat 伴唱后的派生词
  const searchKeywords = [keyword];
  const cleanKeyword = stripFeat(keyword);
  if (cleanKeyword && cleanKeyword !== keyword && !searchKeywords.includes(cleanKeyword)) {
    searchKeywords.push(cleanKeyword);
  }

  // 2. 若关键词命中了自定义别名映射（如 "五月天" -> "Mayday"），自动追加衍生词并发搜索
  const currentKeywords = [...searchKeywords];
  for (const kw of currentKeywords) {
    for (const entry of aliasEntries) {
      if (kw.toLowerCase().includes(entry.raw.toLowerCase())) {
        const expanded = kw.replace(new RegExp(entry.raw, "gi"), entry.alias);
        if (!searchKeywords.includes(expanded)) searchKeywords.push(expanded);
      } else if (kw.toLowerCase().includes(entry.alias.toLowerCase())) {
        const expanded = kw.replace(new RegExp(entry.alias, "gi"), entry.raw);
        if (!searchKeywords.includes(expanded)) searchKeywords.push(expanded);
      }
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
  const flatKeyword = normalize(cleanKeyword || keyword);

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

    // 智能曲名对齐：当候选的核心歌名与关键词的核心歌名吻合时，
    // 精准将候选名称对齐为搜索关键词中的曲名格式（完全保持与宿主一致的全角括号、feat 等标点写法），
    // 彻底解决宿主由于未过滤全角括号（）和中括号[]导致比对失败的致命问题！
    let name = item.name;
    const cleanCand = normalize(stripFeat(item.name));
    const cleanKw = normalize(stripFeat(keyword));
    if (cleanCand && (cleanKw.startsWith(cleanCand) || cleanCand.startsWith(cleanKw))) {
      const featMatches = keyword.match(FEAT_PATTERN);
      if (featMatches && featMatches[0]) {
        const featIdx = keyword.indexOf(featMatches[0]);
        name = keyword.slice(0, featIdx + featMatches[0].length).trim();
      } else {
        // 无 feat 时，从关键词中剥离歌手，保留与宿主完全一致的歌名原文字符
        let rawTitle = keyword.trim();
        for (const artist of singer.split("/")) {
          const trimmed = artist.trim();
          if (trimmed && rawTitle.toLowerCase().endsWith(trimmed.toLowerCase())) {
            rawTitle = rawTitle.slice(0, -trimmed.length).trim();
          }
        }
        if (rawTitle) name = rawTitle;
      }
    }

    list.push({ ...item, name, singer });
  }

  // 关键排序：非 Live 关键词下，优先录音室专辑正式版排在前面，防止被 Live 现场版（通常为逐行歌词）抢占
  const isKeywordLive = /\blive\b/i.test(keyword);
  list.sort((a, b) => {
    const aIsLive = /\blive\b/i.test(a.name) || /\blive\b/i.test(a.album);
    const bIsLive = /\blive\b/i.test(b.name) || /\blive\b/i.test(b.album);
    if (!isKeywordLive && aIsLive !== bIsLive) {
      return aIsLive ? 1 : -1;
    }
    if (a.hasTimeSyncedLyrics !== b.hasTimeSyncedLyrics) {
      return b.hasTimeSyncedLyrics ? 1 : -1;
    }
    return 0;
  });

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

/** 单次请求繁化姬转换接口 */
const fetchZhConvertOnce = async (text) => {
  const resp = await splayer.request("https://api.zhconvert.org/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      converter: "Simplified",
    }),
    timeout: 1500,
  });
  const body = typeof resp?.body === "string" ? JSON.parse(resp.body) : resp?.body;
  if (body?.code === 0 && typeof body?.data?.text === "string") {
    return body.data.text;
  }
  throw new Error(body?.msg || `状态码异常: ${resp?.status}`);
};

/**
 * 使用繁化姬 API (https://api.zhconvert.org/) 将繁体文本转为简体中文
 * 策略：1.5 秒极速超时熔断；若网络缓慢或不可达则立即返回原文，绝不阻塞歌词显示
 */
const convertToZhHans = async (text) => {
  if (!text || typeof text !== "string") return { text, success: false };

  try {
    const fetchPromise = fetchZhConvertOnce(text);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("繁化姬响应超过 1.5s 触发极速熔断")), 1500),
    );

    const convertedText = await Promise.race([fetchPromise, timeoutPromise]);
    splayer.log.info("繁化姬简体化转换成功");
    return { text: convertedText, success: true };
  } catch (err) {
    splayer.log.warn("繁化姬简体化转换超时/不可达，直接返回原版歌词:", err?.message);
  }

  return { text, success: false };
};

/**
 * 预处理 TTML：
 * 1. 若翻译段标头包含 type="replacement" 且 xml:lang 包含 zh-Hans（简体中文替换型翻译），直接丢弃整块 <translation>...</translation> 完整翻译。
 * 2. 若 XML 的语言声明包含 zh-Hant 前缀（如 zh-Hant, zh-Hant-TW, zh-Hant-HK），调用繁化姬 API (8s 总超时/4s 重试) 转换为简体中文；转换成功则更新 xml:lang 为 zh-Hans，失败/超时则直接兜底返回原文。
 */
const processTTMLSimplified = async (ttml) => {
  if (!ttml || typeof ttml !== "string") return ttml;

  // 1. 照旧丢弃 zh-Hans 的 replacement 翻译段
  let processed = filterReplacementZhHansTranslation(ttml);

  // 2. 检测 XML 声明中是否含有 zh-Hant 前缀（如 zh-Hant, zh-Hant-TW, zh-Hant-HK 等）
  const hasZhHant = /\bxml:lang=["']zh-Hant([-_][a-zA-Z0-9]+)?["']/i.test(processed);
  if (hasZhHant) {
    splayer.log.info("检测到 zh-Hant 语言声明，调用繁化姬 API 进行简体化转换 (8s 超时 / 4s 重试)");
    const { text: converted, success } = await convertToZhHans(processed);
    processed = converted;
    // 仅在繁化姬成功转换后才将语言声明改为 zh-Hans，超时/失败保留原声明
    if (success) {
      processed = processed.replace(
        /\bxml:lang=["']zh-Hant([-_][a-zA-Z0-9]+)?["']/gi,
        'xml:lang="zh-Hans"',
      );
    }
  }

  return processed;
};

/**
 * 校验 TTML 是否为逐字歌词（Syllable-level）：
 * 只要主歌词中包含带有 begin 时间戳的 <span> 标签即为逐字歌词。
 * （注意：不能全局检查 itunes:timing="None"，因为内嵌的翻译段通常被 Apple 标记为 None）
 */
const isSyllableTTML = (ttml) => {
  if (!ttml || typeof ttml !== "string") return false;
  return /<span\b[^>]*\b(begin|end)\s*=/i.test(ttml);
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
  if (cached) {
    if (isSyllableTTML(cached)) {
      return { lyric: cached, awlyric: cached };
    }
    // 缓存中若是旧的逐行歌词，清除旧缓存
    await splayer.storage.remove(cacheKey);
  }

  // 仅请求逐字歌词接口；不请求/降级到纯逐行的 /lyrics 接口
  const suffix = buildLyricQuery(lang, script);
  const base = `/catalog/${accountStorefront}/songs/${songId}`;
  const resp = await ampRequestWithRetry(`${base}/syllable-lyrics${suffix}`, mediaUserToken);
  if (resp.status === 403) {
    throw new Error("Media-User-Token 无效或已过期，请在插件设置里重新填写");
  }
  if (resp.status !== 200) {
    splayer.log.warn(`歌词请求失败 HTTP ${resp.status} id=${songId} sf=${accountStorefront}`);
    return { lyric: "" };
  }

  const attrs = resp.body?.data?.[0]?.attributes;
  if (!attrs) return { lyric: "" };

  // 1. 如果 displayType 是 2（或者不是 1），判定为普通逐行歌词，丢弃
  if (attrs.displayType === 2 || String(attrs.displayType) === "2") {
    splayer.log.info(`歌词为逐行类型 (displayType=2)，丢弃不传给宿主 id=${songId}`);
    return { lyric: "" };
  }

  let ttml = pickTTML(resp.body);
  if (!ttml) return { lyric: "" };
  ttml = await processTTMLSimplified(ttml);
  if (!ttml.trim()) return { lyric: "" };

  // 2. 严格校验 TTML 内容是否具备逐字 span 时间戳
  if (!isSyllableTTML(ttml)) {
    splayer.log.info(`TTML 内容为逐行歌词（无逐字 span 标记），丢弃不传给宿主 id=${songId}`);
    return { lyric: "" };
  }

  await cacheLyric(cacheKey, ttml);
  // lyric 非空是宿主采纳的门槛，awlyric 让宿主走逐字解析
  return { lyric: ttml, awlyric: ttml };
});
