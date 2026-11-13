package top.mixm.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * MixmAPP 原生壳。
 *
 * 只做两件 Capacitor 默认行为兜不住的事：
 * 1) 站外链接不接管：壳的 WebView 只负责本地 H5（https://localhost），
 *    OAuth 授权页、支付页、帮助文档这类站外地址交给系统浏览器，避免壳被导航走后再也回不来。
 * 2) 返回键：交给 H5 的 history 退栈（uni-app 用 pushState 记路由，WebView.canGoBack()
 *    对 pushState 条目并不总是为真，所以统一用 history.back() 判断）；
 *    退到根部时按 Android 习惯「再按一次退出」，而不是一按就杀掉。
 *
 * 注意：Android 15+ 对 targetSdk 35 默认开启预测性返回，Activity.onBackPressed() 不再被调用，
 * 必须走 OnBackPressedDispatcher，否则返回键完全失效。
 */
public class MainActivity extends BridgeActivity {

    private static final long EXIT_WINDOW_MS = 2000L;
    private long lastBackPressedAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) {
                    return super.shouldOverrideUrlLoading(view, request);
                }
                return openExternally(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isLocal(uri)) {
                    return super.shouldOverrideUrlLoading(view, url);
                }
                return openExternally(uri);
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackPressed();
            }
        });
    }

    private void handleBackPressed() {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView == null) {
            finish();
            return;
        }
        // WebView 自己的历史栈最可靠：pushState 条目也算在内，退到底后 canGoBack() 变 false
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // 兜底：极少数情况下浏览器历史没记，但 H5 自己的页面栈还在
        webView.evaluateJavascript(
                "(function(){try{var p=(window.uni&&window.uni.getCurrentPages)?uni.getCurrentPages():[];"
                        + "if(p&&p.length>1){uni.navigateBack();return 'stack';}}catch(e){}return 'root';})()",
                result -> {
                    if (result != null && result.contains("stack")) return;
                    long now = System.currentTimeMillis();
                    if (now - lastBackPressedAt < EXIT_WINDOW_MS) {
                        finish();
                        return;
                    }
                    lastBackPressedAt = now;
                    Toast.makeText(this, R.string.press_back_again_to_exit, Toast.LENGTH_SHORT).show();
                });
    }

    /** 本地 H5 与 bridge 通信用到的地址，其余都算站外 */
    private boolean isLocal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        if ("file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme)) return true;
        if ("capacitor".equals(scheme)) return true;
        String host = uri.getHost();
        return "localhost".equals(host) || "127.0.0.1".equals(host);
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
}
