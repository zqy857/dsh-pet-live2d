# 鲸鱼娘桌宠（Live2D）· Halo 2.x 插件

**给 Halo 博客挂一只 Live2D 桌宠** —— 她住在页面角落，能拖、能缩、跟着鼠标看，点她会害羞；
评论、搜索这些**页面事件**会变成她的动作与表情（在等你评论 = 举手问号，评论发出去了 = 开心转圈）。
自带 **DS鲸鱼娘**（8 组动作 + 44 个表情/道具 + 20 个装扮槽），装完即用。

> 插件 id：`whale-pet-live2d` · 要求 **Halo ≥ 2.21**（JDK 21）
> 上游：[A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d)（DSH 桌宠插件，MIT）——
> 本仓库是它的 fork，`halo-plugin/` 是新增并维护的 Halo 插件；上游那套 DSH 文档在
> [`dsh-live2d-pet/README.md`](dsh-live2d-pet/README.md)。

<p align="center">
  <a href="https://github.com/zqy857/dsh-pet-live2d/releases"><img src="https://img.shields.io/github/v/release/zqy857/dsh-pet-live2d?style=flat-square&amp;label=release" alt="Release"></a>
  <img src="https://img.shields.io/badge/Halo-%3E%3D2.21-4c6ef5?style=flat-square" alt="Halo">
  <img src="https://img.shields.io/badge/Live2D-Cubism%205-ff69b4?style=flat-square" alt="Cubism 5">
  <a href="NOTICE.md"><img src="https://img.shields.io/badge/license-MIT%20%2B%20CC%20BY--NC--SA%204.0-2ea44f?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="dsh-live2d-pet/docs/preview.png" alt="鲸鱼娘" width="320">
</p>

| 能力 | 说明 |
|---|---|
| 常驻陪伴 | 挂在页面右下角，可拖动 / 缩放，位置与大小记在访客浏览器里 |
| 眼神跟随 | 跟着鼠标看；摸头（点头部）/ 摸尾巴 / 绕着转圈都有不同反应 |
| 换装 | 20 个互斥槽位、44 个表情/道具，右键面板现场换，装扮跨会话保留 |
| 页面事件相位 | 聚焦评论框 = `asking`、提交评论 = `done`、站内搜索 = `thinking`（可关、可选自定义选择器） |
| 不挡主题 UI | 只有角色剪影吃鼠标事件，方形画布的透明处**穿透**到底下的页面；挂载点零尺寸固定定位，摘掉它主题布局一个像素都不动 |
| 自己会修 | 主题软导航（Swup/PJAX 之类）重写 `<head>` 删掉样式表、换掉 `canvas`、整块替换挂载点 —— 都能自己回来 |
| 干净 | 不收集、不上传任何访客数据；Live2D Cubism Core **不随包分发**（默认官方 CDN，可改自建） |

## 安装

