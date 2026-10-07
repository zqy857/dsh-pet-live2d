package io.github.zqy857.whalepetlive2d;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.model.IModel;
import org.thymeleaf.model.IProcessableElementTag;
import org.thymeleaf.processor.element.IElementModelStructureHandler;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.ReactiveSettingFetcher;
import run.halo.app.theme.dialect.TemplateHeadProcessor;

/**
 * 主题 {@code <head>} 注入点：把桌宠的加载脚本挂到页面上。
 *
 * <p>刻意<b>只注入一个标签</b>（页面里没有内联脚本，免得撞 Halo 的 CSP）：
 * 配置挂在 {@code data-config} 属性上，由 {@code pet-shim.js} 自己按序去加载
 * React → ReactDOM → client.js → pet-halo.js 这四个文件。
 *
 * <p>属性值里的 JSON 由服务端拼装，并把 {@code <} 换成 Unicode 转义 —— 因为配置块是
 * {@code <script type="application/json">} 的**标签体**，标签体里唯一会破坏解析的就是
 * {@code <} 开头的序列（{@code </script>} 提前闭合）。属性那一套转义（{@code &quot;} 之类）
 * 因此**完全不需要**：这就是把这个坑从结构上删掉的做法（借鉴社区插件 LIlGG/plugin-live2d）。
 */
@Component
public class WhalePetLive2dHeadProcessor implements TemplateHeadProcessor {

    /**
     * 静态资源基址：**带版本号**，由生成器写进 classpath 根目录的 `pet-base.properties`。
     *
     * <p>为什么非要版本号：Halo 的 ReverseProxy 会沿用全局的静态资源缓存策略，实测响应头是
     * {@code cache-control: max-age=31536000}（一年）。路径固定的话，插件升级后访客浏览器里
     * 跑的仍是旧 JS —— 真站踩过（0.1.1/0.1.2 的客户端修复全都没生效，页面里连新加的读口都不存在）。
     * 版本进路径 ⇒ 升级即换 URL ⇒ catalog、client.js、vendor、贴图、动作全都自动重新取。
     *
     * <p>三处必须一致：本值、ReverseProxy 规则路径、catalog 里的 URL（生成器会互证）。
     */
    private static final String ASSET_BASE = readAssetBase();

    private static String readAssetBase() {
        try (var in = WhalePetLive2dHeadProcessor.class.getClassLoader()
            .getResourceAsStream("pet-base.properties")) {
            if (in != null) {
                var props = new java.util.Properties();
                props.load(in);
                var base = props.getProperty("base");
                if (base != null && !base.isBlank()) {
                    return base.trim();
                }
            }
        } catch (IOException ignored) {
            // 落到下面的兜底：至少不会因为读不到属性文件就 500
        }
        return "/plugins/whale-pet-live2d/assets/pet";
    }

    /** 设置分组名，必须与 extensions/settings.yaml 里的 group 一致。 */
    private static final String SETTING_GROUP = "basic";

    /** 标签 id，同时用于"同一次渲染里不重复注入"的幂等判断。 */
    private static final String TAG_ID = "whale-pet-live2d-config";

    /**
     * 只用来序列化 data-config。自己 new 一个而不是注入 Spring 的 ObjectMapper：
     * 少一个启动期依赖，插件不会因为拿不到 Bean 而起不来。
     */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ReactiveSettingFetcher settingFetcher;

    public WhalePetLive2dHeadProcessor(ReactiveSettingFetcher settingFetcher) {
        this.settingFetcher = settingFetcher;
    }

    @Override
    public Mono<Void> process(ITemplateContext context, IModel model,
                              IElementModelStructureHandler structureHandler) {
        // 幂等：同一个 model 里已经有我们的标签就不再输出第二遍
        if (containsInjectedTag(model)) {
            return Mono.empty();
        }
        return settingFetcher.getValues()
            .defaultIfEmpty(Map.of())
            .flatMap(values -> inject(context, model, values.get(SETTING_GROUP)));
    }

    /**
     * 按设置决定是否注入，并写入 head。
     *
     * @param settings 设置分组 {@value #SETTING_GROUP} 对应的 JSON；没配置过时为 null
     */
    private Mono<Void> inject(ITemplateContext context, IModel model, JsonNode settings) {
        if (!isEnabled(settings)) {
            // 总开关关掉：一个标签都不注入
            return Mono.empty();
        }
        addScriptTag(context, model, settings);
        return Mono.empty();
    }

