# 湛箴采集端（Android）— audit-os-mobile v0.5

> 正名「湛箴」；🐙 是吉祥物符号，OZ 仅内部代号。
> 上游：[action-tree](https://github.com/Ya-MiC/action-tree) ENGINEERING_SPEC §6（客户端规范）。

## 定位（spec §1：Android 只做四件事）

**拍照/相册 → 本地加密队列 → 导出/上传采集包 → 查看状态**

- ❌ 不在手机跑完整规则引擎/OCR 大模型（spec §14 非目标）
- ✅ 每张照片生成 UUID + 本地 SHA-256 + captured_at，原始照片保留到服务端确认
- ✅ 默认纯离线；联网只发生在用户主动点「☁️直接上传」那一刻

## v0.5 新增：联网直传（双轨）

| 功能 | 说明 |
|---|---|
| ⚙️ 服务器设置 | 工作台地址 + API Key，只存本机 WebView localStorage，不入包、不上传 |
| ☁️ 直接上传到工作台 | 壳层 `Bridge.uploadPack` 直连 `POST {地址}/v1/vouchers/capture-batch`（请求头 `X-API-Key`），结果回显每张凭证的 `voucher_id` |
| 📦 导出采集包 | 沿用 v0.4 离线路径，与云端直传并存（同一采集包结构 `zhanzhen-capture`） |

### 两种模式

1. **纯离线模式**：不填服务器设置 → 拍照、队列、`📦 导出采集包` 全程不出网，
   采集包靠人工拷到 Windows 工作台导入。适合涉密/无网现场。
2. **联服务器模式（专业版直连）**：在「⚙️ 服务器设置」里填好工作台地址与
   API Key 后，点 `☁️ 直接上传到工作台` 即把整个采集队列 POST 给服务器，
   免去文件中转；API Key 随每次请求附于 `X-API-Key` 头（多用户部署必填，
   单机模式可留空）。测试环境允许 http（manifest 已开 `usesCleartextTraffic`），
   生产请用 https。

两种模式共用同一采集包结构，随时可混用：先直传一部分、再导出一部分均可。

## 与桌面端配合（工作流）

```
手机拍照（本 App）──┬── 📦 导出采集包 ──► 人工拷贝 ──► Windows 湛箴工作台 ──┐
                    └── ☁️ 直接上传 ──────► POST /v1/vouchers/capture-batch ─┤
                                                            ▼ (Ya-MiC/zhanzhen)
                                              OCR → 覆核 → 序时账 → 规则 → 报告
```

安全边界不变：服务端重算 SHA-256，不信客户端哈希（spec §4.2）；本 App 只做
采集与传输，不做识别与记账。

## 构建

WebView 壳方案（无需 Android Studio）：`bash build.sh`（aapt2+d8+apksigner），
产物 `dist/` 下 APK（versionName 0.5 / versionCode 5，含 INTERNET 权限）。
Flutter 化另立 ADR（spec §6.2）。

## 图标

沿用 v0.3 红金三峰图标（米白底+审计勾基因）；新章鱼图标由创始人后续定稿换装。
