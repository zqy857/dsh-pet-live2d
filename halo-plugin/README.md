# halo-plugin —— Halo 2.x 插件的工程说明

这个目录是插件本体（Java 代码 + 扩展点声明 + 生成好的静态资源 + Gradle 工程）。

- 用户要用的（安装、设置、许可、排障入口）：看[根 README](../README.md)；
- 版本变化：看 [`CHANGELOG.md`](CHANGELOG.md)；
- Halo 扩展点的硬事实与踩过的坑：看 [`.dsh/skills/halo-plugin/SKILL.md`](../.dsh/skills/halo-plugin/SKILL.md)。

## 目录里有什么

| 路径 | 说明 |
|---|---|
| `src/main/java/run/halo/whalepetlive2d/` | 两个类：`WhalePetLive2dPlugin`（`BasePlugin`）与 `WhalePetLive2dHeadProcessor`（注入 `<head>`） |
| `src/main/resources/plugin.yaml` | 插件清单。`metadata.name` = `whale-pet-live2d`；`settingName` 必须与 Setting 的 `metadata.name` 一字不差，否则插件启动失败 |
| `src/main/resources/extensions/settings.yaml` | 控制台里的设置页（分组 `basic`） |
| `src/main/resources/extensions/reverse-proxy.yaml` | **生成**：把 jar 内的 `pet/` 挂成 `/plugins/whale-pet-live2d/assets/v<版本>/**` |
| `src/main/resources/pet-base.properties` | **生成**：Java 侧读的静态资源前缀（与上面两处、与 catalog 三处互证） |
| `logo.png` | **手写**：插件图标源文件（512×512，透明背景头部特写）；生成器复制到 `src/main/resources/logo.png`（`spec.logo` 是相对 `src/main/resources` 的路径） |
| `src/main/resources/pet/` | **生成**（4 个手写文件除外）：详见 [`src/main/resources/pet/README.md`](src/main/resources/pet/README.md) |
| `gradle.properties` | 版本号唯一来源（`plugin.yaml` 的 `spec.version` 由 devtools 按它写入） |

## 注入规格

`TemplateHeadProcessor` 往 `<head>` 末尾追加**一个文本事件**，内容是两段标签：

```html
<script type="application/json" id="whale-pet-live2d-config">{"base":"/plugins/whale-pet-live2d/assets/v0.2.0","coreUrl":"","phases":true}</script>
<script defer src="/plugins/whale-pet-live2d/assets/v0.2.0/pet-shim.js"></script>
```

两段都是手写的完整闭合标签，配置放在**标签体**里：

- **不用自闭合的 `<script … />`**：HTML 里 script 不是自闭合元素，解析器会把它当开标签，
  一路吞掉后面的 `</head>`、`<body class="…">` 与主题自己的配置元素，直到遇见下一个
  `</script>`。真站（Ethereal 主题）上首屏 banner 就是这么坏的；
- **配置不塞 HTML 属性**：Thymeleaf 不替属性值转义，塞属性里就得自己把 `"` 换成 `&quot;`，
  漏一个属性就在第一个内层引号处断掉（服务端 200、日志无声）。放进标签体后只剩一条规则：
  把 JSON 里的 `<` 换成 `\u003c`。