    /**
     * 往 {@code model} 里写两段**完整闭合**的 {@code <script …></script>}（配置块 + 加载器）。
     *
     * <p><b>绝不能用 {@code createStandaloneElementTag}</b>：那条路会输出自闭合的
     * {@code <script … />}，而 HTML 里 script **不是**自闭合元素 —— 解析器把它当作开标签，
     * 然后把后面的一切都当成脚本内容，直到遇见下一个 {@code </script>}。
     *
     * <p>真站上踩过（主题 Ethereal，2026-10）：这个标签后面紧跟的是主题的
     * {@code </head>}、{@code <body class="… enable-banner …">}、
     * {@code <div id="config-carrier" data-banner-display-default="banner">} 与读它的那段
     * 内联脚本 —— 全被吞成脚本文本、根本没进 DOM。症状是**首屏 banner 就坏掉**
     * （主题的 banner 配置从未生效），而桌宠自己照常工作（自闭合不影响 {@code src}
     * 的加载），所以从宠物这边完全看不出问题。
     *
     * <p>因此这两段标签是**手写的完整字符串**（开标签与闭标签都写全），经
     * {@code createText} 原样写进 head。配置的转义只需处理 {@code <}
     * （见 {@link #escapeForScriptBody}）。
     */
    private void addScriptTag(ITemplateContext context, IModel model, JsonNode settings) {
        // 1) 配置：`<script type="application/json" id="…">{…}</script>`
        //    —— 配置放在**标签体**里，于是**完全没有"属性值转义"这个问题**（Thymeleaf 不替
        //    属性值转义，塞属性里就得自己把 `"` 换成 `&quot;`）。这一条是借鉴社区插件
        //    LIlGG/plugin-live2d 的做法。
        //
        // 2) 加载器：一个**外部**脚本（不是内联可执行脚本），所以站点即使配了 CSP
        //    （`script-src` 不含 `'unsafe-inline'`）也照常工作 —— 这一点比参考实现更稳
        //    （他们引导脚本是内联的 `<script type="module">`）。
        //
        // 两段一起作为一个**文本事件**写进 model：加到 model 里的文本是**原样输出**的，
        // Thymeleaf 的 `[[…]]` 内联只发生在**解析期**（解析模板时），不会回头处理
        // 处理器追加的文本。标签在这里是手写字符串，因此天然是完整闭合的
        // `<script …></script>` —— 不会再出现自闭合 `<script/>` 吞掉后面整段页面的事故。
        String markup = "<script type=\"application/json\" id=\"" + TAG_ID + "\">"
            + buildConfigJson(settings)
            + "</script>"
            + "<script defer src=\"" + ASSET_BASE + "/pet-shim.js\"></script>";
        model.add(context.getModelFactory().createText(markup));
    }

    /**
     * 拼装挂在配置块里的 JSON。
     *
     * <p>可缺省的键在值为空时直接不写，让前端回落到它自己的内置默认值。
     */
    private String buildConfigJson(JsonNode settings) {
        ObjectNode config = MAPPER.createObjectNode();
        // 必填：静态资源基址
        config.put("base", ASSET_BASE);
        // 专有运行时；留空表示用 catalog 里的 Live2D 官方 CDN
        config.put("coreUrl", text(settings, "cubismCoreUrl"));
        // 是否启用「博客事件 → 相位」
        config.put("phases", bool(settings, "phaseEvents", true));

        putIfPresent(config, "commentSelectors", text(settings, "commentSelectors"));
        putIfPresent(config, "searchSelectors", text(settings, "searchSelectors"));

        // 相位覆盖表是一段 JSON 文本，解析成功才嵌进去（否则前端用内置默认）
        JsonNode overrides = parseJsonOrNull(text(settings, "phaseOverridesJson"));
        if (overrides != null) {
            config.set("overrides", overrides);
        }
        return escapeForScriptBody(config.toString());
    }

    /**
     * 让这段 JSON 能安全地待在 {@code <script>} 的**标签体**里。
     *
     * <p>标签体里唯一会破坏解析的是 {@code <} 开头的序列（{@code </script>} 提前闭合、
     * {@code <!--} 进入转义态）。JSON 的字符串里允许 {@code \u003c} 这种转义，
     * 而结构性字符里不会出现 {@code <}，所以把**所有** {@code <} 换成 {@code \u003c}
     * 一举解决；返回给前端时 {@code JSON.parse} 会原样还原成 {@code <}。
     *
     * <p>对比一下：早先塞在 HTML 属性里时，还得处理 {@code "} → {@code &quot;}、
     * {@code &} → {@code \u0026}、{@code >} → {@code \u003e} 一整套 —— 少一个就是
     * "属性在第一个引号处断掉、桌宠不启动"那种沉默故障。标签体把这一类错误从结构上去掉了。
     */
    private static String escapeForScriptBody(String json) {
        return json.replace("<", "\\u003c");
    }

    private static void putIfPresent(ObjectNode config, String key, String value) {
        if (value != null && !value.isBlank()) {
            config.put(key, value);
        }
    }

    private static JsonNode parseJsonOrNull(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            JsonNode node = MAPPER.readTree(raw);
            return node == null || node.isNull() || node.isMissingNode() ? null : node;
        } catch (JsonProcessingException e) {
            // 站长在设置里写坏了 JSON 不能把整站首页打挂，降级为不带 overrides
            return null;
        }
    }

    private static String text(JsonNode settings, String key) {
        return settings == null ? "" : settings.path(key).asText("");
    }

    /** 兼容布尔真值和字符串 "true"/"false" 两种写法；缺省时返回 {@code defaultValue}。 */
    private static boolean bool(JsonNode settings, String key, boolean defaultValue) {
        if (settings == null) {
            return defaultValue;
        }
        JsonNode node = settings.path(key);
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isTextual()) {
            String value = node.asText().trim();
            if ("true".equalsIgnoreCase(value)) {
                return true;
            }
            if ("false".equalsIgnoreCase(value)) {
                return false;
            }
        }
        return defaultValue;
    }

    /** 总开关缺省为 true：没配置过也应该生效。 */
    private static boolean isEnabled(JsonNode settings) {
        return bool(settings, "enabled", true);
    }

    private static boolean containsInjectedTag(IModel model) {
        for (int i = 0; i < model.size(); i++) {
            if (model.get(i) instanceof IProcessableElementTag tag
                && TAG_ID.equals(tag.getAttributeValue("id"))) {
                return true;
            }
        }
        return false;
    }
}
