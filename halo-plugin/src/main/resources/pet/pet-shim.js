// whale-pet-live2d — Halo 侧的启动垫片（bootstrap shim）。
//
// 这是**唯一**由 Halo 插件注入到页面里的一行：
//
//   <script defer src="/plugins/whale-pet-live2d/assets/v<版本>/pet-shim.js"
//           data-config='{"base":"...","coreUrl":"..."}'></script>
//
// 剩下的加载顺序全部由本文件按次序动态插入，原因有两个：
//
//   1. **顺序是硬约束**：React 必须先于 client.js，client.js 必须先于 pet-halo.js
//      （它要调用 `apply()`）。多个 `<script defer>` 也能保证顺序，但主题的
//      `<head>`/`<halo:footer />` 位置不由我们控制，一次注入比五次注入少很多变数。
//   2. **CSP**：Halo 的 CSP 可能禁掉内联脚本，所以配置不是内联 JS，而是挂在本
//      `<script>` 自己的 `data-config` 属性上 —— 页面里没有一个内联脚本。
//
// 这里刻意**不改 client.js 的任何行为**：它所依赖的 `window.__ModuleLoader__`
// 垫片与桌面壳（`dsh-live2d-pet-desktop/sidecar/page/`）、以及浏览器测试 harness
// （`tools/browser-test/index.html`）里那两份是同一个套路。
(function () {
  "use strict";

  /** 全局读口：driver 断言"启动到底成没成"，不靠猜。 */
  const boot = {
    ok: false,
    stage: "init",
    error: null,
    config: null,
    startedAt: Date.now(),
    ms: null,
    files: [],
  };
  window.__dshLive2dPetBoot = boot;

  /** 同一个页面里被注入两次（主题 + 插件都挂了）时，第二次直接让位。 */
  if (window.__dshLive2dPetShimLoaded === true) {
    boot.stage = "duplicate";
    boot.ok = true;
    boot.ms = 0;
    return;
  }
  window.__dshLive2dPetShimLoaded = true;

  // ---------------------------------------------------------------- 配置

  /**
   * 配置来源，两个都认：
   *
   *   1. **首选**：服务端注入的 `<script type="application/json" id="…">{…}</script>` ——
   *      配置在**标签体**里，所以不存在"属性值转义"这一整类问题（Thymeleaf 不替属性值转义，
   *      塞在属性里就得自己把 `"` 换成 `&quot;`，少一个就是属性断掉、桌宠不启动）。
   *   2. 兜底：老的 `data-config` 属性写法（万一页面被中间件/主题重写过）。
   *
   * `document.currentScript` 仍然用来定位本脚本自己的 URL（同目录的兄弟文件按它拼）。
   */
  function readConfig() {
    const block = document.getElementById("whale-pet-live2d-config");
    if (block !== null) {
      const text = block.textContent === null ? "" : block.textContent;
      if (text.trim() !== "") {
        try {
          const parsed = JSON.parse(text);
          if (parsed !== null && typeof parsed === "object") return { config: parsed, source: "json-block" };
        } catch (error) {
          boot.error = "application/json 配置块不是合法 JSON：" + String(error && error.message ? error.message : error);
        }
      }
    }
    let raw = null;
    const current = document.currentScript;
    if (current !== null && current !== undefined) raw = current.getAttribute("data-config");
    if (raw === null || raw === "") {
      const carried = document.getElementById("whale-pet-live2d-config");
      if (carried !== null) raw = carried.getAttribute("data-config");
    }
    if (raw === null || raw === "") return { config: {}, source: "none" };
    try {
      const parsed = JSON.parse(raw);
      return { config: parsed !== null && typeof parsed === "object" ? parsed : {}, source: "attribute" };
    } catch (error) {
      boot.error = "data-config 不是合法 JSON：" + String(error && error.message ? error.message : error);
      return { config: {}, source: "attribute-broken" };
    }
  }

  const read = readConfig();
  const config = read.config;
  boot.config = config;
  boot.configSource = read.source;
  window.__dshLive2dPetConfig = config;

  /** 本脚本所在目录 —— 同目录的兄弟文件都按它拼，插件名改了也不用动这里。 */
  const here = (() => {
    const current = document.currentScript;
    const src = current !== null && current !== undefined ? current.src : "";
    if (src === "") {
      const fallback = typeof config.base === "string" ? config.base.replace(/\/+$/, "") : "";
      return fallback === "" ? "" : fallback + "/";
    }
    return src.slice(0, src.lastIndexOf("/") + 1);
  })();

  /**
   * 静态托管的根：catalog / 资产 / vendor 都在它下面。
   *
   * 正常来源是 `data-config.base`。但如果那个属性**被弄坏了**（典型是服务端忘了把
   * JSON 里的双引号转成 `&quot;` —— 属性会在第一个内层引号处断掉），就从本脚本自己的
   * URL 推一份出来，别让整只宠物白屏。**兜住的同时留证据**：`configRecovered = true`，
   * 配套的自检拿它当失败 —— "属性坏了"必须被看见，不能被悄悄兜住。
   */
  let base = typeof config.base === "string" && config.base !== ""
    ? config.base.replace(/\/+$/, "")
    : null;
  if (base === null && here !== "") {
    base = here.replace(/\/+$/, "");
    boot.configRecovered = true;
    try {
      console.warn("[whale-pet-live2d] data-config 里没有可用的 base，已按脚本自身地址兜底："
        + base + "（多半是服务端注入属性时没转义双引号）");
    } catch { /* 有些壳没有 console */ }
  }
  if (base === null) {
    boot.stage = "config";
    boot.error = "data-config 缺少 base，且无法从脚本 URL 推出静态资源根";
    return;
  }

  // client.js 在**模块加载期**就读这个全局：base 决定它去哪取 catalog，
  // `static: true` 让它别去问 `/layer`、`/settings`、`/events`（静态目录里没有这些路由）。
  // 注意 coreUrl 允许为空：那时 client.js 用 catalog 里写的那个地址（官方 CDN）。
  const host = { base: base, static: true };
  if (typeof config.coreUrl === "string" && config.coreUrl !== "") host.coreUrl = config.coreUrl;
  window.__dshLive2dPetHost = host;

  // ------------------------------------------------------- __ModuleLoader__ 垫片

  // DSH 客户端的模块表在 Halo 里不存在，这里只种 client.js 唯一 require 的两个外部依赖。
  // 与桌面壳 `sidecar/page/index.html`、harness `tools/browser-test/index.html` 同一个契约。
  window.__ModuleLoader__ = {
    mode: "queue",
    pendingQueue: [],
    load(registration) {
      try {
        const req = (spec) => {
          if (spec === "react") return window.React;
          if (spec === "react-dom/client") return window.ReactDOM;
          if (spec === "react-dom") return window.ReactDOM;
          throw new Error("unseeded external: " + spec);
        };
        const mod = registration.factory(req);
        window.__pluginExports = window.__pluginExports || {};
        window.__pluginExports[registration.id] = mod;
      } catch (error) {
        boot.error = "client.js 工厂抛错：" + String((error && error.stack) || error);
        window.__bootError = String((error && error.stack) || error);
      }
    },
  };
  window.__errors = [];
  window.addEventListener("error", (event) => window.__errors.push("error: " + (event.message || event)));
  window.addEventListener("unhandledrejection", (event) => {
    window.__errors.push("rejection: " + ((event.reason && event.reason.message) || event.reason));
  });

  // ------------------------------------------------------------------ 加载

  /** 依次注入一个普通脚本；重复调用共享同一次结果。 */
  const scriptCache = new Map();
  function inject(src) {
    const cached = scriptCache.get(src);
    if (cached !== undefined) return cached;
    const pending = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      // async=false 让**动态插入的脚本**也按插入顺序执行（HTML 规范保证）；
      // 这是不引入内联脚本、又保住"React 先于 client.js"的办法。
      tag.async = false;
      tag.onload = () => resolve(src);
      tag.onerror = () => reject(new Error("script failed: " + src));
      document.head.appendChild(tag);
    });
    scriptCache.set(src, pending);
    return pending;
  }

  async function main() {
    const queued = ["react.js", "react-dom.js", "client.js", "pet-halo.js"];
    for (const file of queued) {
      boot.stage = "load:" + file;
      const url = here + file;
      await inject(url);
      boot.files.push(url);
    }
    boot.stage = "done";
  }

  main().then(
    () => { boot.ok = true; boot.ms = Date.now() - boot.startedAt; },
    (error) => {
      boot.error = boot.error !== null ? boot.error : String((error && error.message) || error);
      boot.ms = Date.now() - boot.startedAt;
    },
  );
})();
