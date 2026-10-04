// Halo 插件的静态产物自检（纯 node，不需要浏览器）。
//
// 与 `tools/build-halo-plugin.mjs --check` 的分工：
//   * 生成器自检的是"我这次生成的对不对"（源 ↔ 产物的关系）；
//   * 这条测试自检的是"**仓库里现在这一份**能不能在 Halo 上跑起来" ——
//     它**独立**重新读 catalog、model3.json、plugin.yaml、ReverseProxy 与 Setting，
//     不复用生成器的判断，所以两处不会一起错。
//
// 它挡的是几类"跑起来才发现"的错：模型引用的贴图/动作少一个、catalog 指向不存在的
// 文件、产物里混进了 Cubism Core、`plugin.yaml` 的名字与 ReverseProxy 的路径对不上、
// 以及**设置了 settingName 却没有同名 Setting 资源**（Halo 会直接让插件启动失败）。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const HALO = join(ROOT, 'halo-plugin')
const PET = join(HALO, 'src', 'main', 'resources', 'pet')
const PLUGIN_NAME = 'whale-pet-live2d'
/**
 * 静态资源的公开前缀**带版本号**（生成器写在 `pet-base.properties` 里，同时与
 * ReverseProxy 规则、catalog 的 URL 三处互证）。这里独立读一遍，不跟着生成器的变量走。
 */
const ASSET_BASE = (() => {
  try {
    const text = readFileSync(join(HALO, 'src', 'main', 'resources', 'pet-base.properties'), 'utf8')
    const hit = /^\s*base\s*=\s*(\S+)\s*$/m.exec(text)
    if (hit !== null) return hit[1]
  } catch { /* 下面会给一条明确的失败 */ }
  return ''
})()

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail === undefined || pass ? '' : ' — ' + detail))
}

// ---------------------------------------------------------- 1. 生成器自检

try {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build-halo-plugin.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' })
  check('产物与源同步（build-halo-plugin.mjs --check）', true)
} catch (error) {
  const out = String(error.stdout ?? '') + String(error.stderr ?? '')
  check('产物与源同步（build-halo-plugin.mjs --check）', false, out.trim().split('\n').slice(-6).join(' | '))
}

// ---------------------------------------------------------- 2. catalog

let catalog = null
try {
  catalog = JSON.parse(readFileSync(join(PET, 'catalog'), 'utf8'))
} catch (error) {
  check('catalog 能解析', false, String(error.message ?? error))
}
if (catalog !== null) {
  check('catalog 能解析', true)
  check('pet-base.properties 给出了带版本号的前缀',
    /^\/plugins\/whale-pet-live2d\/assets\/v[^/]+$/.test(ASSET_BASE), ASSET_BASE === '' ? '读不到 pet-base.properties' : ASSET_BASE)
  // 三处必须一致：catalog 的 URL、ReverseProxy 的规则路径、Java 读的属性文件。
  // 不一致的症状是"页面 404 / 桌宠根本不启动"，而三份文件各自看都没毛病。
  const reverseProxy = existsSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'))
    ? readFileSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'), 'utf8')
    : ''
  const expectedRule = 'path: ' + ASSET_BASE.replace('/plugins/' + PLUGIN_NAME + '/assets', '') + '/**'
  check('ReverseProxy 的规则路径与 pet-base.properties 的版本一致',
    ASSET_BASE !== '' && reverseProxy.includes(expectedRule), '期望 ' + expectedRule)
  check('catalog 至少有一只宠物', Array.isArray(catalog.pets) && catalog.pets.length >= 1,
    'pets=' + (catalog.pets?.length ?? 0))
  check('vendorUrl 指向本插件静态目录', typeof catalog.vendorUrl === 'string' && catalog.vendorUrl.startsWith(ASSET_BASE),
    String(catalog.vendorUrl))
  check('coreUrl 是 Live2D 官方 CDN（专有运行时不由插件分发）',
    typeof catalog.coreUrl === 'string' && catalog.coreUrl.startsWith('https://cubism.live2d.com/'), String(catalog.coreUrl))

  const urls = [catalog.vendorUrl, ...catalog.pets.map((pet) => pet.modelUrl)]
  const dangling = urls.filter((url) => {
    if (typeof url !== 'string' || !url.startsWith(ASSET_BASE)) return true
    const rel = url.slice(ASSET_BASE.length + 1).split('/').map(decodeURIComponent).join('/')
    return !existsSync(join(PET, rel))
  })
  check('catalog 里 ' + urls.length + ' 个 URL 都能落到文件上', dangling.length === 0, dangling.join(', '))

  // 每条宠物的相位映射必须引用模型里真实存在的动作组 —— 名字打错的话，
  // 症状是"相位切了但动作没变"，在浏览器里很难往清单上想。
  for (const pet of catalog.pets) {
    // 动作表里每条的组名是 `group`（不是 `key`）：catalog 的 `motions[].group`。
    const groups = new Set((pet.motions ?? []).map((motion) => motion.group))
    const referenced = Object.values(pet.motionsByPhase ?? {})
    const unknown = referenced.filter((group) => !groups.has(group))
    check('宠物 ' + pet.id + ' 的相位动作映射都存在于动作表里', unknown.length === 0, unknown.join(', '))
    check('宠物 ' + pet.id + ' 的动作表非空', groups.size > 0, 'groups=' + groups.size)
  }
}

