#!/bin/bash
# Audit OS APK 构建脚本 (无Gradle, 直接调用构建工具链)
set -e
TC="$HOME/android/toolchain"
X="$TC/x"
BT=$(ls -d $X/android-14 2>/dev/null || ls -d $X/*build-tools*/ | head -1)   # bt34.zip 解压根
JDK="$TC/jdk"
PLAT="$X/android-34/android.jar"
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$SRC/build"
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

export PATH="$TC/jdk/bin:$PATH"
echo "[1/6] aapt2 编译链接资源..."
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" \
  -I "$PLAT" \
  --manifest "$SRC/AndroidManifest.xml" \
  -R "$OUT/res.zip" \
  --java "$OUT/gen" --auto-add-overlay

echo "[2/6] javac 编译 Java..."
"$JDK/bin/javac" --release 11 \
  -classpath "$PLAT" \
  -d "$OUT/classes" \
  "$SRC/java/com/yanming/auditos/MainActivity.java" \
  "$OUT/gen/com/yanming/auditos/R.java"

echo "[3/6] d8 转 dex..."
"$BT/d8" --release --lib "$PLAT" --min-api 24 \
  --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "[4/6] 打包 assets + classes.dex..."
python3 - "$OUT" "$SRC" <<'PYEOF'
import sys, zipfile, os
out, src = sys.argv[1], sys.argv[2]
apk = os.path.join(out, "base.apk")
with zipfile.ZipFile(apk, "a") as z:
    z.write(os.path.join(out, "dex", "classes.dex"), "classes.dex")
    for root, _, files in os.walk(os.path.join(src, "assets")):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
print("packed", apk)
PYEOF

echo "[5/6] zipalign..."
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/audit-os-v0.2-aligned.apk"

echo "[6/6] apksigner 签名..."
KS="$OUT/debug.keystore"
if [ ! -f "$KS" ]; then
  "$JDK/bin/keytool" -genkeypair -keystore "$KS" -storepass auditos -keypass auditos \
    -alias auditos -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Audit OS Debug, OU=Yanming, O=Yanming Zhenzhen, C=CN"
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:auditos --key-pass pass:auditos \
  --out "$OUT/audit-os-v0.2.apk" "$OUT/audit-os-v0.2-aligned.apk"

"$BT/aapt" dump badging "$OUT/audit-os-v0.2.apk" | head -5
ls -la "$OUT"/*.apk
echo "BUILD OK"
