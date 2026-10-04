// 生成 Halo 2.x 插件的静态资源树（`halo-plugin/src/main/resources/pet/`）。
//
// 为什么要有这个脚本，而不是手工拷文件进插件：
//
//   * catalog 的字段（动作时长、表情槽位、台词、关系、部件名…）是**由宿主半区
//     `lib/index.js` 的 `buildCatalog()` 从 pet.json + model3.json 算出来的**。
//     手抄一份进 Halo 插件就等于养出第三份实现（已经有 JS 与 Rust 两份，见 AGENTS.md
//     的"宿主半区有两份实现"那条纪律）—— 这里是**生成**，不是重写：唯一权威仍是 JS 宿主。
//   * client.js / live2d-vendor.js 必须是插件的**逐字节副本**，否则"网页端正常、
//     Halo 上少一段"这种分叉根本查不出来。脚本会把这份相等当作断言来跑。
//   * 生成物是**提交进仓库**的（和 `dsh-live2d-pet/pets/` 一样）：这样 `./gradlew build`
//     不需要 node，打出来的 jar 就是源码树里那一份，CI 与市场发布都自洽。
//
// 用法：
//
//   node tools/build-halo-plugin.mjs            # 生成/刷新
//   node tools/build-halo-plugin.mjs --check     # 只校验产物与源同步（CI 用，不写盘）
//
// 退出码：0 = 成功；1 = 有断言没通过（缺文件、产物不同步、混进了 Cubism Core…）。
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PLUGIN = join(ROOT, 'dsh-live2d-pet')
const RESOURCES = join(ROOT, 'halo-plugin', 'src', 'main', 'resources')
const OUT = join(RESOURCES, 'pet')
const REACT_DIR = join(ROOT, 'vendor', 'react', '18.3.1')

/** 一律用与 `halo-plugin/src/main/resources/plugin.yaml` 的 `metadata.name` 相同的名字。 */
const PLUGIN_NAME = 'whale-pet-live2d'
/**
 * 插件版本，从 `halo-plugin/gradle.properties` 读（**唯一真源** —— Gradle 也把它写进
 * plugin.yaml 的 `spec.version`）。
 */
const VERSION = (() => {
  const text = readFileSync(join(ROOT, 'halo-plugin', 'gradle.properties'), 'utf8')
  const hit = /^\s*version\s*=\s*(\S+)\s*$/m.exec(text)
  if (hit === null) throw new Error('读不到 halo-plugin/gradle.properties 里的 version')
  return hit[1]
})()
/**
 * 静态资源的公开前缀。**路径里带版本号**：
 *
 * Halo 的 ReverseProxy 会沿用全局的静态资源缓存策略 —— 实测响应头是
 * `cache-control: max-age=31536000`（一年）。固定路径的后果是：插件升级了，访客浏览器
 * 里跑的还是旧 JS，长达一年（真站踩过：0.1.1/0.1.2 的客户端修复全都没生效，页面里
 * 连新加的 `diag()` 都不存在）。把版本放进路径 ⇒ 升级即换 URL ⇒ 全部资源自动重新取，
 * 而且是**每一个**文件（catalog、client.js、vendor、贴图、动作）都换，不用逐个加查询串。
 */
const ASSET_BASE = '/plugins/' + PLUGIN_NAME + '/assets/v' + VERSION
/** ReverseProxy 规则里的那段路径（与 ASSET_BASE 必须一致：靠 catalog / 规则 / 属性文件三处互证）。 */
const ASSET_RULE = '/v' + VERSION + '/**'
/**
 * Cubism Core 的默认地址：Live2D 官方 CDN。
 *
 * 这份运行时是 Live2D 的专有软件（其文件头写明对应协议里的 "Redistributable Code"），
 * 本项目**不随插件分发**它 —— 与 `lib/index.js`（宿主半区）里的策略保持一致，
 * 那边也是"不内置、从官方 CDN 取并缓存"。站长可以在插件设置里改成自建地址。
 */
const CORE_CDN = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

