# 这个目录是什么

`halo-plugin/src/main/resources/pet/` —— 插件里那棵**静态资源树**。它由 `ReverseProxy`
挂在下面这个前缀下（规则见 `../extensions/reverse-proxy.yaml`）：

```
/plugins/whale-pet-live2d/assets/v<版本>/**
```

前缀里带**版本号**：Halo 给插件静态资源发 `cache-control: max-age=31536000`，固定路径会让
升级后的新文件最长一年到不了访客浏览器。

**树背后没有进程**：没有 `/api/live2d-pet/*` 路由，也没有宿主半区。浏览器半区
（`client.js`）靠 `window.__dshLive2dPetHost = { base, static: true }` 知道这一点，于是不去问
`/layer`、`/settings`、`/events`；相位改由页面事件驱动（`pet-halo.js`）。

## 哪些是生成的、哪些是手写的

| 文件 | 来源 |
|---|---|
| `catalog` | **生成**：`buildCatalog()`（`dsh-live2d-pet/lib/index.js`）算出的清单，URL 重写到静态目录。没有扩展名是故意的 —— client.js 取的是 `<base>/catalog` |
| `client.js`、`live2d-vendor.js` | **生成**：`dsh-live2d-pet/lib/` 的逐字节副本（生成器会断言相等） |
| `react.js`、`react-dom.js` | **生成**：`vendor/react/18.3.1/` 的生产构建（MIT） |
| `pets/<id>/**` | **生成**：宠物包整目录复制（`pet.json`、`LICENSE`、贴图与动作） |
| `pet-shim.js` | **手写**：唯一被注入页面的脚本，按顺序加载其余文件并设好宿主配置 |
| `pet-halo.js` | **手写**：`apply()` 启动 + 软导航重挂 + 博客相位驱动 |
| `README.md`、`LICENSES.md` | **手写**：本文件与许可/署名 |

刷新产物（`--check` 只比对、不写盘）：

```bash
node tools/build-halo-plugin.mjs
node tools/build-halo-plugin.mjs --check
```

## 配置块的字段

插件注入的配置块长这样（完整注入规格见 [`../../../../README.md`](../../../../README.md)）：

```html
<script type="application/json" id="whale-pet-live2d-config">{"base":"…","coreUrl":"","phases":true}</script>
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `base` | 必填 | 静态资源根，即 `/plugins/whale-pet-live2d/assets/v<版本>` |
| `coreUrl` | `""` | Cubism Core 的地址。留空时用 catalog 里写的 Live2D 官方 CDN；站长可指向自建副本 |
| `phases` | `true` | 是否启用「博客事件 → 相位」（评论框聚焦 = `asking`、提交评论 = `done`、站内搜索 = `thinking`） |
| `commentSelectors` | 一组常见选择器 | 评论输入框选择器，命中即 `asking` |
| `searchSelectors` | 一组常见选择器 | 站内搜索框选择器，命中即 `thinking` |
| `doneHoldMs` | `2600` | `done` 演多久后回 `idle` |
| `overrides` | 空 | 相位池子 / 摸鱼池 / 关系 / 互动 / 台词的默认覆盖。**用户自己改过的优先**（客户端沿用上游的存档键 `dsh-pet-live2d.settings.v2`） |

主题或别的脚本也可以直接驱动相位：

```js
window.__haloPetPhase("done");          // 演一次庆祝
window.__haloPetPhase("asking", 5000);  // 进 asking，5 秒后回 idle
```

读口（验证脚本与排障用）：

```js
window.__dshLive2dPetBoot   // { ok, stage, error, config, configSource, configRecovered, files, ms }
window.__dshLive2dPetHalo   // { ready, applied, appliedCount, phase, phaseEvents, lastEvent, errors }
```

## 许可与体积

- 代码 MIT（上游部分 © A8Chann，Halo 插件部分 © zqy857）；美术素材 CC BY-NC-SA 4.0（**非商业**），
  逐字见 `LICENSES.md`；
- 模型约 4.3 MB（贴图 1.8 MB + `moc3` 2.1 MB）。生产站点建议在反向代理 / CDN 上给
  `/plugins/whale-pet-live2d/assets/**` 加长缓存，否则每个访客、每次冷加载都要重下这几 MB。
