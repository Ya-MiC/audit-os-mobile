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

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 湛箴采集端壳（v0.5）。
 *
 * 设计边界（ENGINEERING_SPEC §6.1）：Android 只做 拍照/队列/导出/查看，
 * 不在手机跑 OCR 大模型与完整规则引擎。
 *
 * 相机策略：调用系统相机（android.media.action.IMAGE_CAPTURE，作业帮式
 * "对准就拍"），不申请 CAMERA 权限——把拍摄交给用户已信任的相机应用，
 * 本 App 只接收结果。开源规范：不重复造系统已有能力。
 *
 * 数据安全（v0.5 双轨）：默认仍是纯离线——拍照、队列、导出采集包全程
 * 不出网；只有用户在网页设置里填好服务器地址并主动点「☁️直接上传」时，
 * Bridge.uploadPack 才向该地址 POST /v1/vouchers/capture-batch（头
 * X-API-Key）。服务器地址与 API Key 只存 WebView localStorage，本壳不落
 * 任何明文配置文件。服务端重算 SHA-256，不信客户端哈希（spec §4.2）。
 */
public class MainActivity extends Activity {

    private static final int REQ_CAMERA = 4101;

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 60_000;   // 照片 base64 包可能很大

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

        /**
         * v0.5 直传：JS 侧 window.ZhanZhenBridge.uploadPack(baseUrl, apiKey, payloadJson)
         *   POST {baseUrl}/v1/vouchers/capture-batch，请求头 X-API-Key: apiKey，
         *   body = payloadJson（{"items":[{filename, content_b64, captured_at, note}]}）。
         * 完成后回调 window.__zzUploadDone(response)：response 为服务器返回的 JSON
         * 对象（成功 {"ingested":n,"vouchers":[...]} 或错误信封 {code,message}；
         * 网络异常时回传 code=network_error 信封），保证回调恰好一次。
         */
        @JavascriptInterface
        public void uploadPack(String baseUrl, String apiKey, String payloadJson) {
            // 网络不能在 UI 线程做（NetworkOnMainThreadException）
            new Thread(() -> {
                String resp = doUpload(baseUrl, apiKey, payloadJson);
                String js = "(window.__zzUploadDone||function(){})(JSON.parse("
                        + jsString(resp) + "))";
                web.post(() -> web.evaluateJavascript(js, null));
            }, "zz-upload").start();
        }
    }

    /** 同步上传；任何失败都折成一个 JSON 错误信封字符串返回，绝不抛出。 */
    private String doUpload(String baseUrl, String apiKey, String payloadJson) {
        HttpURLConnection conn = null;
        try {
            String base = (baseUrl == null ? "" : baseUrl.trim());
            if (base.isEmpty()) {
                return "{\"code\":\"config_missing\",\"message\":\"未配置服务器地址\"}";
            }
            while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            URL url = new URL(base + "/v1/vouchers/capture-batch");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-API-Key", apiKey == null ? "" : apiKey);
            byte[] body = (payloadJson == null ? "" : payloadJson)
                    .getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
                os.flush();
            }
            int status = conn.getResponseCode();
            InputStream is = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
            String text = readAll(is);
            // 非 JSON 响应也折成信封，保证网页端拿到的恒为可 parse 的 JSON
            String trimmed = text == null ? "" : text.trim();
            if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
                return "{\"code\":\"bad_response\",\"message\":\"HTTP "
                        + status + ": 非JSON响应\","
                        + "\"details\":{\"http_status\":" + status + "}}";
            }
            return trimmed;
        } catch (Exception e) {
            String msg = String.valueOf(e.getMessage()).replace("\"", "'");
            return "{\"code\":\"network_error\",\"message\":\"" + msg + "\"}";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
        }
        return sb.toString();
    }

    /** 把任意字符串变成安全的双引号 JS 字符串字面量（供 evaluateJavascript 用）。 */
    private static String jsString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':  sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
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