/** catalog 里对浏览器公开的字段（与 `lib/index.js` 的 catalogRoute 一一对应）。 */
const PET_FIELDS = [
  'id', 'displayName', 'description', 'scale', 'translate', 'motionsByPhase', 'expressionsByPhase',
  'expressionSlots', 'looksByPhase', 'motionGuards', 'headParts', 'tailParts', 'partNames', 'lines',
  'patReactions', 'tailReactions', 'spinReactions', 'fidgetSlots', 'hiddenMotions', 'motionOptions',
  'motions', 'expressions',
]

/** 手写文件：生成器**不许**覆盖它们，缺了就报错。 */
const HAND_WRITTEN = ['pet-shim.js', 'pet-halo.js', 'README.md', 'LICENSES.md']

const problems = []
const notes = []
const ok = (message) => notes.push('  ok   ' + message)
const bad = (message) => problems.push('  FAIL ' + message)

const check = process.argv.includes('--check')
const destArg = process.argv.indexOf('--dest')
const DEST = destArg >= 0 ? resolve(process.argv[destArg + 1]) : OUT

// --------------------------------------------------------------- 读源（唯一的权威）

/**
 * 用宿主半区的 `buildCatalog()` 算清单。
 *
 * 副作用警告：`buildCatalog()` 会 `installBundledPets()` —— 把随包宠物复制到
 * `$DSH_HOME/pets`。所以这里**先把 DSH_HOME 指到一个临时目录**，绝不碰用户真正的
 * `~/.dsh`（那里面有他自己改过的宠物与设置）。
 */
async function readCatalog() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pet-halo-'))
  process.env.DSH_HOME = home
  const host = await import(pathToFileURL(join(PLUGIN, 'lib', 'index.js')).href)
  const pets = host.buildCatalog()
  if (pets.length === 0) {
    bad('buildCatalog() 没有找到任何宠物 —— 检查 dsh-live2d-pet/pets/ 是否还在')
  }
  return { home, pets }
}

/** 把一个宠物的扫描结果变成 catalog 里那一条（URL 指向静态目录）。 */
function catalogEntry(pet) {
  const entry = { id: pet.id }
  for (const field of PET_FIELDS) {
    if (field === 'id') continue
    entry[field] = pet[field]
  }
  // 模型描述文件的地址重写到静态目录；model3.json 内部引用的是**相对路径**，
  // 所以只要这个文件名对了，贴图/动作/物理都会自然落在同一个目录下被取到。
  const rel = pet.modelPath.split('/').map(encodeURIComponent).join('/')
  entry.modelUrl = ASSET_BASE + '/pets/' + encodeURIComponent(pet.id) + '/' + rel
  return entry
}

// ------------------------------------------------------------------- 写产物

function writeGenerated(target, pets) {
  for (const dir of ['', 'pets']) mkdirSync(join(target, dir), { recursive: true })

  // 1) catalog（文件名**没有扩展名**：client.js 取的是 `<base>/catalog`）。
  const payload = {
    ok: true,
    coreUrl: CORE_CDN,
    vendorUrl: ASSET_BASE + '/live2d-vendor.js',
    pets: pets.map(catalogEntry),
  }
  writeFileSync(join(target, 'catalog'), JSON.stringify(payload, null, 2) + '\n')

  // 2) 浏览器半区与 vendor：逐字节副本。
  for (const [from, to] of [
    [join(PLUGIN, 'lib', 'client.js'), join(target, 'client.js')],
    [join(PLUGIN, 'lib', 'live2d-vendor.js'), join(target, 'live2d-vendor.js')],
    // 3) React UMD（生产构建）：Halo 页面里没有 DSH 的模块表，得自己带一份。
    //    许可说明见 vendor/react/README.md 与 LICENSES.md。
    [join(REACT_DIR, 'react.production.min.js'), join(target, 'react.js')],
    [join(REACT_DIR, 'react-dom.production.min.js'), join(target, 'react-dom.js')],
  ]) {
    if (!existsSync(from)) {
      bad('缺少源文件：' + relative(ROOT, from))
      continue
    }
    cpSync(from, to)
  }

  // 4) 宠物包整目录（含 pet.json / catalog.json / LICENSE / README / previews 等
  //    署名与许可材料）；model 引用闭包必须是它的子集（下面单独断言）。
  for (const pet of pets) {
    const from = pet.dir
    const to = join(target, 'pets', pet.id)
    rmSync(to, { recursive: true, force: true })
    cpSync(from, to, { recursive: true })
    // 宠物包里那份《安装说明.md》讲的是 DSH 的用法（`dsh web` / `%DSH_HOME%`），
    // 原样发到 Halo 插件里会误导用户；README 与 LICENSE 留着（来源与署名）。
    rmSync(join(to, '安装说明.md'), { force: true })
  }
  return payload
}

