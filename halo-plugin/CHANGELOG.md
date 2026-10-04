# 更新日志（Halo 插件 whale-pet-live2d）

给 Halo 2.x 用的 Live2D 桌宠插件。上游代码来自
[A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d)（MIT），
Halo 插件部分由 zqy857 维护；美术资源是 CC BY-NC-SA 4.0。

## 0.2.0（首次公开发布）

### 新：Halo 2.x 站点上也能挂她

Halo ≥ 2.21 装一个 Java 插件即可：桌宠、渲染栈与宠物随插件分发，评论框聚焦 / 提交评论 /
站内搜索这些**页面事件**会驱动她换动作与表情（主题也可以自己调 `window.__haloPetPhase("done")`）。
Live2D Cubism Core **不随包分发**（默认走 Live2D 官方 CDN，可在插件设置里改成自建）；
模型是 CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享）。

### 改：插件 id 用 `whale-pet-live2d`

Halo 里没有 DeepSeek Harness，"dsh" 对 Halo 用户是噪声。插件 id 决定资源 URL
（`/plugins/whale-pet-live2d/assets/...`），发布后再改等于换一个插件，所以趁首次发布改掉。

下面几条是 0.1.x 时的修复记录（当时插件 id 还是 `dsh-pet-live2d`），都已包含在 0.2.0 里。

### 改：配置放在 `application/json` 标签体里

配置从"挂在 `data-config` 属性上"改成
`<script type="application/json" id="whale-pet-live2d-config">` 的**标签体**
（借鉴社区插件 [plugin-live2d](https://github.com/LIlGG/plugin-live2d) 的做法）。
属性里塞 JSON 需要手工转义双引号，漏一个属性就断、桌宠不启动；标签体只剩"把 `<` 换成
`\u003c`"一条规则，这类错误从结构上没有了。加载脚本仍然是**外部**脚本（不是内联可执行 JS），
所以配了 CSP 的站点照样能用。

### 修：主题的 banner 加载不出来、主题 body 类名/配置像是没生效

插件往 `<head>` 注入的 `<script>` 曾经是**自闭合**的 `<script … />`。HTML 里 script 不是
自闭合元素 —— 解析器把它当开标签，把后面的一切当脚本文本吞到下一个 `</script>`：
`</head>`、`<body class="… enable-banner …">`、主题自己的配置元素（如 Ethereal 的
`#config-carrier`）全被吞掉，所以主题的 banner 配置从未生效。现在按"开标签 + 闭标签"
输出，并在 `tools/halo-smoke.mjs` 里加了通用探针（源 HTML 里 `<body>` 的属性必须一个不少地
出现在 DOM 上）。

### 修：切页面后桌宠不见了 / 位置失效

主题的软导航（Ethereal 用 Swup）会重写 `<head>`，把注入的样式表与脚本标签删掉：脚本代码
不会卸载，但样式会没，`canvas` 也可能被局部重建。改法：位置/层级/交互的底线走**行内**、
样式表丢了用副本**补回**、根在但画布消失连续约 6 秒就重建、挂载点被换掉就重挂。

### 修：升级后访客看到的还是旧版

Halo 给插件静态资源发的响应头是 `cache-control: max-age=31536000`（一年），固定路径会让
新版本长达一年到不了浏览器（真站踩过）。现在**公开路径带版本号**
（`/plugins/whale-pet-live2d/assets/v<版本>/…`），升级即换 URL，全部资源自动重新取。
