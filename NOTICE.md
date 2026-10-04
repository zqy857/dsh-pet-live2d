# 版权与许可 / Copyright and License

本仓库包含**两类不同许可**的内容，请分别遵守。

This repository contains two kinds of material under **two different licenses**.

---

## 1. 代码 —— MIT

适用于：`dsh-live2d-pet/`（插件本体）、`halo-plugin/`（Halo 2.x 插件）、
`tools/`（构建与测试工具）、`vendor/react/` 之外的 `model-packs/` 脚本与清单。

```
MIT License — Copyright (c) 2026 A8Chann
```

完整文本见根目录 `LICENSE`。

> `vendor/react/18.3.1/` 放的是 **React 的官方 UMD 构建**（MIT，版权归 Meta /
> Facebook, Inc.），原样取自 npm，**不是**本项目代码 —— 见该目录的 `README.md`。
> 它被打进 Halo 插件的静态资源（`pet/react.js`、`pet/react-dom.js`）。

---

## 2. 美术资源 —— CC BY-NC-SA 4.0

适用于：`dsh-live2d-pet/pets/ds-whale-girl/`、`model-packs/DS鼠控版/` 中的**模型、贴图、表情、动作**等一切美术内容、
`halo-plugin/src/main/resources/pet/pets/`（同一份宠物，供 Halo 插件使用），
以及 `dsh-live2d-pet/docs/` 中的截图。

**这些文件不是 MIT，也不可以按 MIT 使用。**
许可协议：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)
（署名 — 非商业性使用 — 相同方式共享）

### 版权所有人

| 版权所有人 | 版权所有内容 | 主页 |
|---|---|---|
| **上善无形**（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | [Pixiv](https://www.pixiv.net/users/62155430) · [Bilibili](https://b23.tv/8h5L4xz) |
| **ZipZipPipe** | 加入 DeepSeek 元素的女仆鲸鱼娘二次设计 | [Pixiv](https://www.pixiv.net/users/18604994) · [Bilibili](https://b23.tv/Pnw6nG8) |
| **氵六青** | 本仓库所用 Live2D 模型（绑定、动作、表情） | [Bilibili](https://space.bilibili.com/11272072) |

角色形象链：上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化。

### 你可以

- **分享**：以任何媒介或格式复制、发行本素材
- **改编**：重混、转换、基于本素材创作

只要你遵守下列条件。

### 你必须

- **署名**：注明上述三位版权所有人，附上协议链接，并**说明是否作了修改**
- **非商业性使用**：**不得用于商业目的**。这包括但不限于：付费内容、带货/广告变现的直播、
  周边售卖、以本素材作为卖点的付费产品或服务
- **相同方式共享**：若你改编本素材，你的贡献必须以**同一协议**（CC BY-NC-SA 4.0）分发，
  不得改用 MIT 或其它更宽松的协议

### 关于「二创授权」的说明

Live2D 作者 氵六青 已授权本项目转载与开源该模型。**但该授权不能覆盖基础版权**：
鲸鱼娘角色形象本身由 上善无形 与 ZipZipPipe 以 CC BY-NC-SA 4.0 发布，
所以**非商业（NC）与相同方式共享（SA）这两条依然有效**，不因作者同意转载而解除。

如果你需要商业使用，必须**分别取得**上述版权所有人的授权，而不是只联系其中一位。

---

## 3. 未包含的第三方组件

- **Live2D Cubism Core**（`live2dcubismcore.min.js`）为 Live2D Inc. 专有软件，
  **本仓库不包含、也不代为分发**。使用者须自行从
  [Live2D 官方 Cubism SDK for Web](https://www.live2d.com/download/cubism-sdk/download-web/) 取得。

## 4. 打包进 `lib/live2d-vendor.js` 的第三方库

| 组件 | 版本 | 许可 |
|---|---|---|
| [pixi.js](https://github.com/pixijs/pixijs) | 8.19.0 | MIT |
| [untitled-pixi-live2d-engine](https://github.com/Untitled-Story/untitled-pixi-live2d-engine) | 1.3.5 | MIT |

## 5. 本仓库相对上游的新增内容

本仓库是 [A8Chann/dsh-pet-live2d](https://github.com/A8Chann/dsh-pet-live2d) 的 fork：
上游代码（`dsh-live2d-pet/`、`dsh-live2d-pet-desktop/`、`tools/` 等）仍是
**MIT © 2026 A8Chann**，声明原样保留；本 fork 新增的部分（`halo-plugin/` 的 Java 插件与
Halo 侧脚本、`halo-plugin` 相关的构建与验证工具）为 **MIT © 2026 zqy857**。
美术资源的许可不变，仍是 CC BY-NC-SA 4.0（见第 2 节）。

## 6. 打进 Halo 插件静态资源的第三方库

| 组件 | 版本 | 许可 | 文件 |
|---|---|---|---|
| [React](https://react.dev/) / ReactDOM | 18.3.1 | MIT | `pet/react.js`、`pet/react-dom.js`（源自 `vendor/react/18.3.1/`） |

Halo 页面里没有 DSH 的模块表，所以这个插件自带一份 React；DSH 侧仍然由 DSH 提供 React，
两处互不影响。

---

## 一句话总结

**代码 MIT，美术 CC BY-NC-SA 4.0。**
转载/二创请署名 上善无形、ZipZipPipe、氵六青，别商用，并且用同样的协议分享。
