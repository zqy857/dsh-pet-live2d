# Halo 2.x 插件（移植）

把桌宠搬到 Halo 站点上时，**Halo 侧不实现宿主半区** —— 没有 `/api/live2d-pet/*`。
浏览器半区靠一个全局说清楚"我在静态托管里"，剩下全部静态化。这份 skill 记的是
Halo 平台本身的硬事实、这套架构的取舍，以及踩过的坑（含一个"不报错但功能没生效"的）。

## 结论先行：为什么 Halo 不需要写一行路由

`lib/client.js` 只依赖四样东西（见该文件顶部注释）：`__ModuleLoader__` 垫片、
react/react-dom、`const API`（catalog 与资产的根）、以及两条"问宿主"的循环
（`/layer` 每秒、`/settings` 每 3 秒）与相位 SSE（`/events`）。

Halo 侧于是这样落地：`window.__dshLive2dPetHost = { base: "/plugins/<name>/assets/pet", static: true }`

| 原来 | Halo 上 |
|---|---|
| `/api/live2d-pet/catalog` | 静态文件 `pet/catalog`（**无扩展名**，因为客户端取的就是 `<base>/catalog`），由 `tools/build-halo-plugin.mjs` 用 `buildCatalog()` 生成 |
| `/api/live2d-pet/asset/<id>/<rel>` | `pet/pets/<id>/<rel>`（model3.json 内部是相对引用，所以贴图/动作自动跟着走） |
| `/api/live2d-pet/runtime/live2d-vendor.js` | `pet/live2d-vendor.js`（逐字节副本） |
| `/api/live2d-pet/runtime/live2dcubismcore.min.js` | **不发**：catalog 里写官方 CDN，站长可在插件设置里改成自建 |
| `/layer`、`/settings` | `static: true` ⇒ 两条轮询都不开（原本会一直 404） |
| `/events`（相位 SSE） | 只跳过订阅；相位改由页面事件驱动 → `window.__dshLive2dPet.phaseNow()` |

**这样就没有第三份宿主实现**：catalog 仍由 JS 宿主半区算（脚本只是把 URL 重写并落盘）。

## Halo 平台的硬事实（已核对源码，别凭印象写）

* 静态资源约定前缀：`/plugins/<pluginName>/assets/<rule.path>`，
  由 `ReverseProxy`（`plugin.halo.run/v1alpha1`）+ `ReverseProxyRouterFunctionFactory` 提供。
  `file.directory` 走**插件类加载器**解析，所以 `src/main/resources/pet/` + `directory: pet` 正好。
* ReverseProxy 的路由**只认 GET**，按扩展名给 MIME；**没有扩展名的文件照发**
  （`catalog` 能取到，Spring 会给 `application/octet-stream`）——`fetch().json()` 不看 MIME。
* `/plugins/{name}/assets/**` 已在 Halo 的安全白名单里，匿名可访问（不用配 RBAC）。
* **包名不要占平台的命名空间**：应用市场审核会拒 `run.halo.*` 的第三方插件包名
  （"容易造成 Halo 平台代码与第三方插件代码的归属混淆"）。用开发者自己的反向域名，
  例如 GitHub 账号 `zqy857` → `io.github.zqy857.<插件名>`。改包名后**必须重新构建**，
  因为组件注册文件 `META-INF/plugin-components.idx`（Halo Gradle 插件自动生成）里写的是
  类的全限定名 —— 它跟着编译产物走，不跟着源码目录走。
  `tools/browser-test/test-halo-tree.mjs` 有一条断言钉住"源码包名与 Gradle group 都不是
  `run.halo.*`"。（2026-10 首次提交市场被拒后改的。）
* 注入页面的扩展点：`run.halo.app.theme.dialect.TemplateHeadProcessor`
  （`@since 2.0.0`，第三参是 `IElementModelStructureHandler`）；页脚是
  `TemplateFooterProcessor`（`@since 2.17.0`）。**不存在** `AbstractTemplateHeadProcessor`。
* 只对**主题端 Thymeleaf 渲染**生效：Console / UC（`/console/**`）不经过它。
* `Setting` 资源的 `metadata.name` **必须**等于 `plugin.yaml` 的 `spec.settingName`；
  配了 settingName 却没有同名 Setting ⇒ **插件启动失败**（不是"设置页空着"）。
* Halo 2.21+ 要求 **Java 21**。构建依赖 `run.halo.tools.platform:plugin` 与
  `run.halo.app:api` **都在 Maven Central** 上有（`repo.halo.run` 在开发机上不可达，
  `repositories { mavenCentral() }` 就够）。
* 反向代理的缓存：`WebProperties.resources.cache` 默认只靠 `Last-Modified` 验证 ——
  模型 4.3 MB，生产站点建议在 Nginx/CDN 给 `assets/pet/**` 加长缓存。

## 坑（按咬人程度）

