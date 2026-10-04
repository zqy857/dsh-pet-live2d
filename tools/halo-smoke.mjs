// 真 Halo 冒烟测试：把插件装进**一个真跑着的 Halo**，然后在真主题页面上验她能不能起来。
//
// 为什么必须有这一条 —— 静态托管那两条驱动（`cdp-halo` / `test-halo-tree`）验的是
// "产物是对的、无宿主模式能跑"，它们**验不到 Halo 运行时**：
//
//   * `plugin.yaml` / `Setting` / `ReverseProxy` 能不能被 Halo 接受（settingName 不匹配 = 插件启动失败）；
//   * `TemplateHeadProcessor` 注入的标签在真主题页里长什么样；
//   * 属性值里的双引号有没有转义（**这条只有真浏览器能发现**：服务端返回 200、
//     日志一句话都没有，而 HTML 在第一个内层引号处就断了，桌宠永远不启动）。
//
// 它不启动 Halo 自己 —— Halo 怎么起（H2 / MySQL / 反代）是环境的事。用法：
//
//   node tools/halo-smoke.mjs \
//     --base http://127.0.0.1:8099 \
//     --jar halo-plugin/build/libs/whale-pet-live2d-0.1.0.jar \
//     --user admin --pass admin12345
//
// 前置（本地跑一遍的最短路径）：
//   java -jar halo.jar --halo.work-dir=/tmp/halo --server.port=8099 \
//        --halo.external-url=http://127.0.0.1:8099 --halo.security.basic-auth.disabled=false
//   curl -X POST <base>/system/setup -d 'username=admin&password=admin12345&siteTitle=t&language=zh-CN&externalUrl=<base>'
//
// 退出码：0 = 全绿；1 = 有断言没通过（含插件启动失败、注入标签不存在、页面里她没起来）。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const BASE = (arg('base', 'http://127.0.0.1:8099')).replace(/\/+$/, '')
const JAR = resolve(arg('jar', 'halo-plugin/build/libs/whale-pet-live2d-0.1.0.jar'))
const USER = arg('user', 'admin')
const PASS = arg('pass', 'admin12345')
const BROWSER = arg('browser', '/usr/bin/google-chrome-stable')
const CDP_PORT = Number(arg('port', '9455'))
/** 插件名：ReverseProxy 与静态资源都挂在它下面（具体前缀带版本号，从页面配置里读）。 */
const PLUGIN = 'whale-pet-live2d'

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass || detail === undefined ? '' : ' — ' + detail))
}
const auth = 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64')
const api = (path, init = {}) => fetch(BASE + path, {
  ...init,
  headers: { authorization: auth, ...(init.headers ?? {}) },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ 1. 装 + 起

if (!existsSync(JAR)) {
  console.error('找不到插件 jar：' + JAR)
  process.exit(1)
}
console.log('目标 Halo：' + BASE + '，jar：' + basename(JAR))

// 先卸掉上一份：同一个版本号重复 install 时，Halo 可能保留原来已经加载的那份
// （症状是"我明明重建了 jar，页面里跑的还是旧代码"）。删除资源 = 卸载，等它消失再装。
const existing = await api(`/apis/plugin.halo.run/v1alpha1/plugins/${PLUGIN}`)
if (existing.status === 200) {
  const removed = await api(`/apis/plugin.halo.run/v1alpha1/plugins/${PLUGIN}`, { method: 'DELETE' })
  if (removed.status >= 400) console.log('  （卸载返回 HTTP ' + removed.status + '，继续尝试安装）')
  for (let i = 0; i < 40; i++) {
    const res = await api(`/apis/plugin.halo.run/v1alpha1/plugins/${PLUGIN}`)
    if (res.status === 404) break
    await sleep(500)
  }
}

const installForm = new FormData()
installForm.append('file', new Blob([await (await import('node:fs/promises')).readFile(JAR)]), basename(JAR))
const install = await api(`/apis/api.console.halo.run/v1alpha1/plugins/install`, { method: 'POST', body: installForm })
check('插件安装接口返回 200', install.status === 200, 'HTTP ' + install.status + ' ' + (await install.text()).slice(0, 200))

const enable = await api(`/apis/api.console.halo.run/v1alpha1/plugins/${PLUGIN}/plugin-state`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enable: true }),
})
check('启用接口返回 200', enable.status === 200, 'HTTP ' + enable.status)