// ------------------------------------------------------------------- 自检

/** 递归列出相对路径（叶子文件）。 */
function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function verify(target, catalog, pets) {
  // a. client.js / vendor 必须是源的逐字节副本 —— 这是"两边只有一份实现"的机械保证。
  for (const [name, source] of [
    ['client.js', join(PLUGIN, 'lib', 'client.js')],
    ['live2d-vendor.js', join(PLUGIN, 'lib', 'live2d-vendor.js')],
  ]) {
    const generated = join(target, name)
    if (!existsSync(generated)) { bad('产物缺少 ' + name); continue }
    if (sha(generated) !== sha(source)) bad(name + ' 与 ' + relative(ROOT, source) + ' 不一致（不要手改产物）')
    else ok(name + ' 与源逐字节一致')
  }

  // b. client.js 必须支持宿主配置（Halo 就是靠它指向静态目录的）。
  const clientText = existsSync(join(target, 'client.js')) ? readFileSync(join(target, 'client.js'), 'utf8') : ''
  if (!clientText.includes('__dshLive2dPetHost')) {
    bad('client.js 里找不到 `__dshLive2dPetHost` —— 上游去掉宿主配置后，Halo 静态托管会退回去问 /api/live2d-pet')
  } else ok('client.js 支持 __dshLive2dPetHost 宿主配置')

  // c. 本脚本的 Cubism Core 地址必须与宿主半区一致（防两处漂移）。
  const hostText = readFileSync(join(PLUGIN, 'lib', 'index.js'), 'utf8')
  if (!hostText.includes(CORE_CDN)) bad('宿主半区 lib/index.js 里的 Cubism Core 地址与生成器不一致：' + CORE_CDN)
  else ok('Cubism Core 地址与宿主半区一致')

  // d. 手写文件在不在（生成器不写它们，但插件缺了就跑不起来）。
  for (const name of HAND_WRITTEN) {
    if (!existsSync(join(target, name))) bad('缺少手写文件 ' + name)
  }
  if (HAND_WRITTEN.every((name) => existsSync(join(target, name)))) ok('4 个手写文件齐全')

  // e. 产物里**不许**出现 Cubism Core（专有运行时，本项目不代分发）。
  const leaked = walk(target).filter((rel) => /live2dcubismcore/i.test(rel))
  if (leaked.length > 0) bad('产物里混进了 Cubism Core：' + leaked.join(', '))
  else ok('产物里没有 Cubism Core（专有运行时由页面按设置去官方 CDN 取）')

  // f. catalog 里每个指向本插件静态目录的 URL 都要能落到真实文件上。
  const urls = []
  urls.push(catalog.vendorUrl)
  for (const pet of catalog.pets) urls.push(pet.modelUrl)
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith(ASSET_BASE)) { bad('catalog 里的 URL 不在静态目录下：' + url); continue }
    const rel = url.slice(ASSET_BASE.length + 1).split('/').map(decodeURIComponent).join('/')
    if (!existsSync(join(target, rel))) bad('catalog 指向的文件不存在：' + url)
  }
  ok('catalog 里的 ' + urls.length + ' 个 URL 都能落到文件上')

  // g. 模型引用闭包必须全在（这是"贴图/动作少一个 ⇒ 加载失败"的机械检查）。
  for (const pet of pets) {
    const missing = [...pet.closure].filter((rel) => !existsSync(join(target, 'pets', pet.id, rel)))
    if (missing.length > 0) bad('宠物 ' + pet.id + ' 的引用闭包缺 ' + missing.length + ' 个文件：' + missing.slice(0, 5).join(', '))
    else ok('宠物 ' + pet.id + ' 的引用闭包完整（' + pet.closure.size + ' 个文件）')
  }
}

