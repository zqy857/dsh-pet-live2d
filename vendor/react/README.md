# vendor/react — 打包进产物的 React 运行时副本

这里放的是 **React 18.3.1 的 UMD 构建**，原样（未改动）取自官方 npm 包：

```
https://unpkg.com/react@18.3.1/umd/react.development.js
https://unpkg.com/react@18.3.1/umd/react.production.min.js
https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js
https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
```

| 文件 | sha256 | 谁在用 |
|---|---|---|
| `react.production.min.js` + `react-dom.production.min.js` | `d949f1c3…` / `35f4f974…` | Halo 插件的 `client-shim.js`（`tools/build-halo-plugin.mjs` 拼接）；将来任何"脱离 DSH 独立托管"的产物都用它 |
| `react.development.js` + `react-dom.development.js` | `28348fef…` / `f9044a5e…` | `tools/browser-test/server.mjs` 的 harness 页面（保留开发版，才能和 CI 里 `npm install` 得到的那份一致） |

**为什么放在仓库里，而不是靠 `npm install`**：

1. Halo 插件的产物必须**自包含** —— 插件 jar 里要带一份 React，装插件的站长不该被要求去装 node 依赖；
2. 这台开发机（以及任何离线/受限环境）里 `npm install` 可能被策略拒绝
   （`npm error code EALLOWREMOTE: Fetching packages of type "remote" have been disabled`），
   而一旦 `tools/browser-test/node_modules/react/umd/` 缺失，harness 页面的 `/react.js` 就是
   500、宠物整个不启动 —— 症状是**一整套 CDP driver 全红**，而根因离断言很远。
   `server.mjs` 因此改成"先看 `node_modules`，没有再回落到这里"。

许可：React 为 **MIT**（文件头保留了 Facebook 的许可声明）。本目录不是本项目代码的一部分，
按原样分发。