let phase = null
let conditions = []
for (let i = 0; i < 40; i++) {
  const res = await api(`/apis/plugin.halo.run/v1alpha1/plugins/${PLUGIN}`)
  if (res.ok) {
    const body = await res.json()
    phase = body?.status?.phase ?? null
    conditions = body?.status?.conditions ?? []
    if (phase === 'STARTED' || phase === 'FAILED') break
  }
  await sleep(500)
}
check('插件在真 Halo 里 STARTED（Setting 名字/清单/ReverseProxy 都被接受）', phase === 'STARTED',
  'phase=' + String(phase) + ' ' + conditions.map((c) => c.type + '=' + c.status + ':' + (c.message ?? '')).join(' | '))

// ------------------------------------------------------------ 2. 注入的标签

const html = await (await fetch(BASE + '/')).text()
const tag = /<script[^>]*pet-shim\.js[^>]*>/.exec(html)?.[0] ?? null
check('主题页 <head> 里注入了 pet-shim.js', tag !== null, '首页里没找到那个 script 标签')
check('加载脚本带 defer（不阻塞主题）', tag !== null && /defer/.test(tag), tag ?? '')
// 配置走 `<script type="application/json" id="…">{…}</script>` 的**标签体**：
// 于是"属性值转义"这一整类问题（`"` 必须换成 `&quot;`、少一个属性就断）从结构上消失。
const configBlock = new RegExp(
  '<script[^>]*type="application/json"[^>]*id="' + PLUGIN + '-config"[^>]*>([\\s\\S]*?)</script>').exec(html)
let parsedConfig = null
try { parsedConfig = configBlock === null ? null : JSON.parse(configBlock[1]) } catch { parsedConfig = null }
check('配置块是合法 JSON（application/json 标签体，不需要属性转义）',
  parsedConfig !== null && typeof parsedConfig.base === 'string',
  '配置块=' + String(configBlock?.[1]).slice(0, 120))
// **自闭合的 <script/> 是致命的**：HTML 里 script 不是自闭合元素，解析器会把后面的一切
// （`</head>`、`<body class=…>`、主题自己的 div 与内联脚本）当成脚本文本吞到下一个
// `</script>`。真站（主题 Ethereal）上就是这么把 banner 配置吞掉的 —— 服务端 200、
// 日志一句没有，只有把源 HTML 和 DOM 对起来才看得见。
check('注入的 <script> 是完整闭合的（不是 <script .../>）',
  tag !== null && !/\/>$/.test(tag.trim()) && html.includes(tag + '</script>'),
  tag ?? '')
// 静态前缀**带版本号**（Halo 的静态资源缓存是一年，版本进路径才能让升级生效）——
// 从配置块里读，别在这写死。
check('配置里的静态前缀带版本号（升级即换 URL）',
  parsedConfig !== null && /^\/plugins\/whale-pet-live2d\/assets\/v[^/]+$/.test(parsedConfig.base ?? ''),
  String(parsedConfig?.base))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
// 审核要求 plugin.yaml 的 logo 正确设置 —— 顺手在真站点上验它真的取得到。
// （固定路径，不带版本号：升级不会把图标变成死链。）
const pluginYaml = readFileSync(join(REPO_ROOT, 'halo-plugin', 'src', 'main', 'resources', 'plugin.yaml'), 'utf8')
const logoValue = (/^\s*logo:\s*"?([^"\s]+)"?\s*$/m.exec(pluginYaml)?.[1] ?? '')
// logo 是相对 src/main/resources 的路径时，控制台要的是插件资源路由下的同一个资源。
const logoUrl = logoValue.startsWith('http') ? logoValue
  : logoValue.startsWith('/') ? logoValue
    : `/plugins/${PLUGIN}/assets/${logoValue}`
check('插件图标可取（plugin.yaml 的 logo 能通过插件资源路由取到）', await (async () => {
  const res = await fetch(BASE + logoUrl)
  if (!res.ok) { console.log('  ' + res.status + ' ' + logoUrl); return false }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('image')) { console.log('  content-type=' + type); return false }
  return true
})())

const ASSET_BASE = parsedConfig?.base ?? `/plugins/${PLUGIN}/assets/pet`
check('静态资源全部可达（ReverseProxy 规则生效）', await (async () => {
  for (const path of [`${ASSET_BASE}/catalog`, `${ASSET_BASE}/pet-shim.js`, `${ASSET_BASE}/live2d-vendor.js`,
    `${ASSET_BASE}/pets/ds-whale-girl/c_0120.model3.json`]) {
    const res = await fetch(BASE + path)
    if (!res.ok) { console.log('  ' + res.status + ' ' + path); return false }
  }
  return true
})())

// ------------------------------------------------------------ 3. 真浏览器里她起没起来