0. **注入 `<script>` 绝不能用 `createStandaloneElementTag`**（真站报障：主题 Ethereal 的
   banner 整块坏掉，2026-10）。Thymeleaf 那条路会输出**自闭合**的 `<script … />`，而 HTML 里
   script **不是**自闭合元素：解析器把它当开标签，然后把**后面的一切**当脚本文本吞掉，
   直到遇见下一个 `</script>`。
   被吞的正是 `</head>`、`<body class="… enable-banner …" style="--bannerOffset:…">`、
   主题自己的 `<div id="config-carrier">` 与读它的内联脚本 ⇒ 主题的 banner 配置从未生效；
   而桌宠自己照常工作（`src` 不受影响），**服务端 200、日志一句没有**。
   正确写法：`factory.createOpenElementTag("script", attrs, AttributeValueQuotes.DOUBLE, false)`
   + `factory.createCloseElementTag("script")` 两个事件。
   怎么发现的（可复用）：把线上页面 HTML 拿下来，用 `DOMParser` 解析**两份** —— 原样一份、
   只把那个 `/>` 改成 `></script>` 一份 —— 对比 `#config-carrier` / `body.getAttributeNames()` /
   head 子元素数。这是"服务端序列化错了但一切照跑"这类问题的通用取证法。
   通用探针（已进 `halo-smoke`）：**源 HTML 里 `<body>` 上的属性，必须一个不少地出现在
   `document.body` 上**；不依赖任何具体主题。