1. 从 [Releases](https://github.com/zqy857/dsh-pet-live2d/releases) 下载 `whale-pet-live2d-<版本>.jar`；
2. Halo 控制台 → **插件** → 右上角 **安装** → 上传这个 jar → **启用**；
3. 前台刷新页面，右下角就有她了。

从旧 id 升级的注意：早期版本用的插件 id 是 `dsh-pet-live2d`，与现在这个
`whale-pet-live2d` **是两个插件**（会同时挂两只），装之前先把旧的停用/卸载。

## 插件设置

控制台 → 插件 → 鲸鱼娘桌宠 → **设置**：

| 设置项 | 默认 | 说明 |
|---|---|---|
| 启用桌宠 | 开 | 关掉后前台**一个标签都不注入** |
| Cubism Core 地址 | 空 | 空 = 用 Live2D 官方 CDN；离线/自建就填自己的地址（专有运行时不随插件分发） |
| 启用「博客事件 → 相位」 | 开 | 评论、搜索等事件驱动她换动作 |
| 评论区域选择器 | 空 | 识别评论区的 CSS 选择器，逗号分隔；空 = 用内置的常见选择器 |
| 搜索区域选择器 | 空 | 同上，用于搜索框 |
| 默认覆盖表（JSON） | 空 | 想改「哪个相位演什么」时填，格式见 [`halo-plugin/README.md`](halo-plugin/README.md) |

**主题里想自己控制她**（比如"文章点赞时做个开心动作"）：

```js
window.__haloPetPhase("done");        // 立刻切到该相位
window.__haloPetPhase("asking", 3000); // 保持 3 秒后自己回落
window.__dshLive2dPetHalo.diag();      // 出问题时打印自检信息（样式/位置/自愈次数/报错）
```

## 兼容性与已验证

- **Halo 2.21.0** 与 **2.26.0**（当前最新）：安装 / 启用 / 注入 / 前台渲染 / 设置 / 软导航自愈 /
  禁用，全部通过 `tools/halo-smoke.mjs` 的 23 项检查；
- 主题：官方默认主题 theme-earth、社区主题 theme-hao，以及使用 Swup 软导航的 Ethereal（真站）；
- 已知边界：站点若在反向代理上加了严格 CSP，需要放行同源静态资源与 `cubism.live2d.com`
  （插件不含可执行的内联脚本）；移动端观感未实测。

## 开发与验证

```bash
node tools/build-halo-plugin.mjs                  # 生成插件里的静态资源（改过客户端或宠物后必须重跑）
node tools/build-halo-plugin.mjs --check          # 校验产物与源一致（提交前跑）
cd halo-plugin && ./gradlew build                 # 需要 JDK 21，产物在 build/libs/*.jar

cd tools/browser-test && node run-suite.mjs halo halo-tree --jobs 1   # 静态托管契约 + 产物自洽（不用起 Halo）
node tools/halo-smoke.mjs --base http://127.0.0.1:8099 \
  --jar halo-plugin/build/libs/whale-pet-live2d-<版本>.jar --user admin --pass <密码>   # 真 Halo 冒烟 23 项
```

## 目录结构

| 路径 | 是什么 |
|---|---|
| `halo-plugin/` | **Halo 2.x 插件**（Java + 注入规格 + 生成好的静态资源 + 自己的 [CHANGELOG](halo-plugin/CHANGELOG.md)） |
| `tools/build-halo-plugin.mjs` | 从下面那份客户端/宠物**生成**插件静态资源，并自检（版本化前缀、闭包、不含专有运行时） |
| `tools/halo-smoke.mjs` | 真 Halo 端到端冒烟（安装 / 注入 / 渲染 / 自愈 / 图标） |
| `tools/browser-test/` | 浏览器回归基建（`cdp-halo.mjs` = Halo 静态托管契约，`test-halo-tree.mjs` = 产物自洽） |
| `dsh-live2d-pet/` | **上游 DSH 插件**：浏览器半区（`lib/client.js`）、宠物包、DSH 宿主实现 —— 插件静态资源的来源 |
| `dsh-live2d-pet-desktop/` | 上游桌面端（Tauri 壳），本 fork 不涉及 |

## 许可与署名

- **代码 MIT**：上游部分 © 2026 A8Chann；本 fork 新增的 Halo 插件部分 © 2026 zqy857（见 [`NOTICE.md`](NOTICE.md)）；
- **模型与贴图 CC BY-NC-SA 4.0**（署名 · **非商业** · 相同方式共享）：角色形象原作
  [上善无形](https://www.pixiv.net/users/62155430)、DeepSeek 元素二次设计
  [ZipZipPipe](https://www.pixiv.net/users/18604994)、Live2D 绑定/动作/表情
  [氵六青](https://space.bilibili.com/11272072)；详表见 [`halo-plugin/src/main/resources/pet/LICENSES.md`](halo-plugin/src/main/resources/pet/LICENSES.md)。
  站点若有广告/付费内容并把它当卖点，属商业用途，需**分别**取得授权；
- **与 DeepSeek 官方无任何关系**：角色形象是社区基于 DeepSeek 元素的同人二创，本插件不是官方产品；
- **Live2D Cubism Core** 是 Live2D Inc. 的专有软件，本仓库**不分发**它。

想要 DSH / 桌面端版本，请去上游 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d)。
