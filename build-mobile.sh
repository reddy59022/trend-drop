#!/bin/bash
# Build script for iOS and Android platforms
# Usage: ./build-mobile.sh [ios|android|both]

set -e

PLATFORM=${1:-both}
CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)/client"
JAVA_HOME_21="/Users/owner/jdk/jdk-21.0.12+8/Contents/Home"
ANDROID_HOME="$HOME/Library/Android/sdk"
RUBY_PATH="/usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin:/Users/owner/.gem/ruby/4.0.0/bin"

build_android() {
  echo "🔨 Building Android..."
  export JAVA_HOME="$JAVA_HOME_21"
  export ANDROID_HOME="$ANDROID_HOME"
  export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
  
  cd "$CLIENT_DIR"
  npm run build
  npx cap sync android
  
  cd android
  ./gradlew assembleDebug
  
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$APK_PATH" ]; then
    echo "✅ Android APK built: $(ls -lh $APK_PATH | awk '{print $5}')"
  else
    echo "❌ Android APK build failed"
    exit 1
  fi
}

build_ios() {
  echo "🔨 Building iOS (Swift)..."
  export PATH="$RUBY_PATH:$PATH"
  export LANG=en_US.UTF-8
  
  cd "$CLIENT_DIR"
  npm run build
  npx cap copy ios
  
  cd ios/App
  pod install
  
  echo "✅ iOS project ready (Swift-based)"
  echo "📌 Open ios/App/App.xcworkspace in Xcode to build and run"
  echo "⚠️  Full Xcode.app is required to compile the iOS app"
}

case "$PLATFORM" in
  android)
    build_android
    ;;
  ios)
    build_ios
    ;;
  both)
    build_android
    build_ios
    ;;
  *)
    echo "Usage: $0 [ios|android|both]"
    exit 1
    ;;
esac

echo ""
echo "📱 Mobile build complete!"