1. **Thymeleaf 不转义属性值** —— `createStandaloneElementTag` 只按
   `AttributeValueQuotes` 挑引号，**属性内容原样写出去**。所以 `data-config` 里的 JSON
   必须自己把 `"` 换成 `&quot;`（`&` 要先换，否则会把新引入的 `&` 再转一遍）。
   漏了的症状极隐蔽：HTTP 200、服务端日志一句没有、`data-config="{"` 在第一个内层引号处
   断掉 ⇒ 前端 `JSON.parse` 失败、桌宠永不启动。**只有真浏览器能发现**，所以
   `tools/halo-smoke.mjs` 里有一条"属性解回来是合法 JSON"的断言，`pet-shim.js` 也留了
   `configRecovered` 证据位（兜底了也算失败）。
   **0.1.4 起这类问题被从结构上删掉了**：配置改放 `<script type="application/json" id="…">`
   的**标签体**里（借鉴 [LIlGG/plugin-live2d](https://github.com/LIlGG/plugin-live2d)
   的 `Live2dInitProcessor`），标签体里唯一要防的是 `<` ⇒ 全换 `\u003c`，一条规则。
   做法：把"配置块 + 加载脚本"作为**一个 `createText` 文本事件**写进 head。
   两个配套事实：① 处理器加到 model 里的文本是**原样输出**的（Thymeleaf 的 `[[…]]`
   内联只发生在**解析期**，不会回头处理处理器追加的文本）；② 我们要自己的加载脚本保持
   **外部**脚本（不是内联可执行 JS）—— 参考实现用的是内联 `<script type="module">`，
   站点配了 CSP `script-src` 就会整块失效，我们这点比它稳。
2. **`plugins/install` 同一个版本号不会换掉已加载的那份**：重建了 jar、重装、页面里跑的还是
   旧代码。冒烟脚本的做法是**先 DELETE 插件资源**（= 卸载）再 install。
3. **"相位通路"写在 SSE 的 effect 里**（`client.js` 的 session activity 那段）。
   无宿主模式下如果把**整个 effect** 跳过，`flushPhaseRef` / `phaseResolver` /
   `guardResolver` 就都没装 ⇒ `phaseNow()` 只改 `data-phase`、**动作一动不动，而且不报错**。
   正确做法：只跳过 `new EventSource(...)` 与 `addEventListener`，其余照装。
   发现方式值得抄：写 A/B 探针，在**同一次运行**里对比"DSH 的 SSE 相位"与
   "Halo 的 `phaseNow` 相位"读到的 `data-motion`（A: `[idle, BubbleGum]`，B 修前: `[idle]`）。
4. **无头浏览器里窗口不聚焦 ⇒ `el.focus()` 不派发 focus/focusin**
   （`document.activeElement` 会变，`document.hasFocus()` 是 false）。
   症状是把"聚焦评论框 → asking"误判成产品坏了。driver 里要
   `Emulation.setFocusEmulationEnabled({ enabled: true })`。
5. **贴图请求看不到**：引擎在 Worker 里取贴图，CDP 页面级 Network 域收不到
   `texture_00.png`。别拿"请求列表里有贴图"当断言，用 `maskInfo().present`
   （它是从渲染结果采样的命中遮罩 ⇒ 贴图真的进来了）。
6. 事件委托用 `focusin`（评论框可能是异步渲染的，绑具体节点会漏），
   选择器来自站长配置 ⇒ 一律 `try/catch` 包住 `matches/closest`，写错了不能把监听器炸掉。
7. **Halo 给插件静态资源发的响应头是 `cache-control: max-age=31536000`（一年）**
   （ReverseProxy 沿用全局 `spring.web.resources.cache`）。固定路径的后果：插件升级后，
   访客浏览器里跑的还是旧 JS，长达一年。真站上就这么被坑过 —— 0.1.1/0.1.2 的客户端修复
   **一个都没生效**，页面里连新加的 `diag()` 都不存在（症状很容易被误判成"改了没用"）。
   解法：**公开路径里带版本号**（`/plugins/<name>/assets/v<版本>/**`），升级即换 URL，
   catalog / client.js / vendor / 贴图 / 动作**全部**自动重新取。三处必须一致：
   `pet-base.properties`（Java 读）、`reverse-proxy.yaml` 规则、catalog 里的 URL ——
   生成器与 `test-halo-tree.mjs` 会互证。
8. **Swup 式软导航（主题 Ethereal 就用它）会重写 `<head>`**：实测导航后我们注入的
   `<style>` 与动态插入的 4 个 `<script>` 全被删掉。脚本**代码不会卸载**（已执行的
   interval 照跑），但**样式没了** ⇒ 位置/层级/交互的底线必须走行内（见第 9 条），
   外观靠 `pet-halo.js` 用样式文本副本补回。
   同一次导航里 **canvas 也可能被换掉**（`根在、canvas 不在`）⇒ 自愈不能只盯"根在不在"，
   还要有画布 watchdog（连续 ~3 个 tick 没 canvas 才重建；模型首次加载本来就要一两秒，
   阈值太短会把正常启动砸掉）。
7. **软导航测试删的是容器**（`[data-dsh-live2d-pet-root]`），不是 React 管的那个内层根：
   删内层节点会让 React 自己报 `removeChild ... not a child of this node`，
   那是"测试把人家的节点偷走了"，不是产品行为。
8. 焦点类相位只在页面**有焦点**时才有意义；这条对真实用户不是问题，对无头测试是。
9. **主题的软导航有两种破坏方式，都会让她"跑到左上角/躲到后面"**（真站报障，0.1.1 修）：
   - **重写 `<head>`**（`document.head.innerHTML = …`、Turbo 合并 head…）⇒ 注入的
     `<style>` 被删 ⇒ `position:fixed`/`z-index`/`pointer-events` 全丢，她退化成
     `body` 末尾的普通块级元素（body 是 flex/grid 的主题里就落在某个格位 = "左上角"）。
     修法：**位置/层级/交互的底线写进行内**（`rootStyle` 与 `[data-hit]`），外观继续留样式表；
     `pet-halo.js` 另外留一份样式文本副本，发现 `<style>` 不在就补回去（`styleRescues` 计数）。
   - **挂载点参与正常流**：`[data-dsh-live2d-pet-root]` 是 `body` 的最后一个子节点，普通流里
     会多占一个格位 ⇒ 真站上表现为"页面顶部的 banner 坏掉"。修法：挂载点
     `position:fixed; top:0; left:0; width:0; height:0; pointer-events:none`。
     验证方式最直接：**摘掉挂载点，主题原有子元素的 `getBoundingClientRect` 必须一个像素都不动**
     （`halo-smoke` 里就是这条断言）。
10. `getComputedStyle` 返回的是**活对象**：元素一 `remove()`，再读 `cs.position` 就是空字符串。
   断言前必须先快照。另外**被 `evaluate` 的模板字符串里不能出现反引号**（注释里也不行）——
   会把模板提前闭合，报"missing ) after argument list"。

## 验证（四条闸门）

```bash
node tools/build-halo-plugin.mjs --check          # 产物与源同步（含 client.js 逐字节相等）
cd tools/browser-test && node run-suite.mjs halo-tree --jobs 1   # 纯 node：catalog/闭包/许可/配置自洽
cd tools/browser-test && node run-suite.mjs halo --jobs 1        # CDP：静态启动 + 相位 + 重挂
node tools/halo-smoke.mjs --base <真Halo> --jar halo-plugin/build/libs/*.jar --user admin --pass ***
```

`cdp-halo` 里最值钱的两条断言是"整页**一次** `/api/live2d-pet` 都没有"与
"整页没有外部请求"（后者要求 Cubism Core 走本地/服务端缓存 —— 它不随插件分发）。

`halo-smoke.mjs` 是唯一验"真 Halo"的那条：清单/Setting/ReverseProxy 被接受、插件真 STARTED、
`<head>` 里那个标签长什么样、属性转义对不对、真浏览器里她起没起来。
本机怎么起一个 Halo（H2、放开 basic auth 才能用 API）：

```bash
java -jar halo.jar --halo.work-dir=/tmp/halo --server.port=8099 \
     --halo.external-url=http://127.0.0.1:8099 --halo.security.basic-auth.disabled=false
curl -X POST <base>/system/setup -d 'username=admin&password=admin12345&email=a@b.c&siteTitle=t&language=zh-CN&externalUrl=<base>'
```

两个环境细节：`halo.security.basic-auth.disabled=false` 才能用 Basic 认证调 Console API
（默认会 302 到 `/login`）；H2 默认配置就在 fat jar 里（`r2dbc:h2:file:///${halo.work-dir}/db/halo-next`）。
