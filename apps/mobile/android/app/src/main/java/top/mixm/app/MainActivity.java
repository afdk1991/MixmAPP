package top.mixm.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * MixmAPP 原生壳。
 *
 * 在 Capacitor BridgeActivity 之上补齐「正常原生 APP」该有的完成度，均在
 * {@code this.bridge.getWebView()} 就绪之后增量扩展，不替换 Bridge 的
 * JS 注入与 shouldInterceptRequest（本地资源服务）链路：
 *
 * 1) 站外链接交系统浏览器，本地 H5 不接管（沿用既有逻辑，并补 Android 11+ 包可见性声明）；
 * 2) 返回键走 OnBackPressedDispatcher + WebView 历史栈 + 双击退出（Android 15 预测性返回必需）；
 * 3) 主框架加载失败时显示品牌化离线页（重试 / 检查网络设置），子资源失败不接管；
 * 4) WebSettings 工程化配置：缓存、DOM storage、缩放、混合内容、UA 后缀；
 *    深色主题双通道（跟随系统 + data-mx-theme 手动切换），原生侧按页面自报主题同步壳层底色与系统栏图标明暗；
 * 5) ConnectivityManager 网络状态监听：断网提示、恢复后若在离线页则自动重试，onDestroy 反注册；
 * 6) Android 12+ SplashScreen 与低版本 windowBackground 双轨，避免白/黑闪；
 * 7) 启动日志 + 轻量版本检查（GET /api/v1/meta），仅提示不强制升级、不下载 APK。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MixmAPP";
    private static final long EXIT_WINDOW_MS = 2000L;
    /** 与 capacitor.config.json 的 server.androidScheme: https 一致 */
    private static final String DEFAULT_LOCAL_ORIGIN = "https://localhost/";
    private static final String ACTION_SCHEME = "mixmapp-action";
    /** 首启隐私同意页（见 apps/app/src/pages.json / pages/legal/privacy.vue） */
    private static final String PRIVACY_GATE_PATH = "/pages/legal/privacy";
    private static final String PRIVACY_GATE_QUERY = "mode=gate";
    /** 壳层私有存储：设备号持久化（docs/39 §4），与既有 "mixmapp" 提示词 SP 隔离，互不污染。 */
    private static final String SHELL_PREFS_NAME = "mixmapp_shell";
    private static final String PREF_DEVICE_ID = "device_id";

    /**
     * 装在页面里的主题观察者：监听 <html> 上的 data-mx-theme 手动切换与
     * prefers-color-scheme 系统深浅变化，首帧自报一次给原生壳。
     * 与 docs/34 契约 §5 一致：原生系统栏图标明暗跟随页面实际主题，而不是只认系统 uiMode。
     */
    private static final String THEME_OBSERVER_JS =
            "(function(){if(window.__mxShellThemeBound)return;window.__mxShellThemeBound=true;"
            + "var root=document.documentElement;"
            + "function report(){try{"
            + "var t=root.getAttribute('data-mx-theme');"
            + "var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;"
            + "var manual=(t==='dark'||t==='light');"
            + "var v=manual?t:(dark?'dark':'light');"
            + "var src=manual?'manual':'system';"
            + "if(window.MixmShell&&window.MixmShell.notifyThemePref)MixmShell.notifyThemePref(v,src);"
            + "else if(window.MixmShell&&window.MixmShell.notifyTheme)MixmShell.notifyTheme(v);"
            + "}catch(e){}}"
            + "try{new MutationObserver(report).observe(root,{attributes:true,attributeFilter:['data-mx-theme']});}catch(e){}"
            + "if(window.matchMedia){var m=window.matchMedia('(prefers-color-scheme: dark)');"
            + "if(m.addEventListener)m.addEventListener('change',report);else if(m.addListener)m.addListener(report);}"
            + "report();})()";

    /** 品牌化离线页：深墨底 + 品牌青（#0f9d8f，见 apps/app/src/uni.scss $brand）。 */
    private static final String ERROR_PAGE_HTML =
            "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
            + "<title>MixmAPP</title><style>"
            + "*{box-sizing:border-box}html,body{margin:0;height:100%}"
            + "body{background:#0B0F0E;color:#F2F5F3;"
            + "font-family:-apple-system,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;"
            + "display:flex;align-items:center;justify-content:center;padding:24px}"
            + ".card{width:100%;max-width:340px;text-align:center}"
            + ".logo{display:inline-block;margin:0 auto 18px;padding:12px 20px 16px;border-radius:16px;"
            + "background:#F4F4F1;color:#111;font-size:20px;font-weight:800;letter-spacing:-.4px;line-height:1}"
            + ".logo i{display:block;height:2px;margin-top:8px;border-radius:1px;background:#0f9d8f}"
            + "h1{font-size:20px;margin:0 0 6px;letter-spacing:.5px}"
            + ".t{font-size:16px;margin:18px 0 6px}"
            + ".d{font-size:13px;line-height:1.7;color:#9AA7A2;margin:0 0 28px}"
            + "button{display:block;width:100%;padding:14px;border:0;border-radius:12px;"
            + "font-size:15px;margin-bottom:12px;cursor:pointer}"
            + ".primary{background:#0f9d8f;color:#fff;font-weight:600}"
            + ".ghost{background:transparent;color:#8fe9dd;border:1px solid #2A3A35}"
            + "</style></head><body><div class=\"card\">"
            + "<div class=\"logo\">MixmAPP<i></i></div><h1>MixmAPP</h1>"
            + "<p class=\"t\">网络开小差了</p>"
            + "<p class=\"d\">暂时无法连接到服务器。请检查网络设置后重试，或稍后再来。</p>"
            + "<button class=\"primary\" onclick=\"location.href='mixmapp-action://reload'\">重新加载</button>"
            + "<button class=\"ghost\" onclick=\"location.href='mixmapp-action://network-settings'\">检查网络设置</button>"
            + "</div></body></html>";

    private long lastBackPressedAt = 0L;
    /** 渲染进程崩溃后只自动重建一次，避免无限重建循环。 */
    private static boolean rendererRecreated = false;
    private String retryUrl = DEFAULT_LOCAL_ORIGIN;
    private boolean errorPageShown = false;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean networkWasLost = false;

    /**
     * 安全区契约（docs/34 §1）：原生壳是 --mx-safe-* / --mx-ime-bottom 四个变量的唯一来源。
     * 缓存最近一次 insets 回调算出的像素，页面加载完成后强制重推一次。
     */
    private int safeTop = 0;
    private int safeBottom = 0;
    private int safeRight = 0;
    private int imeBottom = 0;
    /** 上次已下发给 Web 的四元组；-1 表示尚未下发，避免 insets 抖动时重复 evaluateJavascript。 */
    private int lastPushedTop = -1;
    private int lastPushedBottom = -1;
    private int lastPushedRight = -1;
    private int lastPushedIme = -1;
    /** 页面自报主题："dark" / "light"；null 表示未自报，跟随系统 uiMode。 */
    private String webTheme = null;
    /** 自报来源：manual（页面手动偏好）/ system（系统跟随）/ null（尚未自报）。 */
    private String webThemeSource = null;
    /** 上次已识别的系统夜间模式，用于 onConfigurationChanged 去重，避免抖动重复推送。 */
    private boolean lastSystemNightSet = false;
    private boolean lastSystemNight = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // core-splashscreen 要求在任何 setContentView / setTheme 之前安装：此时读到的才是
        // manifest 里的 Launch 主题（Theme.SplashScreen）属性。Capacitor 的 BridgeActivity 会在
        // 自己的 onCreate 里 setTheme(AppTheme.NoActionBar)，与 postSplashScreenTheme 指向同一
        // 个主题，因此二者不冲突；低版本则由 windowBackground=@drawable/splash 兜底。
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        setupEdgeToEdge();
        applyOrientationPolicy();

        Log.i(TAG, "MixmAPP 启动｜versionName=" + BuildConfig.VERSION_NAME
                + " versionCode=" + BuildConfig.VERSION_CODE
                + " apiBase=" + BuildConfig.MIXMAPP_API_BASE);

        WebView webView = this.bridge.getWebView();
        String currentUrl = webView.getUrl();
        if (currentUrl != null && (currentUrl.startsWith("https://") || currentUrl.startsWith("http://"))) {
            retryUrl = currentUrl;
        }
        configureWebView(webView);
        applyWindowInsets(webView);

        // 继承 BridgeWebViewClient：只增补导航/错误/完成回调，
        // 不碰 shouldInterceptRequest（Capacitor 靠它把 https://localhost/* 映射到 assets/public）。
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (handleAppAction(uri)) return true;
                if (isLocal(uri)) {
                    return super.shouldOverrideUrlLoading(view, request);
                }
                return openExternally(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (handleAppAction(uri)) return true;
                if (isLocal(uri)) {
                    return super.shouldOverrideUrlLoading(view, url);
                }
                return openExternally(uri);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                // 只在「主框架」失败时接管；图片/CSS/接口等子资源失败交给 H5 自己降级，不弹全屏错误页。
                if (request.isForMainFrame() && isHttp(request.getUrl())) {
                    retryUrl = request.getUrl().toString();
                    showErrorPage(view);
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                // 仅接管主框架的 5xx（服务端异常）。404 不接管：Capacitor 本地服务会对 SPA 路由
                // 回落到 index.html，404 可能是合法的子资源，避免误伤。
                if (request.isForMainFrame() && isHttp(request.getUrl())
                        && errorResponse.getStatusCode() >= 500) {
                    retryUrl = request.getUrl().toString();
                    showErrorPage(view);
                }
            }

            /**
             * 渲染进程崩溃（OOM、内核被杀）时，系统会让整块 WebView 变白且不可再用。
             * 官方要求必须接管此回调；否则用户只能杀进程。
             */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView 渲染进程终止，didCrash="
                        + (detail != null && detail.didCrash()));
                if (view != null) {
                    ViewGroup parent = (ViewGroup) view.getParent();
                    if (parent != null) parent.removeView(view);
                    view.destroy();
                }
                if (!rendererRecreated) {
                    rendererRecreated = true;
                    Toast.makeText(MainActivity.this, R.string.renderer_recovering,
                            Toast.LENGTH_SHORT).show();
                    recreate();
                } else {
                    Toast.makeText(MainActivity.this, R.string.renderer_failed,
                            Toast.LENGTH_LONG).show();
                    finish();
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // 把原生版本号暴露给 H5，供「关于」页展示（无需引入任何插件）
                view.evaluateJavascript(
                        "window.__MIXMAPP_NATIVE_VERSION__=" + JSONObject.quote(BuildConfig.VERSION_NAME) + ";",
                        null);
                // 绑定主题观察者（手动 data-mx-theme 切换 / 系统深浅变化自报原生）
                view.evaluateJavascript(THEME_OBSERVER_JS, null);
                // 新文档的 CSS 变量已被重置，丢弃去重缓存后至少再推一次安全区
                lastPushedTop = -1;
                lastPushedBottom = -1;
                lastPushedRight = -1;
                lastPushedIme = -1;
                pushInsetsToWeb();
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackPressed();
            }
        });

        registerNetworkMonitoring();
        checkForUpdate();
    }

    @Override
    public void onDestroy() {
        // Capacitor BridgeActivity 的 onDestroy() 是 public，重写不能降低访问权限
        // （protected 会让 :app:compileReleaseJavaWithJavac 直接失败）。
        unregisterNetworkMonitoring();
        super.onDestroy();
    }

    // ── WebView 工程化配置 ────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private void configureWebView(WebView webView) {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);              // Capacitor 已开启，幂等，不破坏 Bridge
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);  // 有网走默认缓存；离线资源由 Capacitor 本地拦截提供
        ws.setUseWideViewPort(true);                // 让 <meta name="viewport">（含 viewport-fit=cover）生效
        ws.setLoadWithOverviewMode(false);
        // 放开双指缩放：H5 已移除 user-scalable=no，原生侧同名能力必须同步打开，
        // 否则系统无障碍「放大手势」在本应用内失效。
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        // 跟随系统字体大小（设置 → 显示 → 字体大小）。Activity 未拦截 fontScale 配置变更，
        // 系统调整字体会重建 Activity，此处重新读取即可生效。
        float fontScale = getResources().getConfiguration().fontScale;
        if (fontScale <= 0f) fontScale = 1f;
        ws.setTextZoom(Math.round(fontScale * 100f));
        // 与 capacitor.config.json 的 android.allowMixedContent:false 保持一致
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // UA 后缀，便于服务端/网关识别原生端（版本号来自 version.json → BuildConfig）
        String suffix = "MixmAPP/Android-" + BuildConfig.VERSION_NAME;
        String baseUa = ws.getUserAgentString();
        if (baseUa == null) baseUa = "";
        if (!baseUa.contains(suffix)) {
            ws.setUserAgentString((baseUa.trim() + " " + suffix).trim());
        }

        // H5 已落地真实深色主题（theme.scss 的 @media (prefers-color-scheme: dark)），
        // 由 CSS 变量精确控制每一处颜色。算法反色（force dark）会把已完成深色适配的页面
        // 再翻一次，导致品牌青发紫、图片被反相，因此必须保持关闭；深浅切换完全交给
        // prefers-color-scheme——它跟随系统 uiMode，Activity 已在 Manifest 中声明 configChanges。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ws.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ws.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);   // 禁掉边缘光晕，接近原生列表观感
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        // 壳层桥：只暴露主题自报一个方法，供页面观察者回调系统栏图标明暗；
        // 不暴露任何 URL / 导航能力，错误页按钮仍走既有自定义 scheme。
        webView.addJavascriptInterface(new ShellBridge(), "MixmShell");
        // 与页面底色同源（浅色 #F4F4F1 / 夜间 #121716），首帧渲染前不会出现白底闪屏
        webView.setBackgroundColor(resolveWindowBackground(isNightMode(getResources().getConfiguration())));
        // 硬件加速由 AndroidManifest 的 android:hardwareAccelerated="true" 提供；
        // 不额外 setLayerType(HARDWARE)，以免破坏 WebView 默认合成路径。
    }

    // ── 屏幕方向策略 ──────────────────────────────────────────────────────

    /**
     * H5 的尺寸单位是 rpx（按 750 设计稿等比换算），横屏手机（约 914dp 宽）会让 1rpx 从
     * 0.55px 跳到 1px，整页字号放大近两倍且内容被底部 tabBar 截断——实测见
     * outputs/screenshots/batch1-landscape.png。
     *
     * 因此：手机（smallestScreenWidthDp < 600）锁竖屏，与主流国产 App 一致；
     * 平板 / 展开态折叠屏交给系统自由旋转，此时 1rpx≈1px 正好匹配 750px 版心。
     * targetSdk 36 起系统会忽略大屏上的方向限制，也印证了这个划分。
     */
    private void applyOrientationPolicy() {
        boolean largeScreen = getResources().getConfiguration().smallestScreenWidthDp >= 600;
        setRequestedOrientation(largeScreen
                ? ActivityInfo.SCREEN_ORIENTATION_FULL_USER
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    // ── 系统栏 / 边到边 ──────────────────────────────────────────────────

    /**
     * 真 edge-to-edge：内容铺到状态栏/导航栏下方，系统栏透明，图标明暗跟随当前深浅色。
     * 取代 values-v35 的 windowOptOutEdgeToEdgeEnforcement（Android 16 起该开关已失效）。
     *
     * 四边安全区不在这里用 margin/padding 收缩视口，而是由 applyWindowInsets 把
     * 真实像素写进 --mx-safe-* / --mx-ime-bottom 变量，页面读变量自行留白（docs/34 §1）。
     */
    private void setupEdgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        applySystemBarAppearance();
        // 首帧基线记录系统夜间模式，避免后续首次 onConfigurationChanged 误判为变化。
        lastSystemNightSet = true;
        lastSystemNight = isNightMode(getResources().getConfiguration());
    }

    /**
     * 决定系统栏图标明暗与窗口底色，两处必须同源。
     *
     * 主题优先级（docs/34 §5）：页面自报的 data-mx-theme > 系统 uiMode。
     * 页面手动切深色时自报 "dark"，原生把状态栏/导航栏图标切浅色；自报 "light"
     * 则切深色图标；未自报（auto）才回落到跟随系统深浅。
     *
     * Manifest 的 android:configChanges 含 uiMode，切换深色时 Activity 不会重建，
     * 因此这个方法既在 onCreate 调用一次，也在 onConfigurationChanged 与主题回调里重放。
     */
    private void applySystemBarAppearance() {
        Window window = getWindow();
        boolean night = resolveNight();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!night);
        controller.setAppearanceLightNavigationBars(!night);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        window.setBackgroundDrawable(
                new ColorDrawable(resolveWindowBackground(night)));
    }

    /** 页面观察者回调：记录自报主题并重放系统栏外观（回调来自 WebView binder 线程，先切到 UI 线程）。 */
    private void applyWebTheme(String theme) {
        applyWebTheme(theme, "页面观察者");
    }

    /**
     * 记录自报主题与来源并重放系统栏外观。
     * source：manual（页面手动偏好）/ system（系统跟随）/ 原生推送来源标注，便于 logcat 取证。
     */
    private void applyWebTheme(String theme, String source) {
        webTheme = theme;
        webThemeSource = "manual".equals(source) ? "manual" : "system";
        Log.d(TAG, "页面主题自报：" + theme + "（" + source + "）");
        runOnUiThread(this::applySystemBarAppearance);
    }

    /**
     * 系统 uiMode 变化时，不依赖 WebView 派发 matchMedia change：原生直接比对
     * {@code uiMode & UI_MODE_NIGHT_MASK}，经桥把系统主题推给页面——写等价标记
     * {@code data-mx-system-theme}，并走与页面自报同一套 webTheme 通道驱动系统栏图标明暗。
     * 页面手动偏好（manual）不被系统切换覆盖；{@link #resolveNight()} 仅作首帧兜底。
     */
    private void pushSystemThemeOnConfig(Configuration newConfig) {
        boolean night = isNightMode(newConfig);
        if (lastSystemNightSet && lastSystemNight == night) return;
        lastSystemNightSet = true;
        lastSystemNight = night;
        if ("manual".equals(webThemeSource)) {
            Log.d(TAG, "系统 uiMode 切到 " + (night ? "dark" : "light") + "，页面为手动偏好，不覆盖");
            return;
        }
        String theme = night ? "dark" : "light";
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView != null) {
            String js = "(function(){try{var r=document.documentElement;"
                    + "r.setAttribute('data-mx-system-theme','" + theme + "');"
                    + "if(window.MixmShell&&window.MixmShell.notifyThemePref)window.MixmShell.notifyThemePref('"
                    + theme + "','system');}catch(e){}})()";
            webView.evaluateJavascript(js, null);
        }
        applyWebTheme(theme, "系统 uiMode 原生推送");
    }

    /** 兜底：仅在页面尚未自报主题（webTheme=null）的首帧/异常期回落系统 uiMode；正常路径由自报 webTheme 驱动。 */
    private boolean resolveNight() {
        if ("dark".equals(webTheme)) return true;
        if ("light".equals(webTheme)) return false;
        return isNightMode(getResources().getConfiguration());
    }

    /** 显式按深浅取壳层底色，避免手动主题与系统 uiMode 不一致时取到 night 资源回落值。 */
    private int resolveWindowBackground(boolean night) {
        return ContextCompat.getColor(this,
                night ? R.color.app_background_dark : R.color.app_background_light);
    }

    private static boolean isNightMode(Configuration config) {
        int mode = config.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 不依赖 WebView 派发 matchMedia change：原生比对 NIGHT_MASK，变化即把系统主题推给页面。
        pushSystemThemeOnConfig(newConfig);
        // Activity 未重建：必须手动重放系统栏/窗口底色，否则切到深色后仍是深色图标
        // 压在深底上（几乎不可见），窗口底色也停留在旧值。
        applySystemBarAppearance();
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(resolveWindowBackground(resolveNight()));
        }
        // 配置变化（横竖屏 / 深浅色）后 insets 可能重算，强制给新页面再推一次安全区。
        lastPushedTop = -1;
        lastPushedBottom = -1;
        lastPushedRight = -1;
        lastPushedIme = -1;
        pushInsetsToWeb();
    }

    /**
     * 注册系统栏 / 挖孔 / 输入法 insets 监听，把真实像素经 CSS 变量下发给 Web。
     *
     * 契约（docs/34 §1）：原生壳是 --mx-safe-top / --mx-safe-bottom / --mx-safe-right /
     * --mx-ime-bottom 四个变量的唯一来源。WebView 保持 edge-to-edge 全幅铺底，
     * 不再用父容器 margin 收缩视口——留白由页面读变量自行完成；旧版 margin 兜底是
     * H5 还不会读变量时的临时方案，与新壳层样式叠加会造成双重留白。
     *
     * - safeTop    = 状态栏与挖孔顶部取大；
     * - safeRight  = 系统栏与挖孔右侧取大（横屏刘海，竖屏一般 0）；
     * - safeBottom = 手势条 / 三键导航高度（键盘弹起不并入它，避免标签栏被顶高）；
     * - imeBottom  = 软键盘高度，未弹为 0，供 .mx-ime-pad 避让输入框。
     */
    private void applyWindowInsets(View view) {
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            safeTop = Math.max(bars.top, cutout.top);
            safeRight = Math.max(bars.right, cutout.right);
            safeBottom = Math.max(bars.bottom, cutout.bottom);
            imeBottom = ime.bottom;
            pushInsetsToWeb();
            return insets;
        });
        ViewCompat.requestApplyInsets(view);
    }

    /**
     * 把缓存的安全区像素写进 Web 根节点 CSS 变量；四元组未变化时跳过，
     * 避免 insets 反复回调造成重复 JS 求值。页面每次加载完成后由调用方重置
     * lastPushed* 再推一次，保证新文档拿到初始值。
     */
    private void pushInsetsToWeb() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView == null) return;
        if (safeTop == lastPushedTop && safeBottom == lastPushedBottom
                && safeRight == lastPushedRight && imeBottom == lastPushedIme) {
            return;
        }
        lastPushedTop = safeTop;
        lastPushedBottom = safeBottom;
        lastPushedRight = safeRight;
        lastPushedIme = imeBottom;
        Log.d(TAG, "安全区下发 top=" + safeTop + " bottom=" + safeBottom
                + " right=" + safeRight + " ime=" + imeBottom);
        String js = "(function(){try{var r=document.documentElement.style;"
                + "r.setProperty('--mx-safe-top','" + safeTop + "px');"
                + "r.setProperty('--mx-safe-bottom','" + safeBottom + "px');"
                + "r.setProperty('--mx-safe-right','" + safeRight + "px');"
                + "r.setProperty('--mx-ime-bottom','" + imeBottom + "px');"
                + "}catch(e){}})()";
        webView.evaluateJavascript(js, null);
    }

    // ── 离线错误页 ────────────────────────────────────────────────────────

    private void showErrorPage(WebView webView) {
        errorPageShown = true;
        // historyUrl 传 null：错误页不进历史栈，返回键不会退回一张永远加载失败的页面
        webView.loadDataWithBaseURL(DEFAULT_LOCAL_ORIGIN, ERROR_PAGE_HTML, "text/html", "UTF-8", null);
    }

    private void reloadMainFrame() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView == null) return;
        errorPageShown = false;
        webView.loadUrl(retryUrl != null ? retryUrl : DEFAULT_LOCAL_ORIGIN);
    }

    /** 错误页按钮走自定义 scheme；与主题桥 ShellBridge 互不混用，错误页不暴露任何 JS 接口能力。 */
    private boolean handleAppAction(Uri uri) {
        if (uri == null || !ACTION_SCHEME.equals(uri.getScheme())) return false;
        String host = uri.getHost();
        if ("reload".equals(host)) {
            reloadMainFrame();
        } else if ("network-settings".equals(host)) {
            openNetworkSettings();
        } else if ("exit".equals(host)) {
            // 首启隐私页「暂不同意 → 退出应用」：直接结束 Activity，不留在后台
            finish();
        }
        return true; // 吞掉所有 mixmapp-action:// 请求，绝不交给系统浏览器
    }

    private void openNetworkSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            } catch (ActivityNotFoundException ignored) {
                Toast.makeText(this, R.string.network_settings_unavailable, Toast.LENGTH_SHORT).show();
            }
        }
    }

    // ── 网络状态感知 ──────────────────────────────────────────────────────

    private void registerNetworkMonitoring() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // 注册当下若已有网络会立即回调一次，此时不提示，避免启动就弹 Toast
                if (!networkWasLost) return;
                networkWasLost = false;
                runOnUiThread(() -> {
                    if (errorPageShown) {
                        Toast.makeText(MainActivity.this, R.string.network_restored_retry,
                                Toast.LENGTH_SHORT).show();
                        reloadMainFrame();
                    } else {
                        Toast.makeText(MainActivity.this, R.string.network_restored,
                                Toast.LENGTH_SHORT).show();
                    }
                });
            }

            @Override
            public void onLost(Network network) {
                networkWasLost = true;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.network_lost,
                        Toast.LENGTH_SHORT).show());
            }
        };
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        try {
            // 用 registerNetworkCallback（API 21+）而非 registerDefaultNetworkCallback（API 24+），
            // 覆盖 minSdk 23
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            Log.w(TAG, "注册网络状态监听失败", e);
            networkCallback = null;
        }
    }

    private void unregisterNetworkMonitoring() {
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // 已反注册或系统状态变化时忽略
            }
        }
        networkCallback = null;
    }

    // ── 轻量版本检查 ──────────────────────────────────────────────────────

    /** 只提示、不强制升级、不下载 APK；任何异常都静默，绝不影响启动。 */
    private void checkForUpdate() {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(BuildConfig.MIXMAPP_API_BASE + "/meta");
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent", "MixmAPP/Android-" + BuildConfig.VERSION_NAME);
                if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return;
                JSONObject json = new JSONObject(readAll(conn.getInputStream()));
                JSONObject data = json.optJSONObject("data");
                String latest = firstNonEmpty(
                        json.optString("version", ""),
                        json.optString("versionName", ""),
                        json.optString("latest", ""),
                        data != null ? data.optString("version", "") : "");
                if (!isNewerVersion(latest, BuildConfig.VERSION_NAME)) return;
                // 每次启动都弹升级提示不像正常 App：同一版本 24h 内只提示一次
                if (promptedWithinDay()) return;
                markPrompted();
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        getString(R.string.update_available, latest), Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                Log.d(TAG, "版本检查跳过：" + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "mixmapp-version-check").start();
    }

    private static String readAll(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) {
            if (v != null && !v.isEmpty()) return v;
        }
        return "";
    }

    /**
     * 只按数字段比较，且跳过预发布版本（含 '-'，如 0.0.0.0-preview）。
     * 远端接口常返回构建号/预发布号，直接用 equals 判断会导致每次启动都提示升级。
     */
    private static boolean isNewerVersion(String remote, String local) {
        if (remote == null || local == null) return false;
        if (remote.indexOf('-') >= 0) return false;
        String[] a = remote.trim().split("\\.");
        String[] b = local.trim().split("\\.");
        int n = Math.max(a.length, b.length);
        for (int i = 0; i < n; i++) {
            int x = i < a.length ? parseIntSafe(a[i]) : 0;
            int y = i < b.length ? parseIntSafe(b[i]) : 0;
            if (x > y) return true;
            if (x < y) return false;
        }
        return false;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private boolean promptedWithinDay() {
        long last = getSharedPreferences("mixmapp", MODE_PRIVATE).getLong("update_prompted_at", 0L);
        return System.currentTimeMillis() - last < 24L * 60L * 60L * 1000L;
    }

    private void markPrompted() {
        getSharedPreferences("mixmapp", MODE_PRIVATE)
                .edit().putLong("update_prompted_at", System.currentTimeMillis()).apply();
    }

    // ── 返回键 ────────────────────────────────────────────────────────────

    private void handleBackPressed() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView == null) {
            finish();
            return;
        }
        if (errorPageShown) {
            // 离线页没有可用历史栈，直接走双击退出
            doubleBackToExit();
            return;
        }
        // 首启隐私同意页：未同意前不允许用返回键绕过门禁
        String currentUrl = webView.getUrl();
        if (currentUrl != null
                && currentUrl.contains(PRIVACY_GATE_PATH)
                && currentUrl.contains(PRIVACY_GATE_QUERY)) {
            Toast.makeText(this, R.string.privacy_consent_required, Toast.LENGTH_SHORT).show();
            return;
        }
        // WebView 自己的历史栈最可靠：pushState 条目也算在内，退到底后 canGoBack() 变 false
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // 兜底：tabBar 切换不产生 WebView 历史，此时「返回」应回到首页 tab，
        // 而不是直接弹「再按一次退出」——这是最不像原生 App 的一处。
        // uni-app H5 没有暴露全局 getCurrentPages，但路由是 history 模式，
        // 当前位置直接看 location.pathname 即可（实测 https://localhost/pages/mall/index）。
        webView.evaluateJavascript(
                "(function(){try{"
                        + "var p=location.pathname||'/';"
                        + "if(p==='/'||p.indexOf('/pages/index/index')===0)return 'home';"
                        + "history.replaceState(null,'','/pages/index/index');"
                        + "window.dispatchEvent(new PopStateEvent('popstate'));"
                        + "return 'routed';"
                        + "}catch(e){return 'err:'+e.message;}})()",
                result -> {
                    if (result == null || result.contains("home") || result.contains("err")) {
                        doubleBackToExit();
                    }
                });
    }

    private void doubleBackToExit() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < EXIT_WINDOW_MS) {
            finish();
            return;
        }
        lastBackPressedAt = now;
        Toast.makeText(this, R.string.press_back_again_to_exit, Toast.LENGTH_SHORT).show();
    }

    // ── 站外链接 ──────────────────────────────────────────────────────────

    /** 本地 H5 与 bridge 通信用到的地址，其余都算站外 */
    private boolean isLocal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        if ("file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme)) return true;
        if ("capacitor".equals(scheme)) return true;
        String host = uri.getHost();
        return "localhost".equals(host) || "127.0.0.1".equals(host);
    }

    private boolean isHttp(Uri uri) {
        String scheme = uri.getScheme();
        return "https".equals(scheme) || "http".equals(scheme);
    }

    private boolean openExternally(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser_for_link, Toast.LENGTH_SHORT).show();
            return true;
        }
    }

    /**
     * 壳层 JS 桥（addJavascriptInterface 名 MixmShell）。
     * 暴露主题自报与设备快照两个只读方法；不提供 URL 跳转 / 文件能力。
     * 方法必须 public 且带 {@link JavascriptInterface}，否则 WebView 侧调用不到。
     */
    private final class ShellBridge {
        @android.webkit.JavascriptInterface
        public void notifyTheme(String theme) {
            applyWebTheme(theme, "页面观察者");
        }

        /** 带来源的主题自报：source = manual（页面手动偏好）/ system（系统跟随）。 */
        @android.webkit.JavascriptInterface
        public void notifyThemePref(String theme, String source) {
            applyWebTheme(theme, source == null ? "页面观察者" : source);
        }

        /**
         * 设备与网络快照（docs/39 §4）。返回固定字段的 JSON 字符串：
         * {@code {"deviceId","model","osName","osVersion","networkType","carrier"}}。
         * 只读系统属性，不发网络请求、不申请权限；整个方法 try/catch，任何异常都返回
         * 字段完整的合法 JSON（空串 / none），绝不抛穿到 WebView 导致白屏。
         * 由 WebView binder 线程回调，读取均为同步轻量调用，不阻塞 UI 线程。
         */
        @android.webkit.JavascriptInterface
        public String getDeviceInfo() {
            try {
                JSONObject json = new JSONObject();
                json.put("deviceId", resolveDeviceId());
                json.put("model", safeDeviceString(Build.MODEL));
                json.put("osName", "Android");
                json.put("osVersion", safeDeviceString(Build.VERSION.RELEASE));
                json.put("networkType", resolveNetworkType());
                json.put("carrier", resolveCarrier());
                return json.toString();
            } catch (Exception e) {
                Log.w(TAG, "getDeviceInfo 兜底 JSON：" + e.getMessage());
                return fallbackDeviceJson();
            }
        }
    }

    // ── 设备与网络快照（docs/39 §4） ──────────────────────────────────────

    /**
     * 设备号：优先 {@link Settings.Secure#ANDROID_ID}；取不到（厂商定制 / 读取异常）时
     * 回落私有 SP 里的持久 UUID——首启生成后写回 {@link #SHELL_PREFS_NAME}，
     * 保证同一设备多次调用稳定不变。SP 也不可用时返回空串，不编造。
     */
    private String resolveDeviceId() {
        String androidId = "";
        try {
            androidId = Settings.Secure.getString(getContentResolver(),
                    Settings.Secure.ANDROID_ID);
            if (androidId != null) androidId = androidId.trim();
        } catch (Exception ignored) {
            androidId = "";
        }
        if (androidId != null && !androidId.isEmpty()) return androidId;

        try {
            SharedPreferences prefs = getSharedPreferences(SHELL_PREFS_NAME, MODE_PRIVATE);
            String uuid = prefs.getString(PREF_DEVICE_ID, "");
            if (uuid == null || uuid.isEmpty()) {
                uuid = UUID.randomUUID().toString();
                prefs.edit().putString(PREF_DEVICE_ID, uuid).apply();
            }
            return uuid;
        } catch (Exception e) {
            Log.w(TAG, "持久设备号读取失败：" + e.getMessage());
            return "";
        }
    }

    /**
     * 网络类型：API 23+ 走 {@link ConnectivityManager#getActiveNetwork()} +
     * {@link ConnectivityManager#getNetworkCapabilities(Network)}，按传输层映射；
     * 不使用已废弃的 {@code getType()} 唯一路径。无网 / 未知传输层一律 {@code none}。
     */
    private String resolveNetworkType() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "none";
            Network active = cm.getActiveNetwork();
            if (active == null) return "none";
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            if (caps == null) return "none";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        } catch (Exception e) {
            Log.w(TAG, "networkType 解析失败：" + e.getMessage());
        }
        return "none";
    }

    /**
     * 运营商：{@link TelephonyManager#getNetworkOperatorName()}；空 / 异常返回空串。
     * 本方法不申请 READ_PHONE_STATE：无权限时系统返回空串而非崩溃，外层 try/catch 兜底。
     */
    private String resolveCarrier() {
        try {
            TelephonyManager tm =
                    (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return "";
            String name = tm.getNetworkOperatorName();
            return name == null ? "" : name.trim();
        } catch (Exception e) {
            Log.w(TAG, "carrier 解析失败：" + e.getMessage());
            return "";
        }
    }

    /** 系统属性字符串归一化：null → 空串，去除首尾空白；不填「未知」假值。 */
    private static String safeDeviceString(String value) {
        return value == null ? "" : value.trim();
    }

    /** 全链路异常兜底：字段仍完整、JSON 仍合法；连 JSONObject 都不可用时给字面量保底。 */
    private static String fallbackDeviceJson() {
        try {
            JSONObject fallback = new JSONObject();
            fallback.put("deviceId", "");
            fallback.put("model", "");
            fallback.put("osName", "Android");
            fallback.put("osVersion", "");
            fallback.put("networkType", "none");
            fallback.put("carrier", "");
            return fallback.toString();
        } catch (Exception ignored) {
            return "{\"deviceId\":\"\",\"model\":\"\",\"osName\":\"Android\","
                    + "\"osVersion\":\"\",\"networkType\":\"none\",\"carrier\":\"\"}";
        }
    }
}
