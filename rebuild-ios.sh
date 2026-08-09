#!/bin/bash
# Rebuild iOS project (Swift-based)
# Usage: ./rebuild-ios.sh
# Requires: Xcode.app installed

set -e

CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)/client"
RUBY_PATH="/usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin:/Users/owner/.gem/ruby/4.0.0/bin"

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
  echo "🔧 Xcode will compile the app for iOS simulators or devices"
}

build_ios
