#!/bin/bash
# Rebuild Android APK script (portable — auto-detects repo root and JDK 21+)
# Usage: ./rebuild-android.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Pick a JDK >= 21 (required by Capacitor 7's Android library)
if command -v /usr/libexec/java_home >/dev/null 2>&1; then
  JDK21="$(/usr/libexec/java_home -v 21+ 2>/dev/null || true)"
  [ -n "$JDK21" ] && export JAVA_HOME="$JDK21"
fi
if [ -z "$JAVA_HOME" ] || [ "$(java -version 2>&1 | head -1 | grep -o '[0-9]\+' | head -1)" -lt 21 ]; then
  echo "⚠️  JDK 21+ not found — Capacitor 7 requires it (invalid source release: 21 otherwise)" >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd "$REPO_ROOT/client"
npm run build
npx cap copy android

cd android
./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo "✅ APK rebuilt: $(ls -lh $APK_PATH | awk '{print $5}')"
  echo "📁 Path: $PWD/$APK_PATH"
else
  echo "❌ APK build failed"
  exit 1
fi