写进 model 的文本是原样输出的 —— Thymeleaf 的 `[[…]]` 内联只发生在**解析期**，不会回头
处理处理器追加的文本。配置块里的字段含义见
[`pet/README.md`](src/main/resources/pet/README.md#配置块的字段)。

## 排障

两条真站上出过的问题，现象与自检方式如下。

### 顶部 banner 坏掉、主题像没生效

**现象**：首页 banner 加载不出来，主题的 body 类名 / 自定义属性像是没应用，而桌宠自己正常。

**自检**（页面控制台）：

```js
// 源 HTML 里 <body> 上的属性，必须都还在 DOM 上
[...document.body.attributes].map((a) => a.name)
// 主题自己的配置元素（按主题换选择器，Ethereal 是 #config-carrier）
document.getElementById('config-carrier')
```

body 上的 `class` / `style` / `data-*` 比源 HTML 少，就是被自闭合 `<script/>` 吞掉了。

### 切页面后她不见了 / 位置失效

主题的软导航（Ethereal 用 Swup）会重写 `<head>`：注入的 `<style>` 与动态脚本标签被删掉，
`canvas` 也可能被换掉。现在的兜底是：位置 / 层级 / 交互的底线写在**行内**；样式表丢了用
内容副本补回；`canvas` 连续约 6 秒不见就重建；挂载点被换掉就重挂（软导航事件 + 2 秒轮询）。

```js
window.__dshLive2dPetHalo.diag()
// { styleTag, styleRescues, petPosition, petInlinePosition, petZIndex,
//   containerPosition, containerSize, appliedCount, lastEvent, errors }
```

`lastEvent` 会写 `soft-nav` / `watchdog` / `canvas-watchdog`，一眼看出是谁救的场。

### 确认访客拿到的是新版本

Halo 给插件静态资源的响应头是 `cache-control: max-age=31536000`，所以公开路径里带版本号
（`/plugins/whale-pet-live2d/assets/v<版本>/…`）。升级插件即换前缀，不需要访客清缓存。
页面里 `window.__dshLive2dPetBoot.config.base` 就是当前实际用的前缀。

## 构建与验证

```bash
# 静态资源是生成的：改过 dsh-live2d-pet/lib/ 或宠物之后必须重跑
node tools/build-halo-plugin.mjs            # 生成
node tools/build-halo-plugin.mjs --check    # 只校验产物与源一致

cd halo-plugin && ./gradlew build           # JDK 21；产物 build/libs/whale-pet-live2d-<版本>.jar

cd tools/browser-test
node run-suite.mjs halo halo-tree --jobs 1  # 静态托管契约 + 产物自洽，不需要起 Halo
```

**真 Halo 冒烟**（注入、设置读取、ReverseProxy 与真浏览器里的启动，23 项）：

```bash
java -jar halo.jar --halo.work-dir=/tmp/halo --server.port=8099 \
     --halo.external-url=http://127.0.0.1:8099 --halo.security.basic-auth.disabled=false
curl -X POST http://127.0.0.1:8099/system/setup \
     -d 'username=admin&password=admin12345&email=a@b.c&siteTitle=t&language=zh-CN&externalUrl=http://127.0.0.1:8099'

node tools/halo-smoke.mjs --base http://127.0.0.1:8099 \
     --jar halo-plugin/build/libs/whale-pet-live2d-0.2.1.jar --user admin --pass admin12345
```

换主题之后想重跑一遍：装主题 → 激活 → 再跑上面最后那条命令。

```bash
curl -u admin:admin12345 -X POST \
     http://127.0.0.1:8099/apis/api.console.halo.run/v1alpha1/themes/install -F "file=@主题.zip"
curl -u admin:admin12345 -X PUT \
     http://127.0.0.1:8099/apis/api.console.halo.run/v1alpha1/themes/<主题名>/activation
```

## 跟上游同步

这个仓库是 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d) 的 fork，
`dsh-live2d-pet/lib/` 与宠物包都来自上游 —— 上游更新时合并进来即可：

```bash
git fetch upstream
git merge upstream/main          # 冲突多半在 tools/ 与 dsh-live2d-pet/，Halo 侧一般不动
node tools/build-halo-plugin.mjs # 合并后必须重新生成，否则插件里还是旧客户端
node tools/build-halo-plugin.mjs --check
cd tools/browser-test && node run-suite.mjs halo halo-tree --jobs 1
```

`halo-plugin/src/main/resources/pet/` 是生成物，合并冲突时**不要手改**：取上游源文件，
重跑生成器覆盖它。

## 改代码时的两条纪律

1. **`src/main/resources/pet/` 里除 4 个手写文件外都是生成的**（`pet-shim.js`、`pet-halo.js`、
   `README.md`、`LICENSES.md` 是手写）—— 不手改生成物，改源头后重跑生成器，提交前跑 `--check`。
2. **专有运行时与美术许可照旧**：Cubism Core 不随包分发（catalog 里写官方 CDN，站长可改自建）；
   模型是 CC BY-NC-SA 4.0（非商业），随包必须带 `pet/LICENSES.md` 与三位作者的署名。
