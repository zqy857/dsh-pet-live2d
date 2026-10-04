# 这个目录是什么

`halo-plugin/src/main/resources/pet/` —— Halo 插件里那份**静态资源树**。Halo 通过
`ReverseProxy`（见 `../extensions/reverse-proxy.yaml`，规则 `path: /pet/**` + `file.directory: pet`）
把它挂在：

```
/plugins/whale-pet-live2d/assets/pet/**
```

**它没有对应的 HTTP 路由**：没有 `/api/live2d-pet/*`，没有进程在背后。浏览器半区
（`client.js`）通过 `window.__dshLive2dPetHost = { base, static: true }` 知道这一点，
于是不去问 `/layer`、`/settings`、`/events`（见 `dsh-live2d-pet/lib/client.js` 顶部那段注释）。
相位改由页面事件驱动（`pet-halo.js`）。

## 哪些是生成的、哪些是手写的

| 文件 | 来源 |
|---|---|
| `catalog` | **生成**：`buildCatalog()`（`dsh-live2d-pet/lib/index.js`）算出来的清单，URL 重写到静态目录。**故意没有扩展名** —— client.js 取的是 `<base>/catalog` |
| `client.js`、`live2d-vendor.js` | **生成**：`dsh-live2d-pet/lib/` 的逐字节副本（生成脚本会断言相等） |
| `react.js`、`react-dom.js` | **生成**：`vendor/react/18.3.1/` 的生产构建（MIT） |
| `pets/<id>/**` | **生成**：宠物包整目录复制（含 `pet.json`、`LICENSE`、`README`、贴图与动作） |
| `pet-shim.js` | **手写**：唯一被注入页面的脚本；按顺序加载其余文件并设好宿主配置 |
| `pet-halo.js` | **手写**：`apply()` 启动 + 软导航重挂 + 博客相位驱动 |
| `README.md`、`LICENSES.md` | **手写**：本文件与许可/署名 |

刷新产物（`--check` 只比对不写盘，CI 用）：

```bash
node tools/build-halo-plugin.mjs
node tools/build-halo-plugin.mjs --check
```

## 插件往页面里注入什么

`TemplateHeadProcessor` 往 head 里写**两段**东西：一个**配置块**（`<script type="application/json">`，
配置在标签体里）和一个**外部加载脚本**。页面里没有可执行的内联脚本 —— 所以站点即使配了
CSP（`script-src` 不含 `'unsafe-inline'`）也照常工作。

```html
<script type="application/json" id="whale-pet-live2d-config">{"base":"/plugins/whale-pet-live2d/assets/v0.1.4","coreUrl":"","phases":true}</script>
<script defer src="/plugins/whale-pet-live2d/assets/v0.1.4/pet-shim.js"></script>
```

两个都是**手写的完整闭合标签**，而且配置在**标签体**里 —— 这两点分别对应两次真站事故：

- **自闭合的 `<script … />`**：HTML 里 script 不是自闭合元素，解析器会把后面的一切
  （`</head>`、`<body class="…">`、主题自己的配置 div 与内联脚本）当成脚本文本吞到下一个
  `</script>` —— 主题 banner 就是这么坏掉的。
- **配置塞在 HTML 属性里**：Thymeleaf **不替属性值转义**，`"` 必须自己换 `&quot;`，
  少一个属性就在第一个内层引号处断掉（服务端 200、日志无声，桌宠永不启动）。
  放进标签体后，只剩"把 JSON 里的 `<` 换成 `\u003c`"一条规则。

`pet-shim.js` 随后按序插入 `react.js` → `react-dom.js` → `client.js` → `pet-halo.js`
（顺序是硬约束：React 先于 client.js，client.js 先于 pet-halo.js）。

## `data-config` 的字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `base` | 必填 | 静态资源根，即 `/plugins/<插件名>/assets/pet` |
| `coreUrl` | `""` | **Cubism Core 的地址**。留空时用 catalog 里写的官方 CDN。专有运行时，插件不内置，站长可指向自建副本 |
| `phases` | `true` | 是否启用"博客事件 → 相位"（评论框聚焦 = `asking`、提交评论 = `done`、站内搜索 = `thinking`） |
| `commentSelectors` | 一组常见选择器 | 评论输入框的选择器（字符串或数组），命中即 `asking` |
| `searchSelectors` | 一组常见选择器 | 站内搜索框的选择器，命中即 `thinking` |
| `doneHoldMs` | `2600` | `done` 演多久后回 `idle` |
| `overrides` | 空 | 相位池子 / 摸鱼池 / 关系 / 互动 / 台词的默认覆盖（对象或 JSON 字符串）。**写进 `localStorage` 的 `whale-pet-live2d.settings.v2`，用户自己的选择优先** |

主题或别的脚本也可以直接驱动相位：

```js
window.__haloPetPhase("done");          // 演一次庆祝
window.__haloPetPhase("asking", 5000);  // 进 asking 并在 5s 后回 idle
```

读口（验证脚本与排障用）：

```js
window.__dshLive2dPetBoot    // { ok, stage, error, config, configRecovered, files, ms }
window.__dshLive2dPetHalo    // { ready, applied, appliedCount, phase, phaseEvents, lastEvent, errors }
```

## 许可与体积

- 代码 MIT，美术素材 CC BY-NC-SA 4.0（**非商业**），逐字见 `LICENSES.md`。
- 模型约 4.3 MB（贴图 1.8 MB + `moc3` 2.1 MB）。插件靠 Halo 的静态资源路由发出，
  带 `Last-Modified` 验证；生产站点建议在反向代理/CDN 上给
  `/plugins/whale-pet-live2d/assets/pet/**` 加长缓存 —— 否则每个访客、每次冷加载都要重下这 4 MB。
