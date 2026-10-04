// Halo 静态托管契约：**没有宿主路由**时，桌宠仍然要能跑起来并被页面事件驱动。
//
// 这条 driver 是"路线 B（Halo 插件）"的验收闸门，量的是四件用户可见的事：
//
//   1. 只靠静态文件（catalog / client.js / vendor / React / 模型）就能启动 ——
//      整页**一次** `/api/live2d-pet/*` 都不许有（Halo 那边没有这些路由）；
//   2. 模型真的渲染出来了（canvas + 引擎读口就绪），并且没有任何请求失败；
//   3. 相位**不再来自 SSE**，而是由 `phaseNow()` 驱动，且真的换动作
//      （读 `data-motion`：这只宠物的 done 相位映射到 BubbleGum）；
//   4. 主题软导航把节点换掉之后，她能自己重新挂回来。
//
// 断言都是确定性的：不截图像素、不看 hash，失败一定给出可复现的那一条。
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browserPath, PROFILES, BASE } from './paths.mjs'
import { killBrowser } from './ready.mjs'

const EDGE = browserPath()
const PORT = 9371
const PROFILE = join(PROFILES, '_cdp-halo')
rmSync(PROFILE, { recursive: true, force: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const record = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' — ' + detail))
}

const browser = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + PROFILE, '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' })

