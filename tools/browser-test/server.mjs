// Verification server: mounts the plugin's REAL route table on a plain node
// http server, plus a minimal page that stands in for the DSH shell (React UMD
// + a fake __ModuleLoader__). Nothing here ships; it exists so the plugin can
// be driven end-to-end from a headless browser.
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HERE, PLUGIN, PROFILES, ROOT } from './paths.mjs'

const PORT = Number(process.argv[2] ?? 8793)

// Load the plugin's host half straight from source, so the server always tests
// the working tree rather than a copy.
const host = await import(pathToFileURL(join(PLUGIN, 'lib', 'index.js')).href)
const { buildRoutes, ActivityHub, attachActivityEvents } = host

// The harness stands in for the DSH host, so it owns the activity hub too.
//
// It supplies a REAL (if tiny) event bus rather than a no-op ctx. That matters:
// with a stub, attachActivityEvents registered nothing and every phase test had
// to drive the hub through /__nudge, so the plugin's actual host-event wiring
// was never exercised — which is how a subscription to the non-existent
// 'tool/call' event survived a green suite while the pet ignored tool activity
// in the real DSH. The bus below lets /__emit fire the genuine event names.
const listeners = new Map()
const bus = {
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => {
      const list = listeners.get(event) ?? []
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  },
}
const emit = async (event, ...args) => {
  const out = []
  for (const handler of listeners.get(event) ?? []) out.push(await handler(...args))
  return out
}

const hub = new ActivityHub()
attachActivityEvents(bus, hub)

// 显示层路由也要挂上：客户端每秒问一次 `/api/live2d-pet/layer`，而**没有路由的 harness
// 会让它 404**，于是 `cdp-exp` 那条"没有失败的插件请求"断言会红（实测 5 个 404）。
// 用**真的** `createDisplayLayer`（不是假响应）：这样"设置页读到的显示层状态"走的也是
// 产品代码，顺手把 `/layer` 这条链在宿主侧也验了。
//
// home 指向一个可丢弃目录：绝不能让它读写用户真正的 `%DSH_HOME%\pet-desktop.json`。
const { createDisplayLayer } = await import(pathToFileURL(join(PLUGIN, 'lib', 'display.js')).href)
const displayHome = join(PROFILES, '_layer-home')
mkdirSync(displayHome, { recursive: true })
const displayLayer = createDisplayLayer({
  home: displayHome,
  hint: 'harness: 没有桌面端二进制',
  resolveBinary: () => undefined,
  log: () => {},
})
displayLayer.binaryInfo = () => ({ found: false, path: null, source: null, supported: true, hint: 'harness' })

// 共享设置也挂上：driver 要能验证"宿主是权威、另一个窗口改了会同步过来"。
// home 用同一个可丢弃目录 —— 绝不能碰用户真正的 `%DSH_HOME%\pet-settings.json`。
const routes = buildRoutes(hub, displayLayer, displayHome)
const byPath = new Map(routes.filter((r) => r.kind === 'exact').map((r) => [r.path, r]))
const prefixes = routes.filter((r) => r.kind === 'prefix').sort((a, b) => b.path.length - a.path.length)

// ------------------------------------------------------- Halo 静态托管（模拟）

/**
 * 生成好的 Halo 插件静态目录（`tools/build-halo-plugin.mjs` 的产物）。
 *
 * 公开前缀**带版本号**（`/plugins/whale-pet-live2d/assets/v<版本>`），而且它写在生成物
 * `pet-base.properties` 里 —— 这里直接读那个文件，测试就不会和生成器脱节。
 */
const HALO_PET_DIR = join(ROOT, 'halo-plugin', 'src', 'main', 'resources', 'pet')
const HALO_BASE = (() => {
  try {
    const text = readFileSync(join(ROOT, 'halo-plugin', 'src', 'main', 'resources', 'pet-base.properties'), 'utf8')
    const hit = /^\s*base\s*=\s*(\S+)\s*$/m.exec(text)
    if (hit !== null) return hit[1].replace(/\/+$/, '')
  } catch { /* 没生成过就退回不带版本的老路径 */ }
  return '/plugins/whale-pet-live2d/assets/pet'
})()
const HALO_ASSET_PREFIX = HALO_BASE + '/'
const HALO_MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  // 未知扩展（`.moc3`、以及没有扩展名的 `catalog`）就是二进制流 —— 引擎与
  // `response.json()` 都不看 Content-Type，正好顺便把"没扩展名也能取到"这条验了。
}
/** Cubism Core 的服务端缓存：浏览器侧从 `/halo-core/...` 取，不碰外网。 */
const HALO_CORE_CACHE = join(PROFILES, '_halo-core', 'live2dcubismcore.min.js')
const CORE_CDN = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

