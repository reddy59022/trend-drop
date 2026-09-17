#!/usr/bin/env bash
# Source this file before Android development:
#   source scripts/android-env.sh

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"

if [ -z "${JAVA_HOME:-}" ] && [ -d "$HOME/.local/share/trenddrop-toolchain/jdk-21/Contents/Home" ]; then
  export JAVA_HOME="$HOME/.local/share/trenddrop-toolchain/jdk-21/Contents/Home"
fi

if [ -z "${JAVA_HOME:-}" ] && command -v /usr/libexec/java_home >/dev/null 2>&1; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "TrendDrop requires Java 21. Set JAVA_HOME or install a JDK 21." >&2
  return 1 2>/dev/null || exit 1
fi

export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" = "$0" ]; then
  java -version
  adb version
  emulator -list-avds
fi