// ------------------------------------------------------- 随产物的两个配置文件

/**
 * 那两个"版本必须一致"的文件 + 一个**不带版本**的 logo：
 *
 *   `extensions/reverse-proxy.yaml` —— 规则 `/v<版本>/**`（版本化，绕开一年缓存）
 *                                      与 `/logo/**`（固定，插件图标用）
 *   `pet-base.properties`          —— Java 侧读的公开前缀
 *   `logo/logo.png`                —— 插件图标（`plugin.yaml` 的 `spec.logo` 指向它）
 *
 * 加上 catalog 里的 URL，三处必须指向同一个版本化前缀（`verify` 会互证）。
 * 版本进路径是为了绕开 Halo 静态资源的 `max-age=31536000`：升级即换 URL。
 * logo 反过来**故意不带版本**：图标换不换无所谓，但 URL 稳定，审核/市场里不会因为
 * 升一次版本就变成死链。
 */
function writeSidecar(target) {
  mkdirSync(join(target, 'extensions'), { recursive: true })
  writeFileSync(join(target, 'extensions', 'reverse-proxy.yaml'), [
    '# 本文件由 tools/build-halo-plugin.mjs 生成，不要手改。',
    '# 规则路径里带**版本号**：Halo 的静态资源缓存是 max-age=31536000（一年），',
    '# 固定路径会让升级后的新 JS 一年都到不了访客浏览器（真站踩过）。',
    'apiVersion: plugin.halo.run/v1alpha1',
    'kind: ReverseProxy',
    'metadata:',
    '  name: whale-pet-live2d-assets',
    'rules:',
    '  - path: ' + ASSET_RULE,
    '    file:',
    '      directory: pet',
    '',
  ].join('\n'))
  writeFileSync(join(target, 'pet-base.properties'), [
    '# 本文件由 tools/build-halo-plugin.mjs 生成，不要手改。',
    '# TemplateHeadProcessor 读它拿到静态资源的公开前缀（与 ReverseProxy 规则、catalog 三处一致）。',
    'base=' + ASSET_BASE,
    '',
  ].join('\n'))
  // 插件图标：源文件是 `halo-plugin/logo.png`（512×512，透明背景的头部特写，
  // 由桌面端应用图标 `dsh-live2d-pet-desktop/src-tauri/icons/icon.png` 裁成正方形 + 留边距）。
  // 目的地在 **resources 根**：Halo 的 `spec.logo` 支持"URL 或相对 src/main/resources 的路径"，
  // 于是 plugin.yaml 里写 `logo: logo.png`（与社区插件 plugin-live2d 的写法一致）。
  // 这里只做复制，不做图像处理 —— 生成器不依赖 ImageMagick，换图标请替换源文件。
  cpSync(join(ROOT, 'halo-plugin', 'logo.png'), join(target, 'logo.png'))
}

// ------------------------------------------------------------------- 同步校验

/** 产物与"现在重新生成一遍"是否逐字节一致（CI 的防漂移闸门）。 */
function compareTrees(a, b) {
  const listA = walk(a).sort()
  const listB = walk(b).sort()
  // 手写文件只在 a（真产物）里有 —— 它们**不是**生成器的产物，
  // 不能算成"多余文件"（否则这里报的和上面"手写文件齐全"那条自相矛盾）。
  const onlyA = listA.filter((rel) => !listB.includes(rel) && !HAND_WRITTEN.includes(rel))
  const onlyB = listB.filter((rel) => !listA.includes(rel) && !HAND_WRITTEN.includes(rel))
  if (onlyA.length > 0) bad('产物里有生成器不产出的文件：' + onlyA.slice(0, 8).join(', '))
  if (onlyB.length > 0) bad('产物缺少生成器应产出的文件：' + onlyB.slice(0, 8).join(', '))
  let differ = 0
  for (const rel of listA) {
    if (!listB.includes(rel)) continue
    if (sha(join(a, rel)) !== sha(join(b, rel))) {
      differ += 1
      if (differ <= 5) bad('内容不同步：' + rel)
    }
  }
  if (differ > 5) bad('……另有 ' + (differ - 5) + ' 个文件内容不同步')
  if (onlyA.length === 0 && onlyB.length === 0 && differ === 0) ok('产物与重新生成的结果完全一致（' + listA.length + ' 个文件）')
}