function serveHaloAsset(pathname, res) {
  let rel
  try {
    rel = pathname.slice(HALO_ASSET_PREFIX.length).split('/').map(decodeURIComponent).join('/')
  } catch {
    res.writeHead(400); res.end('bad path'); return
  }
  const file = resolve(HALO_PET_DIR, rel)
  // 目录穿越的第二层：解析后的路径必须还在静态根里面。
  if (file !== HALO_PET_DIR && !file.startsWith(HALO_PET_DIR + sep)) {
    res.writeHead(403); res.end('forbidden'); return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); res.end('missing ' + rel); return
  }
  res.writeHead(200, {
    'content-type': HALO_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(readFileSync(file))
}

/**
 * Cubism Core：**不随插件分发**（见 LICENSES.md），所以产物里没有它。
 *
 * 测试也不该依赖外网：先看本机 `$DSH_HOME/pets/.runtime/` 有没有（DSH 那边本来就
 * 让用户放这儿），没有再从官方 CDN 取一次并缓存。**取的动作在服务端** —— 浏览器侧
 * 始终只访问 127.0.0.1，这样 driver 那条"整页没有外部请求"的断言才成立。
 */
async function serveCubismCore(res) {
  const local = [
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'pets', '.runtime', 'live2dcubismcore.min.js'),
    HALO_CORE_CACHE,
  ]
  let file = local.find((candidate) => {
    try { return existsSync(candidate) && statSync(candidate).size > 10000 } catch { return false }
  })
  if (file === undefined) {
    try {
      const upstream = await fetch(CORE_CDN, { redirect: 'follow' })
      if (!upstream.ok) throw new Error('HTTP ' + upstream.status)
      const bytes = Buffer.from(await upstream.arrayBuffer())
      if (!bytes.includes('Live2DCubismCore')) throw new Error('unexpected payload')
      mkdirSync(dirname(HALO_CORE_CACHE), { recursive: true })
      writeFileSync(HALO_CORE_CACHE, bytes)
      file = HALO_CORE_CACHE
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('cubism core unavailable: ' + String(error?.message ?? error))
      return
    }
  }
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const pathname = url.pathname

  // A/B/C renderer comparison: ?variant=X swaps which client bundle the page
  // loads, so one checkout can exercise several builds.
  if (pathname === '/' || pathname === '/blank') {
    const variant = url.searchParams.get('variant')
    let page = readFileSync(join(HERE, 'index.html'), 'utf8')
    if (variant) page = page.replace('/plugins/dsh-pet-live2d/client.js', '/variants/client-' + variant + '.js')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
    return
  }
  if (pathname === '/harness.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(readFileSync(join(HERE, 'harness.js')))
    return
  }
  if (pathname === '/react.js' || pathname === '/react-dom.js') {
    // 先看 harness 自己的 node_modules（`npm install` 得到的那份，和 CI 一致）；
    // 拿不到就回落到仓库里 vendored 的同一版本 —— 有些环境里 npm 装不了包
    // （`EALLOWREMOTE: Fetching packages of type "remote" have been disabled`），
    // 而这里一旦 500，宠物整个不启动，症状是**一整套 driver 全红**且离根因很远。
    const name = pathname === '/react.js' ? 'react.development.js' : 'react-dom.development.js'
    const pkg = pathname === '/react.js' ? 'react' : 'react-dom'
    const candidates = [
      join(HERE, 'node_modules', pkg, 'umd', name),
      join(ROOT, 'vendor', 'react', '18.3.1', name),
    ]
    const file = candidates.find((candidate) => existsSync(candidate))
    if (file === undefined) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('missing React UMD; tried:\n' + candidates.join('\n')
        + '\n-- run `npm install` in tools/browser-test, or restore vendor/react/18.3.1/.')
      return
    }
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(readFileSync(file))
    return
  }
  // 和真实的 DSH 一样按**包名**寻址：/plugins/<包名>/client.js
  if (pathname === '/plugins/dsh-pet-live2d/client.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' })
    res.end(readFileSync(join(PLUGIN, 'lib', 'client.js')))
    return
  }
  if (pathname === '/index-before.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(readFileSync(join(HERE, 'index-before.html')))
    return
  }
  if (pathname.startsWith('/variants/')) {
    // The DBG variant is generated HERE, from the live client source, on every
    // request.
    //
    // It used to be a file on disk rebuilt by the suite runner, which meant any
    // driver run directly (or before the runner got to it) loaded a copy from
    // whenever it was last generated — and silently tested yesterday's code.
    // That trap has now cost two debugging sessions; generating it removes the
    // possibility rather than documenting it.
    if (pathname === '/variants/client-DBG.js') {
      const ANCHOR = '        model = loaded;\n        modelRef.current = loaded;'
      const HOOK = [
        '',
        '        if (typeof window !== "undefined") {',
        '          window.__PET_DBG = {',
        '            app,',
        '            get model() { return app.stage.children.find((c) => c.internalModel !== undefined) ?? null; },',
        '            get core() { const m = app.stage.children.find((c) => c.internalModel !== undefined); return m ? m.internalModel.coreModel : null; },',
        '          };',
        '        }',
      ].join('\n')
      const source = readFileSync(join(PLUGIN, 'lib', 'client.js'), 'utf8')
      if (!source.includes(ANCHOR)) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('client.js: variant anchor not found')
        return
      }
      res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' })
      res.end(source.replace(ANCHOR, ANCHOR + HOOK))
      return
    }
    const file = join(HERE, pathname.slice(1))
    if (!existsSync(file)) { res.writeHead(404); res.end('missing ' + file); return }
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(readFileSync(file))
    return
  }
  if (pathname === '/__nudge') {
    const phase = url.searchParams.get('phase') || 'idle'
    if (phase === 'done') hub.celebrate()
    else hub.set(phase, '')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(hub.snapshot().phase)
    return
  }

  // Fire a REAL DSH lifecycle event through the bus, so the plugin's own
  // subscriptions are what the assertions observe. Waterfall events get a
  // trailing next() so a handler that resumes the chain can be detected.
  if (pathname === '/__emit') {
    const event = url.searchParams.get('event') || ''
    const name = url.searchParams.get('name') || ''
    let resumed = false
    // 链 resume 的那一刻宠物在演什么。waterfall 型的事件（提问、写文件）**整个挂在链上**，
    // 等 handler 返回时相位早回落了 —— 不在这里当场记一笔，`asking` 根本观测不到。
    let phaseAtNext = null
    const next = async () => { resumed = true; phaseAtNext = hub.snapshot().phase; return { kind: 'accept' } }
    const payload = event.startsWith('tools/')
      ? { name, callId: 'test-call', parent: undefined }
      : { status: name, agent: {} }
    const seen = listeners.get(event)
    const handlers = seen ?? []
    for (const handler of handlers) {
      try { await handler(payload, next) } catch (error) { console.error('emit ' + event + ': ' + error) }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      event, handlers: handlers.length, resumed, phaseAtNext, phase: hub.snapshot().phase,
    }))
    return
  }

  // ---------------- Halo 静态托管（模拟 ReverseProxy）----------------
  //
  // 这一段**故意不落任何 `/api/live2d-pet/*`**：Halo 那边也没有那些路由。页面
  // （`/halo`）用一个带 `data-config` 的 `<script>` 启动 `pet-shim.js`，配置指向这个
  // 静态目录；driver 会断言"整页没有一次 /api/live2d-pet 请求"。
  if (pathname === '/halo') {
    // 版本化前缀写进页面里（和插件注进去的 data-config 一样），测试就不会和生成器脱节。
    const page = readFileSync(join(HERE, 'halo.html'), 'utf8').replaceAll('__PET_BASE__', HALO_BASE)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
    return
  }
  if (pathname === '/halo-core/live2dcubismcore.min.js') {
    await serveCubismCore(res)
    return
  }
  if (pathname.startsWith(HALO_ASSET_PREFIX)) {
    serveHaloAsset(pathname, res)
    return
  }

  const exact = byPath.get(pathname)
  if (exact !== undefined) { exact.handler(req, res); return }
  for (const route of prefixes) {
    if (pathname === route.path || pathname.startsWith(route.path + '/')) { route.handler(req, res); return }
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('no route: ' + pathname)
})

server.listen(PORT, '127.0.0.1', () => console.log('test server on http://127.0.0.1:' + PORT))
