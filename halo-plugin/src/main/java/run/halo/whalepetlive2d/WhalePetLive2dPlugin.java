package run.halo.whalepetlive2d;

import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * 「鲸鱼娘桌宠」插件的主类。
 *
 * <p>Halo 通过 jar 根目录的 {@code plugin.yaml} 加 MANIFEST.MF 里的
 * {@code Plugin-Main-Class} 找到这个类，因此类名必须与
 * {@code src/main/resources/plugin.yaml} 的 {@code metadata.name} 对应关系保持一致：
 * 主类所在的包名不影响加载，但类本身必须继承 {@link BasePlugin}。
 *
 * <p>当前是空壳实现：只提供生命周期空钩子，具体逻辑（静态资源、head 注入）由
 * 其它组件承担，后续再补。
 */
@Component
public class WhalePetLive2dPlugin extends BasePlugin {

    public WhalePetLive2dPlugin(PluginContext context) {
        super(context);
    }

    @Override
    public void start() {
        // 插件启动时的钩子，目前无副作用
    }

    @Override
    public void stop() {
        // 插件停止时的钩子，目前无副作用
    }
}
