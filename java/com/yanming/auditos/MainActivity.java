package com.yanming.auditos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 晏铭湛箴 Audit OS 移动端壳。
 * 全部审计逻辑(12条规则引擎+SHA-256证据链)在 assets/www 内离线运行,
 * 数据不出设备; 无网络权限即无外发通道 — 对应总纲§23数据安全最低标准。
 */
public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.setBackgroundColor(0xFFF4F6F9);
        // 返回键由网页内历史接管
        web.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() == android.view.KeyEvent.ACTION_DOWN && keyCode == 4 /*KEYCODE_BACK*/
                    && web.canGoBack()) {
                web.goBack();
                return true;
            }
            return false;
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
