# 许可与署名 / Copyright and License

这个目录（Halo 插件的静态资源树）里**混着三类不同许可**的东西，请分别遵守。
完整版见仓库根目录 [`../../../NOTICE.md`](../../../NOTICE.md)（若已在插件包内，见插件说明页）。

## 1. 代码 —— MIT

适用于：`client.js`、`live2d-vendor.js`、`pet-shim.js`、`pet-halo.js`、`catalog`，
以及 `halo-plugin/` 下的 Java 源码与配置。

```
MIT License — Copyright (c) 2026 A8Chann（上游 DSH 插件）
              Copyright (c) 2026 zqy857（本 Halo 插件新增部分）
```

（`client.js` / `live2d-vendor.js` 是 `dsh-live2d-pet/lib/` 的逐字节副本；源头同为 MIT。）

## 2. 美术资源 —— CC BY-NC-SA 4.0

适用于：`pets/` 下的**模型、贴图、表情、动作**等一切美术内容。

**这些文件不是 MIT，也不可以按 MIT 使用。**
许可协议：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)
（署名 — 非商业性使用 — 相同方式共享）

### 版权所有人

| 版权所有人 | 版权所有内容 | 主页 |
|---|---|---|
| **上善无形**（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | [Pixiv](https://www.pixiv.net/users/62155430) |
| **ZipZipPipe** | 加入 DeepSeek 元素的女仆鲸鱼娘二次设计 | [Pixiv](https://www.pixiv.net/users/18604994) |
| **氵六青** | 本模型（DS鲸鱼娘）的 Live2D 绑定、动作、表情 | [Bilibili](https://space.bilibili.com/11272072) |

角色形象链：上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化。

### 你必须

- **署名**：注明上述三位版权所有人、附协议链接，并说明是否作过修改；
- **非商业性使用**：不得用于商业目的 —— 包括但不限于付费内容、带货/广告变现、
  周边售卖、以本素材作为卖点的付费产品或服务。**站点挂广告 / 付费会员 / 带货即属商业用途**，
  那时需要**分别**取得三位版权所有人的授权；
- **相同方式共享**：若改编本素材，你的贡献必须以**同一协议**分发，不得改用 MIT 或更宽松的协议。

模型作者 氵六青 已授权本项目转载与开源该模型，但该授权**不能覆盖基础版权**：
NC 与 SA 两条依然有效。

## 3. 第三方组件

| 组件 | 版本 | 许可 | 是否随本目录分发 |
|---|---|---|---|
| [pixi.js](https://github.com/pixijs/pixijs) | 8.19.0 | MIT | 是（打包进 `live2d-vendor.js`） |
| [untitled-pixi-live2d-engine](https://github.com/Untitled-Story/untitled-pixi-live2d-engine) | 1.3.5 | MIT | 是（打包进 `live2d-vendor.js`） |
| [React](https://react.dev/) | 18.3.1 | MIT | 是（`react.js` / `react-dom.js`，取自 `vendor/react/18.3.1/`） |

### Live2D Cubism Core —— **不包含在插件里**

`live2dcubismcore.min.js` 是 Live2D Inc. 的专有运行时（其文件头声明它对应协议中的
"Redistributable Code"）。**本插件不内置、也不代为分发它**：页面默认从 Live2D 官方 CDN 取

```
https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js
```

站长可以在插件设置里把它改成自建地址。正式发行使用了 Cubism SDK 的内容前，请自行确认
[Live2D SDK 发行许可](https://www.live2d.com/zh-CHS/sdk/license/) 的适用范围
（个人与小微企业通常免除签约与费用；「可扩展应用」不适用豁免）。

## 一句话总结

**代码 MIT，美术 CC BY-NC-SA 4.0。** 转载/二创请署名 上善无形、ZipZipPipe、氵六青，
别商用，并且用同样的协议分享。
