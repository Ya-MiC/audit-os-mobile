package com.yanming.auditos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 湛箴采集端壳（v0.4）。
 *
 * 设计边界（ENGINEERING_SPEC §6.1）：Android 只做 拍照/队列/导出/查看，
 * 不在手机跑 OCR 大模型与完整规则引擎。
 *
 * 相机策略：调用系统相机（android.media.action.IMAGE_CAPTURE，作业帮式
 * "对准就拍"），不申请 CAMERA 权限——把拍摄交给用户已信任的相机应用，
 * 本 App 只接收结果。开源规范：不重复造系统已有能力。
 *
 * 数据安全：无 INTERNET 权限即无外发通道；照片留在应用私有目录与
 * WebView localStorage 队列中，直到用户手动导出采集包（总纲 §23）。
 */
public class MainActivity extends Activity {

    private static final int REQ_CAMERA = 4101;

    private WebView web;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
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
        web.setBackgroundColor(0xFFF5F2EA);
        web.addJavascriptInterface(new Bridge(), "ZhanZhenBridge");
        web.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_BACK
                    && web.canGoBack()) {
                web.goBack();
                return true;
            }
            return false;
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    /** JS 侧 window.ZhanZhenBridge.openCamera() */
    public class Bridge {
        @JavascriptInterface
        public void openCamera() {
            Intent it = new Intent("android.media.action.IMAGE_CAPTURE");
            if (it.resolveActivity(getPackageManager()) != null) {
                startActivityForResult(it, REQ_CAMERA);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAMERA && resultCode == RESULT_OK) {
            web.post(() -> web.evaluateJavascript(
                "document.getElementById('album').click()", null));
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