// ------------------------------------------------- 3. 模型引用闭包（独立重算）

function modelClosure(modelFile) {
  const dir = dirname(modelFile)
  const json = JSON.parse(readFileSync(modelFile, 'utf8'))
  const found = new Set()
  const walk = (node) => {
    if (typeof node === 'string') {
      if (/\.(moc3|png|webp|jpg|jpeg|json)$/i.test(node)) found.add(node)
      return
    }
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (node !== null && typeof node === 'object') { for (const value of Object.values(node)) walk(value) }
  }
  walk(json.FileReferences ?? json)
  const missing = []
  for (const rel of found) {
    // 只检查同目录/子目录的相对引用（绝对 URL 不归我们管）
    if (/^[a-z]+:\/\//i.test(rel)) continue
    if (!existsSync(join(dir, rel))) missing.push(rel)
  }
  return { count: found.size, missing }
}

if (catalog !== null) {
  for (const pet of catalog.pets) {
    const rel = pet.modelUrl.slice(ASSET_BASE.length + 1).split('/').map(decodeURIComponent).join('/')
    const file = join(PET, rel)
    if (!existsSync(file)) { check('宠物 ' + pet.id + ' 的 model3.json 存在', false, rel); continue }
    const { count, missing } = modelClosure(file)
    check('宠物 ' + pet.id + ' 的模型引用闭包完整（独立重算，' + count + ' 个引用）', missing.length === 0, missing.slice(0, 5).join(', '))
  }
}

// ------------------------------------------------- 4. 手写文件与契约锚点

const read = (name) => existsSync(join(PET, name)) ? readFileSync(join(PET, name), 'utf8') : ''
const shim = read('pet-shim.js')
const halodriver = read('pet-halo.js')
check('pet-shim.js 从 application/json 标签体读配置（并保留属性兜底）',
  shim.includes('application/json') || shim.includes('json-block'), '')
check('pet-shim.js 仍然认 data-config 属性（兜底）', shim.includes('data-config'), '')
check('pet-shim.js 设定 __dshLive2dPetHost（含 static: true）',
  shim.includes('__dshLive2dPetHost') && shim.includes('static: true'), '')
check('pet-shim.js 种 __ModuleLoader__ 垫片', shim.includes('__ModuleLoader__'), '')
check('pet-shim.js 按序加载四个文件',
  ['react.js', 'react-dom.js', 'client.js', 'pet-halo.js'].every((file) => shim.includes(file)), '')
check('pet-halo.js 暴露 __haloPetPhase 与 phaseNow 通路',
  halodriver.includes('__haloPetPhase') && halodriver.includes('phaseNow'), '')
check('pet-halo.js 有软导航重挂（watchdog）', halodriver.includes('watchdog'), '')

// ------------------------------------------------- 5. 不许混进专有运行时

function walkNames(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkNames(full, base, out)
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}
const leaked = walkNames(PET).filter((rel) => /live2dcubismcore/i.test(rel))
check('产物里没有 Cubism Core', leaked.length === 0, leaked.join(', '))

// ------------------------------------------------- 6. Halo 侧配置自洽

const pluginYaml = existsSync(join(HALO, 'src', 'main', 'resources', 'plugin.yaml'))
  ? readFileSync(join(HALO, 'src', 'main', 'resources', 'plugin.yaml'), 'utf8')
  : ''
check('plugin.yaml 存在', pluginYaml !== '', '')
check('plugin.yaml 的 metadata.name 是 ' + PLUGIN_NAME,
  new RegExp('^\\s*name:\\s*' + PLUGIN_NAME + '\\s*$', 'm').test(pluginYaml), '')

// —— 应用市场审核指南里可以机械核对的那几条（docs.halo.run/developer-guide/app-store）——
// 审核明确要求：logo 不能用模板默认图标，homepage / issues 必须设置，requires 必须是
// 合法 SemVer range 且没有首尾空白，制品里不许有无关大文件或本地配置。
{
  // Halo 文档：`spec.logo` 支持「URL 或相对 src/main/resources 的路径」。
  // 之前写成 `/plugins/<名字>/assets/logo/logo.png` —— 两者都不是，Halo 当相对路径找不到，
  // 控制台就回退成显示插件名首字（用户看到的是一个「鲸」字）。这里钉死"相对路径 + 文件在"。
  const logo = (/^\s*logo:\s*"?([^"\s]+)"?\s*$/m.exec(pluginYaml)?.[1] ?? '')
  const isUrl = /^https?:\/\//.test(logo)
  check('plugin.yaml 的 logo 是 URL 或相对 resources 的路径（不能是裸的 /plugins/... 路径）',
    logo !== '' && (isUrl || !logo.startsWith('/')),
    logo === '' ? '缺 logo 字段' : logo)
  check('logo 指向的文件在 resources 里',
    logo !== '' && !isUrl && existsSync(join(HALO, 'src', 'main', 'resources', logo)),
    logo)
  check('plugin.yaml 设置了 homepage', /^\s*homepage:\s*"?https?:\/\//m.test(pluginYaml), '')
  check('plugin.yaml 设置了 issues', /^\s*issues:\s*"?https?:\/\//m.test(pluginYaml), '')
  check('plugin.yaml 设置了 repo', /^\s*repo:\s*"?https?:\/\//m.test(pluginYaml), '')
  check('plugin.yaml 的 license 列了代码与美术两套许可',
    /name:\s*"?MIT/m.test(pluginYaml) && /CC BY-NC-SA/.test(pluginYaml), '')
  const requires = (/^\s*requires:\s*"?([^"\s]+)"?\s*$/m.exec(pluginYaml)?.[1] ?? '')
  check('requires 是合法的 SemVer range 且没有首尾空白',
    /^(>=|>|<=|<|\^|~)?\d+\.\d+\.\d+/.test(requires) && requires === requires.trim(), requires)
  check('description 里披露了外部 CDN 与"不收集数据"',
    /CDN/.test(pluginYaml) && /不收集/.test(pluginYaml), '')
  // ⚠️ 这里**不能**直接用后面的 `const reverseProxy`（模块顶层自上而下执行 ⇒ TDZ），
  // 所以本地再读一份（同一份文件，同名变量会撞，用另一个名字）。
  const proxyYaml = existsSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'))
    ? readFileSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'), 'utf8')
    : ''
  check('ReverseProxy 只映射版本化资源目录（图标走 Halo 自己的 resources 读取）',
    /directory:\s*pet\s*$/m.test(proxyYaml) && !/\/logo\//.test(proxyYaml), '')
}

const settingName = /settingName:\s*([\w-]+)/.exec(pluginYaml)?.[1]
const settingsYaml = existsSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'settings.yaml'))
  ? readFileSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'settings.yaml'), 'utf8')
  : ''