let ws
let exitCode = 1
try {
  let page
  for (let i = 0; i < 120 && page === undefined; i++) {
    try { page = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((t) => t.type === 'page') } catch { /* 还没起来 */ }
    if (page === undefined) await sleep(250)
  }
  if (page === undefined) throw new Error('调试端口没起来')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let nextId = 0
  const pending = new Map()
  const responses = []
  const pageLogs = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const settle = pending.get(message.id)
      if (settle !== undefined) { pending.delete(message.id); settle(message) }
      return
    }
    if (message.method === 'Network.responseReceived') {
      responses.push({ url: message.params.response.url, status: message.params.response.status })
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      pageLogs.push(message.params.type + ': ' + message.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageLogs.push('EXCEPTION: ' + (message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text))
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const ev = async (expression) => {
    const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.result?.exceptionDetails !== undefined) {
      return 'THREW: ' + (message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text)
    }
    return message.result?.result?.value
  }
  /** 轮询直到 probe 返回真值；返回那个值或 undefined（超时）。 */
  const until = async (probe, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await probe()
      if (value) return value
      if (Date.now() > deadline) {
        if (label !== undefined) console.log('  （超时：' + label + '）')
        return undefined
      }
      await sleep(120)
    }
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  // 无头浏览器里窗口**不是**聚焦状态：这时 `el.focus()` 会移动 activeElement，
  // 但 **focus/focusin 事件一个都不派发**（`document.hasFocus()` 是 false）——
  // 于是"聚焦评论框 → asking"这条会被误判成产品坏了。这条 CDP 命令就是干这个的。
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Page.navigate', { url: BASE + '/halo' })

  // ---- 1. 启动 ----
  const boot = await until(
    async () => {
      const raw = await ev('window.__dshLive2dPetBoot ? JSON.stringify(window.__dshLive2dPetBoot) : ""')
      if (raw === '' || raw === undefined) return undefined
      const state = JSON.parse(raw)
      // 等它**真的**加载完（`__dshLive2dPetBoot` 从 init 那一刻就存在了）
      if (state.ok !== true && state.error === null) return undefined
      return raw
    },
    40000, 'pet-shim 启动',
  )
  const bootState = boot === undefined ? null : JSON.parse(boot)
  record('pet-shim 按序加载完 4 个文件', bootState !== null && bootState.ok === true && bootState.stage === 'done',
    bootState === null ? '没等到 __dshLive2dPetBoot' : ('stage=' + bootState.stage + ' error=' + bootState.error))
  record('启动期没有报错', bootState !== null && bootState.error === null, bootState?.error ?? '')
  // `data-config` 必须**原样解析成功**：属性里的双引号一旦没转义，HTML 就会在第一个
  // 内层引号处断开（服务端返回码还是 200、日志一句话都没有）。pet-shim 对此有兜底，
  // 所以这里必须盯住 `configRecovered` —— 兜住了也算失败。
  record('data-config 原样解析成功（没有走 base 兜底）',
    bootState !== null && bootState.configRecovered !== true
      && typeof bootState.config?.base === 'string'
      && /^\/plugins\/whale-pet-live2d\/assets\/v[^/]+$/.test(bootState.config.base),
    JSON.stringify(bootState?.config ?? null) + ' recovered=' + String(bootState?.configRecovered))
  // 配置改由 `<script type="application/json">` 标签体承载（借鉴社区插件）：
  // 不再有任何"属性值转义"的余地，`configSource` 就钉住这件事。
  record('配置来自 application/json 标签体（不是 data-config 属性）',
    bootState !== null && bootState.configSource === 'json-block',
    'configSource=' + String(bootState?.configSource))

  // ---- 2. 渲染 ----
  const canvas = await until(
    async () => await ev('document.querySelector("[data-dsh-live2d-pet] canvas") !== null'),
    40000, '模型 canvas',
  )
  record('Live2D canvas 渲染出来', canvas === true)
  // 只看"有没有 canvas"是不够的：贴图没加载时 canvas 照样在（只是空白）。命中遮罩是
  // **从渲染结果里采样出来的**（`maskInfo().present`），它成立就意味着贴图真的进来了。
  const mask = await until(
    async () => await ev('!!(window.__dshLive2dPet && window.__dshLive2dPet.maskInfo && window.__dshLive2dPet.maskInfo().present)'),
    30000, '命中遮罩（贴图已加载）',
  )
  record('模型的贴图/几何真的到位（命中遮罩采样成立）', mask === true)
  await ev('window.__dshLive2dPet.setFidgetEnabled && window.__dshLive2dPet.setFidgetEnabled(false)')
  const haloState = JSON.parse(await ev('JSON.stringify(window.__dshLive2dPetHalo ?? null)') ?? 'null')
  record('pet-halo 挂上了插件（apply 成功）', haloState !== null && haloState.applied === true && haloState.appliedCount >= 1,
    haloState === null ? '没有 __dshLive2dPetHalo' : ('appliedCount=' + haloState.appliedCount))
  const pageErrors = JSON.parse(await ev('JSON.stringify(window.__errors ?? [])') ?? '[]')
  record('页面没有未捕获错误', Array.isArray(pageErrors) && pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 200))

  // ---- 3. 静态托管的硬证据：一次宿主路由都没问 ----
  const apiHits = responses.filter((r) => r.url.includes('/api/live2d-pet'))
  record('整页没有一次 /api/live2d-pet 请求（无宿主模式生效）', apiHits.length === 0,
    apiHits.slice(0, 4).map((r) => r.status + ' ' + r.url.replace(BASE, '')).join(', '))
  const external = responses.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith('data:'))
  record('整页没有外部请求（Cubism Core 走本地/服务端缓存）', external.length === 0,
    external.slice(0, 4).map((r) => r.url).join(', '))
  const bad = responses.filter((r) => r.status >= 400 && !r.url.endsWith('/favicon.ico'))
  record('没有任何失败的资源请求', bad.length === 0,
    bad.slice(0, 5).map((r) => r.status + ' ' + r.url.replace(BASE, '')).join(', '))

  // 静态目录的前缀**带版本号**（生成器写的），所以从页面配置里取，别在这写死。
  const assetBase = bootState?.config?.base ?? '/plugins/whale-pet-live2d/assets/pet'
  const wanted = [
    ['catalog', assetBase + '/catalog'],
    ['client.js', assetBase + '/client.js'],
    ['live2d-vendor.js', assetBase + '/live2d-vendor.js'],
    ['react.js', assetBase + '/react.js'],
    ['react-dom.js', assetBase + '/react-dom.js'],
    ['pet-shim.js', assetBase + '/pet-shim.js'],
    ['pet-halo.js', assetBase + '/pet-halo.js'],
    ['Cubism Core', '/halo-core/live2dcubismcore.min.js'],
    ['model3.json', 'c_0120.model3.json'],
    ['moc3', 'c_0120.moc3'],
  ]
  const missing = wanted.filter(([, needle]) => !responses.some((r) => r.url.includes(needle)))
  record('该取的静态资源都取了（' + wanted.length + ' 项）', missing.length === 0,
    missing.map(([name]) => name).join(', '))
  // 版本进路径的目的就是"升级即换 URL"，这条把前缀钉住：不能退回不带版本的老路径。
  record('静态资源前缀带版本号（升级即换 URL，绕开 Halo 的一年缓存）',
    /^\/plugins\/whale-pet-live2d\/assets\/v[^/]+$/.test(assetBase), assetBase)

  // ---- 4. 相位由 phaseNow 驱动（不再有 SSE）----
  const readState = async () => JSON.parse(
    await ev(`JSON.stringify((() => { const el = document.querySelector("[data-dsh-live2d-pet]"); return el === null ? null : { phase: el.getAttribute("data-phase"), motion: el.getAttribute("data-motion") } })())`) ?? 'null',
  )
  const before = await readState()
  record('初始处于 idle 相位', before !== null && before.phase === 'idle', JSON.stringify(before))

  await ev('window.__dshLive2dPet.phaseNow("done")')
  const donePhase = await until(async () => (await readState())?.phase === 'done' ? true : undefined, 5000, 'phase=done')
  const doneMotion = await until(async () => (await readState())?.motion === 'BubbleGum' ? 'BubbleGum' : undefined, 6000, 'motion=BubbleGum')
  record('phaseNow("done") 让 data-phase 变 done', donePhase === true)
  record('done 相位真的换到了宠物声明的动作组 BubbleGum', doneMotion === 'BubbleGum',
    JSON.stringify(await readState()))

  await ev('window.__dshLive2dPet.phaseNow("idle")')
  const backIdle = await until(async () => (await readState())?.phase === 'idle' ? true : undefined, 5000, 'phase 回 idle')
  record('phaseNow("idle") 回到 idle', backIdle === true)

  // ---- 5. 博客事件 → 相位 ----
  const focused = await until(
    async () => await ev('(() => { const el = document.querySelector("#comment-form textarea"); if (el === null) return false; el.focus(); return document.activeElement === el })()'),
    5000, '聚焦评论框',
  )
  const asking = await until(async () => (await readState())?.phase === 'asking' ? true : undefined, 5000, 'phase=asking')
  const afterFocus = JSON.parse(await ev('JSON.stringify(window.__dshLive2dPetHalo ?? null)') ?? 'null')
  record('聚焦评论框 → asking', focused === true && asking === true,
    'focused=' + String(focused) + ' lastEvent=' + String(afterFocus?.lastEvent))

  // 提交评论：先掐掉表单的默认跳转（真实站点上会跳走，这里只验相位）
  await ev('(() => { const f = document.getElementById("comment-form"); f.addEventListener("submit", (e) => e.preventDefault(), true); return true })()')
  await ev('document.querySelector("#comment-form button[type=submit]").click()')
  const submitDone = await until(async () => (await readState())?.phase === 'done' ? true : undefined, 5000, '提交 → done')
  record('点击"提交评论" → done', submitDone === true)

  const searchFocus = await ev('(() => { const el = document.querySelector("#search-form input"); if (el === null) return false; el.focus(); return document.activeElement === el })()')
  const thinking = await until(async () => (await readState())?.phase === 'thinking' ? true : undefined, 5000, 'phase=thinking')
  record('聚焦站内搜索 → thinking', searchFocus === true && thinking === true)

  // ---- 6. 主题把 DOM 换掉之后：位置/层级/交互的底线 + 样式自愈 ----
  //
  // 两条都来自真站上的报障：
  //   ① 主题的软导航会重写 <head>，把注入的 <style> 一起带走 ⇒ 位置与 z-index 丢了；
  //   ② 挂载点是 body 的最后一个子节点，参与正常流时会挤坏主题的栅格（顶部 banner）。
  // 现在位置/层级/交互的底线在**行内**，样式表丢了由 pet-halo 用副本补回去。
  const inert = await ev(`(() => {
    const c = document.querySelector("[data-dsh-live2d-pet-root]");
    if (c === null) return null;
    const cs = getComputedStyle(c);
    return JSON.stringify({ position: cs.position, w: c.offsetWidth, h: c.offsetHeight });
  })()`)
  const inertState = inert === undefined || inert === null ? null : JSON.parse(inert)
  record('挂载点对宿主布局是惰性的（fixed + 零尺寸）',
    inertState !== null && inertState.position === 'fixed' && inertState.w === 0 && inertState.h === 0,
    JSON.stringify(inertState))

  const inlineBottom = await ev(`(() => {
    const el = document.querySelector("[data-dsh-live2d-pet]");
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return JSON.stringify({
      inline: el.style.position, computed: cs.position, z: cs.zIndex, hit: (() => {
        const h = el.querySelector("[data-hit]");
        return h === null ? null : getComputedStyle(h).pointerEvents;
      })(),
    });
  })()`)
  const bottomState = inlineBottom === undefined || inlineBottom === null ? null : JSON.parse(inlineBottom)
  record('位置/层级/交互的底线写在行内（不依赖那张样式表）',
    bottomState !== null && bottomState.inline === 'fixed' && bottomState.computed === 'fixed'
      && bottomState.z === '2147483000' && bottomState.hit === 'auto',
    JSON.stringify(bottomState))

  // 模拟主题重写 <head>：把 client.js 注入的那张样式表删掉，她必须自己补回来
  await ev('(() => { const s = document.getElementById("dsh-live2d-pet-style"); if (s !== null) s.remove(); return true })()')
  const healed = await until(async () => {
    const raw = await ev('JSON.stringify(window.__dshLive2dPetHalo.diag ? window.__dshLive2dPetHalo.diag() : null)')
    if (raw === undefined || raw === null) return undefined
    const diag = JSON.parse(raw)
    return diag.styleTag === true && diag.styleRescues >= 1 ? raw : undefined
  }, 8000, '样式自愈')
  const healedState = healed === undefined ? null : JSON.parse(healed)
  record('样式表被主题删掉后能自己补回来', healedState !== null && healedState.styleTag === true,
    JSON.stringify(healedState))
  record('自愈之后位置仍然是 fixed（没有退化成普通块）',
    healedState !== null && healedState.petPosition === 'fixed' && healedState.petZIndex === '2147483000',
    JSON.stringify(healedState))

  // ---- 7. Swup 式软导航：根还在但画布被换掉 ⇒ 画布 watchdog 重建 ----
  //
  // 真站（主题 Ethereal + Swup）实测：导航后宠物根还在，`canvas` 一度消失 ⇒ 只盯
  // "根在不在"的自愈不会动它，她就一直没画布。这里把那个状态原样造出来。
  await ev('(() => { const c = document.querySelector("[data-dsh-live2d-pet] canvas"); if (c !== null) c.remove(); return true })()')
  const canvasBack = await until(
    async () => await ev('document.querySelector("[data-dsh-live2d-pet] canvas") !== null'),
    18000, '画布重建',
  )
  record('画布被软导航换掉后会重建（canvas-watchdog）', canvasBack === true)

  // ---- 8. 软导航（主题把整块换掉）后自己挂回来 ----
  // 移除的是**容器**（`data-dsh-live2d-pet-root`，主题替换 DOM 时消失的就是它），
  // 而不是 React 自己管的那个内层根 —— 后者被外部删掉时 React 会报 removeChild，
  // 那是"测试把人家的节点偷走了"，不是产品行为。
  await ev('document.querySelector("[data-dsh-live2d-pet-root]").remove()')
  const remounted = await until(
    async () => await ev('document.querySelector("[data-dsh-live2d-pet] canvas") !== null'),
    8000, '重挂',
  )
  const after = JSON.parse(await ev('JSON.stringify(window.__dshLive2dPetHalo ?? null)') ?? 'null')
  record('容器被移除后能自己重新挂载', remounted === true && (after?.appliedCount ?? 0) >= 2,
    'appliedCount=' + (after?.appliedCount ?? '?'))

  console.log('\n页面 console（前 8 条）：' + JSON.stringify(pageLogs.slice(0, 8)))
  const failed = results.filter((r) => !r.pass)
  console.log('\nHALO ' + (results.length - failed.length) + '/' + results.length + ' 通过（端口 ' + PORT + '）')
  exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  console.error('driver 自身出错：' + (error && error.stack ? error.stack : error))
  exitCode = 1
} finally {
  try { ws?.close() } catch { /* 已经关了 */ }
  killBrowser(browser)
}
process.exit(exitCode)
