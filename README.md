# 晏铭湛箴 Audit OS — 移动端（APK）

> 中小企业智能审计 · 手机版骨架 v0.2
> 战略上游：[Ya-MiC/action-tree](https://github.com/Ya-MiC/action-tree) 总纲 §26/§34
> 服务端/CLI 参考实现：[Ya-MiC/audit-os](https://github.com/Ya-MiC/audit-os)

## 📱 直接安装测试

1. 在本页 **Releases**（右侧栏）下载 `audit-os-v0.2.apk`
2. 传到手机（微信文件传输助手/QQ/数据线均可），点开安装
3. 系统提示"未知来源"时允许一次即可（自签名 APK，未上架商店的正常提示）
4. 打开「审计OS」→ 点 **▶ 载入示例账套并分析** → 看风险报告

- 兼容 Android 7.0 ~ 15（minSdk 24 / targetSdk 34）
- 约 50KB；**不需要任何权限**——没有网络权限，数据物理上出不了手机
- 点「📂 导入 CSV 账套」可以用你自己的真实凭证表测试（格式见 App 内说明）

## 这个软件是什么

审计 OS 的**移动端骨架**：把总纲定义的 MVP 链路完整跑在手机本地。

```
导入凭证CSV → SHA-256证据锁定 → 数据质量检查(DQ) → 12条审计规则引擎 → 风险报告(每条带证据链)
```

| 层 | 实现 | 对应文档 |
|---|---|---|
| 规则引擎 R001~R012 | `assets/www/app.js`（与 audit-os Python 版同一套语义） | action-tree docs/05 |
| 标准科目映射 | 别名词典+模糊匹配，置信度<0.75 标记未映射 | docs/03 |
| 数据质量门 DQ-001~005 | 重复/未映射科目/借贷不平/期间外 | docs/03 §8 |
| 证据哈希链 | 文件入库即算 SHA-256，报告页展示证据基准 | docs/07 |
| 人机边界 | 报告为分析初稿，不构成审计意见 | 总纲 §22 |

## 工程结构

```
├── AndroidManifest.xml        壳配置(无网络权限=无数据外发通道)
├── java/.../MainActivity.java WebView 壳(约60行, 加载本地资产)
├── assets/www/
│   ├── index.html             三段式UI: 质量→风险→追溯
│   ├── app.js                 ★ 核心: CSV解析+科目映射+DQ检查+12条规则引擎
│   ├── sha256.js              纯JS SHA-256(证据链)
│   └── app.css                移动端样式
├── res/                       图标(mipmap-mdpi~xxhdpi)
└── build.sh                   无Gradle构建脚本(aapt2→javac→d8→zipalign→apksigner)
```

### 自检结果（Node 跑同一份 app.js）

示例账套植入全部异常类型，引擎命中验证：

```
vouchers: 432 | events: 83 | missing_rules: []   ← 12类异常全被对应规则捕获
R001 期末突击收入 ✓  R002 大额交易(36条含股东150万往来) ✓  R003 红字成本 ✓
R004 应收122% ✓  R005 毛利率偏离91.7% vs 32.1% ✓  R006 关联方对挂 ✓
R007 供应商90%集中 ✓  R010 周末大额 ✓  R011 重复交易 ✓  R012 冲销回转 ✓
```

## 自己构建

```bash
# 需要: JDK17 + Android build-tools 34 + android-34 platform (无需Gradle/AndroidStudio)
bash build.sh
# 产物: build/audit-os-v0.2.apk
```

Windows 一键环境替代方案：装 Android Studio 后 `Build > Build APKs` 导入本目录亦可。

## 下一步（按总纲路线图）

- v0.3: 发票表/银行流水表导入 → R008/R009 启用（当前 CSV 单表版仅内置10条可触发规则）
- v0.4: 报告导出(PDF分享) + 项目多账套管理
- v0.5: 与服务端同步（可选，默认仍全离线）
