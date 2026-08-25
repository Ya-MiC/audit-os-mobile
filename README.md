# 湛箴采集端（Android）— audit-os-mobile v0.4

> 正名「湛箴」；🐙 是吉祥物符号，OZ 仅内部代号。
> 上游：[action-tree](https://github.com/Ya-MiC/action-tree) ENGINEERING_SPEC §6（客户端规范）。

## 定位（spec §1：Android 只做四件事）

**拍照/相册 → 本地加密队列 → 导出采集包 → 查看状态**

- ❌ 不在手机跑完整规则引擎/OCR 大模型（spec §14 非目标）
- ✅ 每张照片生成 UUID + 本地 SHA-256 + captured_at，原始照片保留到服务端确认
- ✅ 全程离线可用；无网络权限的 WebView 版保留为 demo

## v0.4 新增

| 功能 | 说明 |
|---|---|
| 📷 拍照采集 | Camera Intent 调系统相机（作业帮式"对准就拍"），照片入本地队列 |
| 🗂 采集队列 | localStorage 队列：UUID/SHA-256/拍摄时间/备注，逐条可删可注 |
| 📦 采集包导出 | 一键打包 `zhanzhen-capture-<日期>.json`（含 base64 照片+元数据）|
| 🔁 状态回看 | 导入服务端回执 JSON 显示每张凭证的处理状态 |

## 与桌面端配合（工作流）

```
手机拍照（本 App）──导出采集包──► Windows 湛箴工作台（Ya-MiC/zhanzhen）
                                        │ POST /v1/vouchers/capture-batch
                                        ▼
                              OCR → 覆核 → 序时账 → 规则 → 报告
```

## 构建

WebView 壳方案（无需 Android Studio）：`bash build.sh`（aapt2+d8+apksigner），
产物 `dist/zhanzhen-mobile-v0.4.apk`。Flutter 化另立 ADR（spec §6.2）。

## 图标

沿用 v0.3 红金三峰图标（米白底+审计勾基因）；新章鱼图标由创始人后续定稿换装。
