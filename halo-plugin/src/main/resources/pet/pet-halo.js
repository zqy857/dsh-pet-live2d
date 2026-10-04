// whale-pet-live2d — Halo 侧的启动与"博客相位"驱动。
//
// 由 `pet-shim.js` 在 client.js 之后按顺序加载。它做三件事：
//
//   1. 用最小 ctx 调插件的 `apply()`（浏览器半区从桌面壳那边就是被这么驱动的：
//      `slots` 给 undefined，那一节自己会跳过，右键面板不受影响）。
//   2. **主题软导航（PJAX/Swup）后重新挂载**：切页不会重新执行 head 里的脚本，
//      所以换页后她可能被主题的整块替换带走；这里看着 DOM，掉了就重新 apply
//      （`apply()` 本来就幂等：先 teardown，再扫掉遗留节点）。
//   3. **相位驱动**：DSH 里相位是宿主半区订阅 agent 事件推过来的（thinking/tool/
//      asking/…）；博客上没有 agent，于是换成"访客在做的事" —— 聚焦评论框、提交评论、
//      站内搜索。相位走的是 client.js 自己的公开读口 `window.__dshLive2dPet.phaseNow()`
//      （那条路径与 SSE 完全一致：既换动作/表情，也让槽位让位）。
//
//   这也解释了为什么不需要给 Halo 写任何 HTTP 路由：**能静态的就静态**，
//   要"活着"的那部分（相位）由页面事件驱动。
(function () {
  "use strict";

  const config = window.__dshLive2dPetConfig ?? {};
  const boot = window.__dshLive2dPetBoot ?? (window.__dshLive2dPetBoot = { ok: false, error: null, stage: "pet-halo" });

  /** driver / 主题的公共读口。 */
  const halo = {
    ready: false,
    applied: false,
    appliedCount: 0,
    phase: "idle",
    phaseEvents: false,
    lastEvent: null,
    styleRescues: 0,
    errors: [],
  };
  window.__dshLive2dPetHalo = halo;

  /**
   * 排障读口：主题把 DOM 换了之后到底缺了什么。
   *
   * "切页面后她跑到左上角/躲到后面"这类问题，先看这里：`styleTag` 是不是 false、
   * `petPosition` 是不是退成了 `static`、`containerPosition`/`containerSize` 说明挂载点
   * 有没有变回正常流。比截图猜快得多。
   */
  halo.diag = () => {
    const root = document.querySelector("[data-dsh-live2d-pet]");
    const container = document.querySelector("[data-dsh-live2d-pet-root]");
    const computed = (el) => (el === null ? null : window.getComputedStyle(el));
    return {
      styleTag: document.getElementById(STYLE_ID) !== null,
      styleRescues: halo.styleRescues,
      pet: root !== null,
      petPosition: computed(root)?.position ?? null,
      petInlinePosition: root === null ? null : root.style.position,
      petZIndex: computed(root)?.zIndex ?? null,
      containerPosition: computed(container)?.position ?? null,
      containerSize: container === null ? null : [container.offsetWidth, container.offsetHeight],
      appliedCount: halo.appliedCount,
      lastEvent: halo.lastEvent,
      errors: halo.errors.slice(0, 5),
    };
  };

  const warn = (message) => {
    halo.errors.push(String(message));
    try { console.warn("[whale-pet-live2d] " + message); } catch { /* 有些壳没有 console */ }
  };

  // ------------------------------------------------------------- 1. apply

  /** 最小 ctx：与 DSH 客户端的 apply 契约一致，只实现这边有的那部分。 */
  function makeCtx() {
    return {
      effect(fn) { try { return fn(); } catch (error) { warn("effect 抛错：" + error); return () => {}; } },
      // Halo 里没有 DSH 的设置页宿主：故意不给 slots（client.js 会跳过那一节）。
      slots: undefined,
      logger: { info() {}, warn, error: warn },
    };
  }

  /**
   * 把"插件设置给的默认值"灌进 client.js 的本地存档。
   *
   * 为什么走 localStorage 而不是接口：静态托管没有宿主可以写设置，而 client.js 的
   * 覆盖项（相位池子 / 摸鱼池 / 关系 / 互动 / 台词）本来就是从 localStorage 读的
   * （`dsh-pet-live2d.settings.v2`）。**用户自己的选择优先**：这里只补空位。
   */
  function seedOverrides() {
    const seed = config.overrides;
    if (seed === null || seed === undefined) return;
    let parsed = seed;
    if (typeof seed === "string") {
      try { parsed = JSON.parse(seed); } catch (error) { warn("overrides 不是合法 JSON：" + error); return; }
    }
    if (parsed === null || typeof parsed !== "object") return;
    const KEY = "dsh-pet-live2d.settings.v2";
    let current = {};
    try {
      const raw = window.localStorage.getItem(KEY);
      const held = raw === null ? null : JSON.parse(raw);
      if (held !== null && typeof held === "object") current = held;
    } catch { /* 拿不到就当空着 */ }
    // 深一层合并：{ phases: {...}, lines: { phase: {...} } } —— 用户的键赢。
    const merged = Object.assign({}, parsed, current);
    for (const key of Object.keys(parsed)) {
      const mine = parsed[key];
      const theirs = current[key];
      if (mine !== null && theirs !== null && typeof mine === "object" && typeof theirs === "object"
        && !Array.isArray(mine) && !Array.isArray(theirs)) {
        merged[key] = Object.assign({}, mine, theirs);
        if (mine.phase !== null && theirs.phase !== null
          && typeof mine.phase === "object" && typeof theirs.phase === "object") {
          merged[key].phase = Object.assign({}, mine.phase, theirs.phase);
        }
      }
    }
    try { window.localStorage.setItem(KEY, JSON.stringify(merged)); } catch (error) { warn("写存档失败：" + error); }
  }

  function apply() {
    const exports = window.__pluginExports?.["dsh-pet-live2d"];
    if (exports === undefined || exports === null || typeof exports.apply !== "function") return false;
    seedOverrides();
    exports.apply(makeCtx());
    halo.applied = true;
    halo.appliedCount += 1;
    return true;
  }

  // ------------------------------------------------- 2. 软导航后的重新挂载与样式自愈

  /** 页面里现在有没有她（`apply()` 挂的那个根节点）。 */
  const mounted = () => document.querySelector("[data-dsh-live2d-pet]") !== null;

  /**
   * client.js 注入的那张样式表。
   *
   * 主题的软导航可能整段重写 `<head>`（或删掉它不认识的节点），把这张 `<style>` 一起
   * 带走 —— 表现是"切个页面她就跑到左上角、躲在所有元素后面"。位置的底线现在写在行内
   * （见 client.js 的 `rootStyle`），但面板/气泡/滑杆的样子还在样式表里，所以这里
   * **留一份内容副本，丢了原样补回去**：补的是同一份文本，不是另写一套样式，两边不会漂移。
   */
  const STYLE_ID = "dsh-live2d-pet-style";
  let styleCopy = null;
  function rememberStyle() {
    if (styleCopy !== null) return;
    const tag = document.getElementById(STYLE_ID);
    if (tag !== null && tag.textContent !== null && tag.textContent !== "") styleCopy = tag.textContent;
  }
  /** 样式表不见了就用副本补一份；补不了（还没见过它）返回 false，由调用方走整段重建。 */
  function rescueStyle() {
    rememberStyle();
    if (document.getElementById(STYLE_ID) !== null) return true;
    if (styleCopy === null) return false;
    const tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = styleCopy;
    document.head.appendChild(tag);
    halo.styleRescues += 1;
    return true;
  }

  let remountTimer = 0;
  /** 连续多少次 watchdog 看到"根在、canvas 不在"。用来区分"正在加载"与"真没了"。 */
  let canvasMissingTicks = 0;
  function scheduleRemount(reason) {
    if (remountTimer !== 0) return;
    remountTimer = window.setTimeout(() => {
      remountTimer = 0;
      const petMissing = !mounted();
      const styleMissing = document.getElementById(STYLE_ID) === null;
      if (!petMissing && !styleMissing) return;
      halo.lastEvent = reason;
      // 样式丢了但宠物还在：先把样式补回去（便宜，不重建 WebGL）；补不了才整段重建。
      if (styleMissing && rescueStyle() && !petMissing) {
        try { console.info("[whale-pet-live2d] 重新注入样式表（" + reason + "）"); } catch { /* 无 console */ }
        return;
      }
      try {
        if (apply()) { try { console.info("[whale-pet-live2d] 重新挂载（" + reason + "）"); } catch { /* 无 console */ } }
      } catch (error) { warn("重新挂载失败：" + error); }
    }, 120);
  }

  /**
   * 根还在、但**画布没了**（Swup 之类的软导航会局部重建 DOM）。
   *
   * 与"整只不见了"不同：`mounted()` 为真，所以上面的自愈不会动它。放宽到"连续 3 次
   * （≈6 秒）都没画布"才重建 —— 模型首次加载要一两秒，等太短会把正常启动砸掉。
   */
  function canvasWatchdog() {
    const hasRoot = mounted();
    const hasCanvas = document.querySelector("[data-dsh-live2d-pet] canvas") !== null;
    if (!hasRoot || hasCanvas || halo.applied !== true) { canvasMissingTicks = 0; return; }
    canvasMissingTicks += 1;
    if (canvasMissingTicks >= 3) {
      canvasMissingTicks = 0;
      halo.lastEvent = "canvas-watchdog";
      try {
        if (apply()) { try { console.info("[whale-pet-live2d] 画布不见了，重建（canvas-watchdog）"); } catch { /* 无 console */ } }
      } catch (error) { warn("画布重建失败：" + error); }
    }
  }

  // 主题的软导航五花八门，所以两条腿走路：常见事件立刻反应 + 轮询兜底。
  // 软导航刚结束时 DOM 可能还在变，所以事件之后再补看两次（300ms / 1.2s）。
  function watchAfterNavigation() {
    scheduleRemount("soft-nav");
    window.setTimeout(() => scheduleRemount("soft-nav+300ms"), 300);
    window.setTimeout(() => scheduleRemount("soft-nav+1200ms"), 1200);
  }
  for (const name of ["pjax:complete", "pjax:end", "pjax:success", "swup:page:view",
    "turbo:load", "astro:page-load"]) {
    window.addEventListener(name, watchAfterNavigation);
  }
  for (const name of ["popstate", "hashchange"]) {
    window.addEventListener(name, () => scheduleRemount(name));
  }
  window.setInterval(() => {
    rememberStyle();
    if (!mounted() || document.getElementById(STYLE_ID) === null) scheduleRemount("watchdog");
    else canvasWatchdog();
  }, 2000);

  // ------------------------------------------------------- 3. 博客相位驱动

  const DEFAULT_COMMENT_SELECTORS = [
    "#comment-form textarea",
    ".comment-form textarea",
    "form[data-comment] textarea",
    "textarea[name='content']",
    ".halo-comment textarea",
    "[data-comment-input]",
  ];
  const DEFAULT_SEARCH_SELECTORS = [
    "input[type='search']",
    ".search-input",
    "#search input",
    "form[role='search'] input",
    "[data-search-input]",
  ];

  const asSelector = (value, fallback) => {
    if (Array.isArray(value)) {
      const list = value.filter((item) => typeof item === "string" && item.trim() !== "");
      return list.length > 0 ? list.join(",") : fallback.join(",");
    }
    if (typeof value === "string" && value.trim() !== "") return value;
    return fallback.join(",");
  };

  const COMMENT_SELECTOR = asSelector(config.commentSelectors, DEFAULT_COMMENT_SELECTORS);
  const SEARCH_SELECTOR = asSelector(config.searchSelectors, DEFAULT_SEARCH_SELECTORS);
  /** 提交评论是"一次庆祝"：演 `done` 这么久，然后回 idle。 */
  const DONE_HOLD_MS = typeof config.doneHoldMs === "number" ? config.doneHoldMs : 2600;

  /** 相位驱动开关：默认开；`phases: false` 关掉（设置里那个开关）。 */
  const PHASES_ON = config.phases !== false;

  let holdTimer = 0;
  /**
   * 进一个相位，`holdMs` 之后自动回 `idle`。
   *
   * `phaseNow` 是个**读口**（client.js 里给 driver 用的那条），但它走的是真实路径：
   * 设状态 + 重抽槽位 + 换动作/表情。所以用它与用 SSE 收到的相位，画面上的结果一致。
   */
  function phase(name, holdMs) {
    if (typeof name !== "string" || name === "") return;
    const api = window.__dshLive2dPet;
    if (api === undefined || typeof api.phaseNow !== "function") return;
    if (holdTimer !== 0) { window.clearTimeout(holdTimer); holdTimer = 0; }
    halo.phase = name;
    api.phaseNow(name);
    const hold = typeof holdMs === "number" && holdMs > 0 ? holdMs : 0;
    if (hold > 0) {
      holdTimer = window.setTimeout(() => {
        holdTimer = 0;
        halo.phase = "idle";
        api.phaseNow("idle");
      }, hold);
    }
  }
  /** 选择器由站长配置，写错了不能把整个监听器炸掉 —— 一律裹起来。 */
  function hits(element, selector) {
    if (!(element instanceof Element)) return false;
    try { return element.matches(selector) || element.closest(selector) !== null; } catch { return false; }
  }

  /** 给主题/其他脚本用的入口：`window.__haloPetPhase('done')`。 */
  window.__haloPetPhase = phase;

  /** 等 client.js 把读口挂上（它是 React 挂载后的 effect 里挂的）。 */
  let phaseReady = false;
  function waitPhaseApi() {
    if (phaseReady) return;
    const api = window.__dshLive2dPet;
    if (api === undefined || typeof api.phaseNow !== "function") return;
    phaseReady = true;
    halo.phaseEvents = PHASES_ON;
    if (!PHASES_ON) return;

    // 聚焦评论框 = "她在等你说点什么"（asking）；离开就回 idle。
    // 用 focusin/focusout 委托：评论框可能是异步渲染出来的，绑定具体节点会漏。
    let commentFocused = false;
    document.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (hits(target, SEARCH_SELECTOR)) {
        halo.lastEvent = "search-focus";
        phase("thinking");
        return;
      }
      if (hits(target, COMMENT_SELECTOR)) {
        commentFocused = true;
        halo.lastEvent = "comment-focus";
        phase("asking");
      }
    }, true);
    document.addEventListener("focusout", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (commentFocused && hits(target, COMMENT_SELECTOR)) {
        commentFocused = false;
        halo.lastEvent = "comment-blur";
        phase("idle");
      } else if (hits(target, SEARCH_SELECTOR)) {
        halo.lastEvent = "search-blur";
        phase("idle");
      }
    }, true);

    // 提交评论：Halo 主题的提交按钮形态各异，所以看**表单内的 submit 按钮点击**与
    // 表单的 submit 事件，命中就庆祝一下（`done` 在这个宠物上映射到吹泡泡糖）。
    const isSubmitish = (element) => {
      if (!(element instanceof Element)) return false;
      const button = element.closest("button, input[type='submit'], a[data-comment-submit]");
      if (button === null) return false;
      const form = button.closest("form");
      if (form === null) return false;
      // **只认评论表单**：搜索框、登录框也有 submit 按钮，不能都当成"评论提交成功"。
      if (form.querySelector(COMMENT_SELECTOR) === null) return false;
      const text = (button.textContent ?? button.getAttribute("value") ?? "").trim();
      return /评论|提交|发布|发送|回复|submit|comment|post/i.test(text) || button.getAttribute("type") === "submit";
    };
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!isSubmitish(target)) return;
      halo.lastEvent = "comment-submit";
      phase("done", DONE_HOLD_MS);
    }, true);
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof Element) || form.querySelector(COMMENT_SELECTOR) === null) return;
      halo.lastEvent = "comment-submit";
      phase("done", DONE_HOLD_MS);
    }, true);
  }

  // --------------------------------------------------------------- 启动

  const started = Date.now();
  const waitTimer = window.setInterval(() => {
    if (window.__pluginExports?.["dsh-pet-live2d"] !== undefined) {
      if (!halo.applied) {
        try { apply(); } catch (error) { warn("apply 失败：" + error); }
      }
      halo.ready = true;
      waitPhaseApi();
      if (phaseReady || Date.now() - started > 30000) window.clearInterval(waitTimer);
    } else if (Date.now() - started > 30000) {
      window.clearInterval(waitTimer);
      boot.error = boot.error ?? "30s 内没等到 __pluginExports['dsh-pet-live2d']";
      warn(boot.error);
    }
  }, 100);
})();