if (settingName === undefined) {
  check('plugin.yaml 声明了 settingName', false, '没找到 settingName')
} else {
  const settingsResourceName = /^\s*name:\s*([\w-]+)\s*$/m.exec(settingsYaml)?.[1]
  // 这一条是研究结论里最贵的一个坑：配了 settingName 却没有同名 Setting 资源，
  // Halo 会让**插件启动失败**（不是"设置页空着"）。
  check('Setting 资源的 metadata.name 与 plugin.yaml 的 settingName 一致（' + settingName + '）',
    settingsResourceName === settingName, 'settings.yaml name=' + String(settingsResourceName))
}

const reverseProxy = existsSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'))
  ? readFileSync(join(HALO, 'src', 'main', 'resources', 'extensions', 'reverse-proxy.yaml'), 'utf8')
  : ''
check('ReverseProxy 把版本化路径映射到 pet 目录',
  /path:\s*\/v[^/]+\/\*\*/.test(reverseProxy) && /directory:\s*pet\s*$/m.test(reverseProxy), '')

const headProcessor = walkNames(join(HALO, 'src', 'main', 'java')).find((rel) => /HeadProcessor\.java$/.test(rel))
check('存在 TemplateHeadProcessor 实现', headProcessor !== undefined, '')
if (headProcessor !== undefined) {
  const source = readFileSync(join(HALO, 'src', 'main', 'java', headProcessor), 'utf8')
  check('Head 处理器实现的是 TemplateHeadProcessor',
    source.includes('TemplateHeadProcessor'), '')
  check('Head 处理器注入 pet-shim.js',
    source.includes('pet-shim.js'), '')
  // 配置块：`<script type="application/json" id="…">{…}</script>`，配置在**标签体**里。
  // 这样就不存在"属性值转义"这一整类问题（Thymeleaf 不替属性值转义）。
  check('Head 处理器用 application/json 标签体承载配置',
    source.includes("application/json") && source.includes('type=\\"application/json\\"'), '')
  // **绝对不能用自闭合的 <script/> 注入**：HTML 里 script 不是自闭合元素，解析器会把
  // 后面的一切（`</head>`、`<body class=…>`、主题自己的 div 与内联脚本）当成脚本文本
  // 一直吞到下一个 `</script>` —— 真站上就是这么把主题的 banner 配置吞掉的。
  check('Head 处理器手写完整闭合的标签（不是自闭合的 <script/>）',
    source.includes('</script>') && !/createStandaloneElementTag\s*\(\s*"script"/.test(source), '')
  check('Head 处理器把 JSON 里的 `<` 转成 Unicode 转义（防提前闭合）',
    source.includes('\\u003c'), '')
  check('pet-shim.js 对坏掉的配置有兜底并有证据位',
    read('pet-shim.js').includes('configRecovered'), '')
}

// --------------------------------------------------------------- 结论

const failed = results.filter((item) => !item.pass)
console.log('\nHALO-TREE ' + (results.length - failed.length) + '/' + results.length + ' 通过')
process.exit(failed.length === 0 ? 0 : 1)