const profile = mkdtempSync(join(tmpdir(), 'halo-smoke-'))
const browser = spawn(BROWSER, ['--headless=new', '--remote-debugging-port=' + CDP_PORT,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'],
{ stdio: 'ignore' })

const basicAuthHeader = 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64')

let ws = null
try {
  let target
  for (let i = 0; i < 120 && target === undefined; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* 还没起来 */ }
    if (target === undefined) await sleep(250)
  }
  if (target === undefined) throw new Error('调试端口没起来')

  ws = new WebSocket(target.webSocketDebuggerUrl)
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
    if (message.method === 'Runtime.exceptionThrown') {
      pageLogs.push('EXCEPTION: ' + (message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text))
    }
    // 控制台要登录：给同源请求补一个 Authorization 头（本机 Halo 开着 basic auth）。
    if (message.method === 'Fetch.requestPaused') {
      const headers = Object.entries(message.params.request.headers ?? {})
        .filter(([name]) => name.toLowerCase() !== 'authorization')
        .map(([name, value]) => ({ name, value }))
      headers.push({ name: 'Authorization', value: basicAuthHeader })
      void send('Fetch.continueRequest', { requestId: message.params.requestId, headers })
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.result?.exceptionDetails !== undefined) return undefined
    return message.result?.result?.value
  }
  const until = async (probe, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await probe()
      if (value) return value
      if (Date.now() > deadline) { console.log('  （超时：' + label + '）'); return undefined }
      await sleep(150)
    }
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Page.navigate', { url: BASE + '/' })

  const boot = await until(async () => {
    const raw = await evaluate('window.__dshLive2dPetBoot ? JSON.stringify(window.__dshLive2dPetBoot) : ""')
    if (raw === '' || raw === undefined) return undefined
    const state = JSON.parse(raw)
    return state.ok === true || state.error !== null ? raw : undefined
  }, 60000, 'pet-shim 启动')
  const bootState = boot === undefined ? null : JSON.parse(boot)
  check('真主题页面上 pet-shim 启动成功', bootState?.ok === true && bootState?.error === null,
    bootState === null ? '没等到 __dshLive2dPetBoot' : ('stage=' + bootState.stage + ' error=' + bootState.error))
  check('data-config 没走兜底（属性原样解析成功）', bootState?.configRecovered !== true,
    JSON.stringify(bootState?.config ?? null))

  // 源 HTML 里 <body> 上的属性必须一个不少地出现在 DOM 上 —— 这是"我们的标签有没有
  // 吞掉主题标记"的**通用探针**（不依赖任何具体主题）。主题 Ethereal 那次报障里，
  // `<body class="… enable-banner …" style="--bannerOffset:…">` 整个被吞了。
  const bodyAttrsInSource = (() => {
    const m = /<body([^>]*)>/i.exec(html)
    if (m === null) return []
    return [...m[1].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=/g)].map((x) => x[1])
  })()
  const domBodyAttrs = JSON.parse(await evaluate('JSON.stringify([...document.body.attributes].map((a) => a.name))') ?? '[]')
  const swallowed = bodyAttrsInSource.filter((name) => !domBodyAttrs.includes(name))
  const domBodyChildren = await evaluate('document.body.children.length')
  // 有的主题就是 `<body>`（一个属性都没有），那时"属性比对"无从谈起 —— 改成两条：
  // ① 源里有的属性必须一个不少地活到 DOM 上；② body 里必须真有内容（主题标记没被吞）。
  check('主题标记没有被吞（<body> 属性齐全、body 里有内容）',
    swallowed.length === 0 && Number(domBodyChildren) > 0,
    '源=[' + bodyAttrsInSource.join(',') + '] DOM=[' + domBodyAttrs.join(',') + '] 缺=[' + swallowed.join(',')
      + '] bodyChildren=' + String(domBodyChildren))

  const canvas = await until(async () => await evaluate('document.querySelector("[data-dsh-live2d-pet] canvas") !== null'), 60000, 'canvas')
  check('Live2D canvas 在真站点上渲染出来', canvas === true)
  const mask = await until(async () => await evaluate(
    '!!(window.__dshLive2dPet && window.__dshLive2dPet.maskInfo && window.__dshLive2dPet.maskInfo().present)'), 40000, '命中遮罩')
  check('贴图/几何到位（命中遮罩采样成立）', mask === true)

  const apiHits = responses.filter((r) => r.url.includes('/api/live2d-pet'))
  check('整页没有一次 /api/live2d-pet 请求', apiHits.length === 0, apiHits.slice(0, 3).map((r) => r.url).join(', '))
  // 只对**我们自己的资源**断言"没有失败"：主题自带的 CDN/图片 404 与我们无关，
  // 把它们算成失败会让这条检查在不同主题上失真（社区主题里 404 很常见）。
  const failing = responses.filter((r) => r.status >= 400 && r.url.startsWith(BASE) && !r.url.endsWith('/favicon.ico'))
  const ours = failing.filter((r) => r.url.includes(`/plugins/${PLUGIN}/assets/`))
  const theirs = failing.filter((r) => !r.url.includes(`/plugins/${PLUGIN}/assets/`))
  check('我们自己的静态资源没有一个失败', ours.length === 0,
    ours.slice(0, 5).map((r) => r.status + ' ' + r.url.replace(BASE, '')).join(', '))
  if (theirs.length > 0) {
    console.log('  （主题自己的失败请求，与插件无关：'
      + theirs.slice(0, 4).map((r) => r.status + ' ' + r.url.replace(BASE, '')).join(', ') + '）')
  }

  // 相位：页面事件（评论框聚焦）与公开入口都要能让她换动作
  const haloState = JSON.parse(await evaluate('JSON.stringify(window.__dshLive2dPetHalo ?? null)') ?? 'null')
  check('pet-halo 在真站点上 apply 成功', haloState?.applied === true, JSON.stringify(haloState))

  // 右键面板：真主题页上 pointer-events / z-index 都可能跟主题打架，这一条必须实测
  const opened = await evaluate('(() => {'
    + ' const h = document.querySelector("[data-dsh-live2d-pet] [data-hit]")'
    + '   || document.querySelector("[data-dsh-live2d-pet] [data-stage]");'
    + ' if (!h) return false;'
    + ' h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));'
    + ' return true })()')
  const panel = await until(async () => await evaluate('document.querySelector("[data-dsh-live2d-pet] [data-panel]") !== null'), 5000, '右键面板')
  check('真站点上右键能呼出面板（主题的 pointer-events/z-index 没挡住她）', opened === true && panel === true)

  // 挂载点不许影响主题自己的布局：把容器摘掉，主题原有子元素的盒子必须**一个像素都不动**。
  // 这一条直接对应"顶部 banner 坏掉"那类报障（body 是 flex/grid 的主题里多占一个格位）。
  const layout = await evaluate(`(() => {
    const key = (el) => el.tagName + '#' + el.id + '.' + [...el.classList].join('.');
    const list = () => [...document.body.children]
      .filter((el) => !el.hasAttribute('data-dsh-live2d-pet-root') && el.tagName !== 'SCRIPT')
      .map((el) => { const r = el.getBoundingClientRect(); return key(el) + ':' + [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','); });
    const before = list();
    const container = document.querySelector('[data-dsh-live2d-pet-root]');
    if (container === null) return JSON.stringify({ error: '找不到挂载点' });
    // getComputedStyle 返回的是**活对象**：元素一摘掉，再读就是空字符串。必须先取值快照。
    const cs = getComputedStyle(container);
    const snapshot = { position: cs.position, size: [container.offsetWidth, container.offsetHeight] };
    container.remove();
    const after = list();
    return JSON.stringify({
      same: JSON.stringify(before) === JSON.stringify(after),
      before, after, containerPosition: snapshot.position, containerSize: snapshot.size,
    });
  })()`)
  const layoutState = layout === undefined || layout === null ? null : JSON.parse(layout)
  check('摘掉我们的挂载点，主题原有布局一个像素都不动（不会顶坏 banner）',
    layoutState?.same === true && layoutState?.containerPosition === 'fixed'
      && JSON.stringify(layoutState?.containerSize) === '[0,0]',
    'container=' + String(layoutState?.containerPosition) + String(JSON.stringify(layoutState?.containerSize))
      + ' before=' + JSON.stringify(layoutState?.before) + ' after=' + JSON.stringify(layoutState?.after))
  // 摘掉之后她应该自己回来（这也顺带再验一次自愈）
  const backAfterRemove = await until(async () =>
    await evaluate('document.querySelector("[data-dsh-live2d-pet] canvas") !== null'), 12000, '摘掉容器后自己挂回来')
  check('挂载点被摘掉后她能自己回来', backAfterRemove === true)

  // 主题重写 <head>：样式表被删掉时必须自己补回来（"跑到左上角/躲到后面"那条的根因）
  const healed = await evaluate(`(() => {
    const s = document.getElementById('dsh-live2d-pet-style');
    if (s === null) return JSON.stringify({ error: '样式表本来就不在' });
    s.remove();
    return JSON.stringify({ removed: true });
  })()`)
  const healedState = await until(async () => {
    const raw = await evaluate('JSON.stringify(window.__dshLive2dPetHalo.diag ? window.__dshLive2dPetHalo.diag() : null)')
    if (raw === undefined || raw === null) return undefined
    const diag = JSON.parse(raw)
    return diag.styleTag === true && diag.styleRescues >= 1 ? raw : undefined
  }, 10000, '样式自愈')
  const diagState = healedState === undefined ? null : JSON.parse(healedState)
  check('主题删掉样式表后能自己补回来，且位置仍是 fixed',
    healed !== undefined && diagState?.styleTag === true && diagState?.petPosition === 'fixed',
    JSON.stringify(diagState))

  const readPhase = async () => await evaluate(
    '(() => { const el = document.querySelector("[data-dsh-live2d-pet]"); return el === null ? null : el.getAttribute("data-phase") })()')
  await evaluate('window.__dshLive2dPet.setFidgetEnabled && window.__dshLive2dPet.setFidgetEnabled(false)')
  await evaluate('window.__haloPetPhase && window.__haloPetPhase("done")')
  const donePhase = await until(async () => (await readPhase()) === 'done' ? true : undefined, 6000, 'phase=done')
  const doneMotion = await until(async () => await evaluate(
    '(() => { const el = document.querySelector("[data-dsh-live2d-pet]"); return el && el.getAttribute("data-motion") === "BubbleGum" })()'), 8000, 'motion=BubbleGum')
  check('真站点上 phaseNow("done") 换到了宠物声明的动作', donePhase === true && doneMotion === true)

  // —— 控制台里的插件图标 ——
  // 这条是补漏：`spec.logo` 写错时插件照样能装能跑，**只有控制台看得见**（Halo 找不到图标就
  // 回退成显示插件名首字，用户看到的是一个「鲸」字）。所以必须用真的控制台页面来验，
  // 光验"图标 URL 返回 200"不够 —— 前者曾经就是这么漏过去的。
  // 控制台要登录：本机 Halo 开着 basic auth，所以用 CDP 的 Fetch 域给同源请求加 Authorization 头。
  await send('Fetch.enable', { patterns: [{ urlPattern: BASE + '/*', requestStage: 'Request' }] })
  // 注意：Halo 控制台是 **history 路由**（`/console/plugins`），
  // 用 `location.hash = '#/plugins'` 会停在仪表盘 —— 曾经因此拿到过假阳性。
  await send('Page.navigate', { url: BASE + '/console/plugins' })
  await until(async () => await evaluate('document.querySelectorAll("img").length > 0'),
    30000, '控制台插件列表')
  const consoleProbe = `(() => {
    const imgs = [...document.querySelectorAll('img')].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth }))
    return JSON.stringify({ imgs, url: location.href, text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160) })
  })()`
  // **必须是我们插件的图标**：src 里带 /plugins/<插件名>/assets/ 且 naturalWidth > 0。
  // （只匹配 /logo/i 会撞上控制台自己的 logo —— 这么写曾经假阳性过一次。）
  const ourIconRaw = await until(async () => {
    const raw = await evaluate(consoleProbe)
    if (raw === undefined || raw === null) return undefined
    const state = JSON.parse(raw)
    return (state.imgs ?? []).some((i) => i.src.includes(`/plugins/${PLUGIN}/assets/`) && i.w > 0) ? raw : undefined
  }, 45000, '控制台里我们插件的图标')
  const consoleState = ourIconRaw === undefined ? null : JSON.parse(ourIconRaw)
  const ourIcon = (consoleState?.imgs ?? []).filter((i) => i.src.includes(`/plugins/${PLUGIN}/assets/`))
  check('控制台里插件图标真的加载出来（不是名字首字兜底）', ourIcon.length > 0 && ourIcon.every((i) => i.w > 0),
    ourIconRaw === undefined
      ? '控制台没加载我们的图标；页面文本=' + JSON.stringify(await evaluate('document.body.innerText.replace(/\\s+/g, " ").slice(0, 160)'))
      : JSON.stringify(ourIcon))
  await send('Fetch.disable')

  console.log('\n页面异常（前 5 条）：' + JSON.stringify(pageLogs.slice(0, 5)))
} finally {
  try { ws?.close() } catch { /* 已经关了 */ }
  browser.kill()
  // 浏览器可能还在往 profile 里写（刚 kill 掉也不保证立刻停），删不掉就算了 ——
  // 这是临时目录，不能让它把真正的结论（退出码）冲掉。
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 留给系统清 */ }
}

const failed = results.filter((r) => !r.pass)
console.log('\nHALO-SMOKE ' + (results.length - failed.length) + '/' + results.length + ' 通过')
process.exit(failed.length === 0 ? 0 : 1)
