#!/bin/bash
# Rebuild Android APK script
# Usage: ./rebuild-android.sh

set -e

export JAVA_HOME="/Users/owner/jdk/jdk-21.0.12+8/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd /Users/owner/Desktop/trend-drop/client
npm run build
npx cap copy android

cd android
./gradlew clean assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo "✅ APK rebuilt: $(ls -lh $APK_PATH | awk '{print $5}')"
  echo "📁 Path: $PWD/$APK_PATH"
else
  echo "❌ APK build failed"
  exit 1
fi
