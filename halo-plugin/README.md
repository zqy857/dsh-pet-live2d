# Halo 插件：鲸鱼娘桌宠（Live2D / 插件 id `whale-pet-live2d`）

> 本插件是 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d)（DSH 桌宠，
> MIT）的 **Halo 2.x 移植**，由 [zqy857](https://github.com/zqy857) 维护；
> 插件 id 从上游的 `dsh-pet-live2d` 改为 `whale-pet-live2d`（Halo 里没有 DeepSeek Harness），
> 资源 URL 相应变为 `/plugins/whale-pet-live2d/assets/...`。
> 版本历史见 [`CHANGELOG.md`](CHANGELOG.md)。

把上游 DSH 桌宠插件（`dsh-live2d-pet/`）的桌宠挂到 **Halo 2.x** 站点上：可拖动、跟随鼠标、
右键面板换装，评论 / 搜索等页面事件会让她换动作与表情。

- 要求 **Halo ≥ 2.21**（2.21 起 Halo 要求 Java 21）。
- 插件自带宠物（DS鲸鱼娘，4.3 MB）与渲染栈，装完即可用；**不包含** Live2D Cubism Core
  （专有运行时，默认从官方 CDN 取，站长可在设置里改成自建地址）。

> 许可：代码 MIT，模型与贴图 **CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享）**。
> 站点若有广告 / 付费内容 / 带货，属于商业用途，需要**分别**取得三位版权人的授权。
> 详见 [`src/main/resources/pet/LICENSES.md`](src/main/resources/pet/LICENSES.md)。

## 披露（审核与用户都该看到的）

**外部请求**：默认从 Live2D 官方 CDN 取一次专有运行时
`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`（约 200 KB）。
Live2D Cubism Core 是 Live2D Inc. 的专有软件，**本插件不打包、不转发**它；站长可以在
插件设置里把 `Cubism Core 地址` 换成自建地址（离线部署也走这一条）。除此之外，插件
**不向任何第三方发出请求**。

**数据**：不收集、不上传任何访客数据，也没有遥测。桌宠的位置、大小、装扮、台词覆盖只存在
**访客浏览器的 localStorage**（键名前缀 `dsh-pet-live2d`，沿用上游客户端的键名）。停用插件后前台不再注入任何
标签；访客浏览器里已存的那几个键会留着，需要的话让访客清一下站点数据即可。

**署名**（美术资源 CC BY-NC-SA 4.0）：

| 版权所有人 | 贡献 |
|---|---|
| [上善无形](https://www.pixiv.net/users/62155430) | 鲸鱼娘角色形象原作（原创 OC「溟月」） |
| [ZipZipPipe](https://www.pixiv.net/users/18604994) | 加入 DeepSeek 元素的女仆鲸鱼娘二次设计 |
| [氵六青](https://space.bilibili.com/11272072) | 本模型（DS鲸鱼娘）的 Live2D 绑定、动作、表情 |

**体积**：前端资源约 5.1 MB（模型 4.3 MB + 渲染引擎 0.8 MB + 客户端与 React 0.5 MB），
首次访问时加载。生产站点建议在反向代理/CDN 上给
`/plugins/whale-pet-live2d/assets/**` 配长缓存。

**来源与借鉴**：本插件是同一作者的
[DSH 桌宠插件](https://github.com/zqy857/whale-pet-live2d)（`dsh-live2d-pet/`）的移植 ——
渲染用 pixi.js + untitled-pixi-live2d-engine，交互与「槽位 / 池子」领域模型都是本项目自己的代码。
其中**一个技术点**借鉴了社区插件 [LIlGG/plugin-live2d](https://github.com/LIlGG/plugin-live2d)：
把配置放进 `<script type="application/json">` 的标签体而不是 HTML 属性（我们在此基础上保留了
"外部加载脚本、无内联可执行脚本"的做法，见 `SKILL.md`）。
两者的定位不同：那个插件是"看板娘 + AI 聊天/Agent + TIPS 小游戏"；本插件是"可拖动、跟随鼠标、
有 44 个表情与 20 个装扮槽的桌宠"，并且**不打包 Cubism Core**、**资源路径带版本号**（升级即时生效）、
**软导航后能自愈**。

**已验证的 Halo 版本**：2.21.0 与 2.26.0（当前最新）上，安装 / 启用 / 前台渲染 / 配置 /
软导航自愈 / 禁用，均通过 `tools/halo-smoke.mjs` 的 23 项检查。

## 安装

1. 从 Release / 应用市场拿到 `whale-pet-live2d-<版本>.jar`；
2. Halo 控制台 → **插件** → 右上角「安装」→ 上传这个 jar；
3. 装好后启用插件；
4. 打开站点前台，右下角就会出现她。

## 设置（控制台 → 插件 → DSH 桌宠 Live2D → 设置）

| 设置项 | 默认 | 作用 |
|---|---|---|
| 启用桌宠 | 开 | 关掉后前台**一个标签都不注入** |
| Cubism Core 地址 | 空 | 留空 = 用 Live2D 官方 CDN；有自建镜像 / 离线部署时填自己的地址 |
| 启用「博客事件 → 相位」 | 开 | 聚焦评论框 = `asking`、提交评论 = `done`、站内搜索 = `thinking` |
| 评论 / 搜索区域选择器 | 空 | 留空用内置的一组常见选择器；主题不一样时可以自己写（英文逗号分隔） |
| 默认覆盖表（JSON） | 空 | 给相位池子 / 摸鱼池 / 关系 / 互动 / 台词灌**默认值**（访客自己改过的优先）。顶层键：`phases`、`fidget`、`relations`、`interactions`、`lines`。例：`{"lines": {"phase": {"asking": "等你说点什么～"}}}` |

主题或别的脚本也可以直接驱动她：

```js
window.__haloPetPhase("done");          // 演一次庆祝
window.__haloPetPhase("asking", 5000);  // 进 asking，5 秒后回 idle
```

可用的相位：`idle` / `thinking` / `tool` / `waiting` / `asking` / `helper` / `queued` /
`done` / `failed`（具体演什么由宠物自己的 `pet.json` 与相位池子决定）。

## 它是怎么接上去的（排障用）

```
TemplateHeadProcessor  →  <head> 里一个 <script defer src="…/pet-shim.js" data-config='{…}'>
ReverseProxy           →  /plugins/whale-pet-live2d/assets/pet/**   （catalog、React、client.js、模型）
```

- Halo 侧**没有** `/api/live2d-pet/*` 路由：catalog 与资产都是静态文件，相位来自页面事件。
- 页面里没有内联脚本（配置挂在 `data-config` 属性上），避免撞 Halo 的 CSP。
- 排障读口：

```js
window.__dshLive2dPetBoot   // { ok, stage, error, config, files, ms }
window.__dshLive2dPetHalo   // { ready, applied, phase, phaseEvents, lastEvent, errors }
```

### 排障：顶部 banner 坏掉 / 主题样式失效（0.1.2 修）

**症状**：首页顶部的 banner 加载不出来、主题的 body 类名/自定义属性像是没生效，
而桌宠本身正常。

**根因**：插件注入的 `<script>` 曾经被序列化成**自闭合**的 `<script … />`。HTML 里 script
不是自闭合元素 —— 解析器把它当开标签，然后把**后面的一切**当成脚本文本吞掉，直到下一个
`</script>`。被吞掉的往往是 `</head>`、`<body class="… enable-banner …">`、主题自己的配置
元素（例如 Ethereal 的 `#config-carrier`）。服务端返回 200、日志里一句错都没有。

**自检**（任意页面控制台）：

```js
// 源 HTML 里 <body> 上的属性，必须都还在 DOM 上
[...document.body.attributes].map(a => a.name)
// 主题自己的配置元素在不在（按主题换选择器）
document.getElementById('config-carrier')
```

如果 body 上的 `class` / `style` / `data-*` 比源 HTML 少，就是这个问题 —— 升级到 0.1.2 即可。

### 排障：切页面后她不见了 / 失效（0.1.3 修）

主题的软导航（Ethereal 用的是 **Swup**）会重写 `<head>`：注入的 `<style>` 与动态加载的
脚本标签会被删掉。规则：**脚本代码不会卸载**（已经在跑的自愈循环照跑），但**样式会没**，
而 `canvas` 也可能被局部重建。

现在的兜底（0.1.3）：

- 位置 / 层级 / 交互的底线写在**行内**，样式表丢了也不会变成普通块级元素；
- 样式表不见了，`pet-halo.js` 用一份内容副本**原样补回**（不另写一套，不会漂移）；
- 根还在、但 `canvas` 连续 ~6 秒没有 ⇒ 重建；
- 挂载点整个被换掉 ⇒ 重新挂载（软导航事件 + 2 秒轮询兜底）。

排障读口（站点页面控制台）：

```js
window.__dshLive2dPetHalo.diag()
// { styleTag, styleRescues, petPosition, petInlinePosition, petZIndex,
//   containerPosition, containerSize, appliedCount, lastEvent, errors }
```

`lastEvent` 会写 `soft-nav` / `watchdog` / `canvas-watchdog` 之类，一眼看出是谁救的场。

### 升级后一定要看到新版本？看 URL 里的版本号

Halo 的插件静态资源响应头是 `cache-control: max-age=31536000`（一年）。所以**公开路径里带
版本号**：

```
/plugins/whale-pet-live2d/assets/v0.1.3/pet-shim.js
```

升级插件即换前缀 ⇒ catalog、client.js、vendor、贴图、动作全部重新取，访客不需要手动清缓存。

### 换了主题之后想自检一遍

插件与主题是解耦的（我们只往 `<head>` 注入一个完整闭合的 `<script>`，并在 `body` 末尾挂一个
零尺寸、固定定位的挂载点），但主题的 CSS/软导航千差万别。想在本地核一遍：

```bash
# 1) 本机起一个 Halo（H2 默认配置）+ 初始化
java -jar halo.jar --halo.work-dir=/tmp/halo --server.port=8099 \
     --halo.external-url=http://127.0.0.1:8099 --halo.security.basic-auth.disabled=false
curl -X POST http://127.0.0.1:8099/system/setup \
     -d 'username=admin&password=admin12345&email=a@b.c&siteTitle=t&language=zh-CN&externalUrl=http://127.0.0.1:8099'

# 2) 装主题并激活（zip 里 theme.yaml 必须在根目录；源码 zip 不行）
curl -u admin:admin12345 -X POST \
     http://127.0.0.1:8099/apis/api.console.halo.run/v1alpha1/themes/install -F "file=@主题.zip"
curl -u admin:admin12345 -X PUT \
     http://127.0.0.1:8099/apis/api.console.halo.run/v1alpha1/themes/<主题名>/activation

# 3) 跑同一套 22 项检查（换主题后重跑这一条即可）
node tools/halo-smoke.mjs --base http://127.0.0.1:8099 \
     --jar halo-plugin/build/libs/whale-pet-live2d-<版本>.jar --user admin --pass admin12345
```

已在这些主题上跑过：**theme-earth**（Halo 官方默认）22/22、**theme-hao** 22/22
（它自身有一个 `/null` 404，属于主题问题，检查里会单独标注"与插件无关"）、
**Ethereal**（Swup 软导航，就是前面 banner/切页那两条报障的现场）。

### 建议：给静态资源加长缓存

模型约 4.3 MB。插件的静态资源由 Halo 发出（带 `Last-Modified` 验证），生产站点建议在
反向代理 / CDN 上给 `/plugins/whale-pet-live2d/assets/pet/**` 配长缓存，否则每次冷加载都要重下。

## 开发与验证

静态资源是**生成**的（`src/main/resources/pet/` 里除 `pet-shim.js`、`pet-halo.js`、
`README.md`、`LICENSES.md` 四个手写文件外，都由脚本产出）：

```bash
node tools/build-halo-plugin.mjs            # 生成（改过 lib/ 或宠物之后必须重跑）
node tools/build-halo-plugin.mjs --check    # 只校验产物与源同步

cd halo-plugin && ./gradlew build           # 需要 JDK 21；产物 build/libs/*.jar

cd tools/browser-test
node run-suite.mjs halo halo-tree --jobs 1  # 静态托管契约 + 产物自洽（无需 Halo）
```

**真 Halo 的冒烟测试**（验注入、设置读取、ReverseProxy 与真浏览器里的启动）：

```bash
# 起一个本地 Halo（H2 默认配置，仅本地验证用）
java -jar halo.jar --halo.work-dir=/tmp/halo --server.port=8099 \
     --halo.external-url=http://127.0.0.1:8099 --halo.security.basic-auth.disabled=false
curl -X POST http://127.0.0.1:8099/system/setup \
     -d 'username=admin&password=admin12345&email=a@b.c&siteTitle=t&language=zh-CN&externalUrl=http://127.0.0.1:8099'

node tools/halo-smoke.mjs --base http://127.0.0.1:8099 \
     --jar halo-plugin/build/libs/whale-pet-live2d-0.2.0.jar --user admin --pass admin12345
```

工程记录（Halo 扩展点的硬事实、踩过的坑）在
[`.dsh/skills/halo-plugin/SKILL.md`](../.dsh/skills/halo-plugin/SKILL.md)。