// ------------------------------------------------------------------- 主流程

const { home, pets } = await readCatalog()
const catalog = writeGenerated(DEST, pets)
writeSidecar(RESOURCES)
verify(DEST, catalog, pets)
// 三处必须指向同一个版本化前缀：catalog 里的 URL、ReverseProxy 规则、Java 读的属性文件。
{
  const rule = readFileSync(join(RESOURCES, 'extensions', 'reverse-proxy.yaml'), 'utf8')
  const base = readFileSync(join(RESOURCES, 'pet-base.properties'), 'utf8')
  if (!rule.includes('path: ' + ASSET_RULE)) bad('reverse-proxy.yaml 的规则路径与版本不一致（应为 ' + ASSET_RULE + '）')
  if (!base.includes('base=' + ASSET_BASE)) bad('pet-base.properties 的 base 与版本不一致（应为 ' + ASSET_BASE + '）')
  if (!catalog.vendorUrl.startsWith(ASSET_BASE)) bad('catalog 的 URL 前缀与版本不一致')
  if (rule.includes('path: ' + ASSET_RULE) && base.includes('base=' + ASSET_BASE)
    && catalog.vendorUrl.startsWith(ASSET_BASE)) {
    ok('版本化前缀三处一致：' + ASSET_BASE + '（升级即换 URL，绕开一年缓存）')
  }
  // 插件图标：审核明确要求 `plugin.yaml` 的 logo 不能留默认图标，这里把"文件真的在"钉住。
  const pluginYaml = readFileSync(join(RESOURCES, 'plugin.yaml'), 'utf8')
  // YAML 里可能带引号（`logo: "/plugins/…"`），取值时把引号去掉
  const logoValue = (/^\s*logo:\s*"?([^"\s]+)"?\s*$/m.exec(pluginYaml)?.[1] ?? '')
  if (logoValue !== 'logo.png') {
    bad('plugin.yaml 的 logo 不是本插件图标地址：' + logoValue)
  } else if (!existsSync(join(RESOURCES, 'logo.png'))) {
    bad('图标文件缺失：src/main/resources/logo.png')
  } else {
    ok('插件图标就位：' + logoValue + '（resources 根，Halo 按相对路径取）')
  }
}

let tempForCheck = null
if (check) {
  // --check：把产物重新生成到临时目录，与仓库里那一份逐个字节比。
  tempForCheck = mkdtempSync(join(tmpdir(), 'dsh-pet-halo-check-'))
  writeGenerated(join(tempForCheck, 'pet'), pets)
  writeSidecar(tempForCheck)
  compareTrees(DEST, join(tempForCheck, 'pet'))
  // 两个随产物生成的配置文件也逐个字节比（其余文件不是生成物，不参与）。
  for (const rel of ['extensions/reverse-proxy.yaml', 'pet-base.properties', 'logo.png']) {
    const real = join(RESOURCES, rel)
    const fresh = join(tempForCheck, rel)
    if (!existsSync(real)) bad('缺少生成文件 ' + rel)
    else if (sha(real) !== sha(fresh)) bad('内容不同步：' + rel)
  }
}

rmSync(home, { recursive: true, force: true })
if (tempForCheck !== null) rmSync(tempForCheck, { recursive: true, force: true })

const bytes = walk(DEST).reduce((sum, rel) => sum + statSync(join(DEST, rel)).size, 0)
console.log('生成目标：' + relative(ROOT, DEST))
console.log('模式：' + (check ? '--check（不写盘，只比对）' : '生成'))
console.log('宠物：' + pets.map((pet) => pet.id + '@' + (pet.version ?? pet.petManifestVersion ?? '?')).join(', '))
console.log('文件：' + walk(DEST).length + ' 个，共 ' + (bytes / 1048576).toFixed(2) + ' MB')
for (const line of notes) console.log(line)
if (problems.length > 0) {
  console.error('\n有 ' + problems.length + ' 项没通过：')
  for (const line of problems) console.error(line)
  process.exit(1)
}
console.log('\n全部检查通过。')
