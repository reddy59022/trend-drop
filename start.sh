#!/bin/bash

# TrendDrop - Local Development Script
# Starts all platforms: Backend, Web, iOS Simulator, Android Emulator
# All platforms point to local backend server at http://localhost:5000

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo "${CYAN}║          TrendDrop - Local Dev Server        ║${NC}"
echo "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if node is installed
if ! command -v node &> /dev/null; then
  echo "${RED}Error: Node.js is not installed.${NC}"
  echo "Install from: https://nodejs.org/"
  exit 1
fi

echo "${YELLOW}Step 1: Checking dependencies...${NC}"

# Install server dependencies if needed
if [ ! -d "server/node_modules" ]; then
  echo "${BLUE}Installing server dependencies...${NC}"
  cd server && npm install && cd ..
fi

# Install client dependencies if needed
if [ ! -d "client/node_modules" ]; then
  echo "${BLUE}Installing client dependencies...${NC}"
  cd client && npm install && cd ..
fi

echo "${GREEN}✓ Dependencies ready${NC}"
echo ""

# ===========================
# Start Backend Server (port 5000)
# ===========================
echo "${YELLOW}Step 2: Starting backend server on port 5000...${NC}"
# Ensure any existing process on the backend port is terminated
if lsof -ti:5000 >/dev/null 2>&1; then
  echo "${RED}Killing existing process on port 5000...${NC}"
  kill $(lsof -ti:5000) || true
fi
cd "$SCRIPT_DIR/server"
node server.js &
SERVER_PID=$!
cd "$SCRIPT_DIR"
echo "${GREEN}✓ Backend server started (PID: $SERVER_PID)${NC}"
echo ""
# Wait briefly for the server to become ready
sleep 2
# Verify the backend is still running
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "${RED}Error: Backend server failed to start.${NC}"
  echo "Make sure MongoDB is running locally or MONGO_URI is configured in server/.env"
  exit 1
fi

# ===========================
# Start React Dev Server (port 3000)
# ===========================
echo "${YELLOW}Step 3: Starting React web dev server on port 3000...${NC}"
# Ensure any existing process on the frontend port is terminated
if lsof -ti:3000 >/dev/null 2>&1; then
  echo "${RED}Killing existing process on port 3000...${NC}"
  kill $(lsof -ti:3000) || true
fi
cd "$SCRIPT_DIR/client"
BROWSER=none PORT=3000 npx react-scripts start &
WEB_PID=$!
cd "$SCRIPT_DIR"
echo "${GREEN}✓ Web dev server started (PID: $WEB_PID)${NC}"
echo ""

# ===========================
# Start Android Emulator (if available)
# ===========================
ANDROID_PID=""
if command -v adb &> /dev/null; then
  echo "${YELLOW}Step 4: Starting Android emulator...${NC}"

  # Check if an emulator is already running
  RUNNING_EMU=$(adb devices | grep -w "device" | head -1 | awk '{print $1}')

  if [ -z "$RUNNING_EMU" ]; then
    # Try to start an available emulator
    AVD=$(emulator -list-avds 2>/dev/null | head -1)
    if [ -n "$AVD" ]; then
      echo "${BLUE}Starting Android emulator: $AVD${NC}"
      emulator -avd "$AVD" -no-snapshot-load &
      ANDROID_PID=$!
      echo "${GREEN}✓ Android emulator starting (PID: $ANDROID_PID)${NC}"
    else
      echo "${YELLOW}⚠ No Android emulators found. Create one in Android Studio > AVD Manager.${NC}"
    fi
  else
    echo "${GREEN}✓ Android emulator already running ($RUNNING_EMU)${NC}"
  fi
else
  echo "${YELLOW}⚠ Android SDK not found. Skipping Android emulator.${NC}"
fi
echo ""

# ===========================
# Start iOS Simulator (if available, macOS only)
# ===========================
IOS_PID=""
if [[ "$OSTYPE" == "darwin"* ]]; then
  if command -v xcrun &> /dev/null; then
    echo "${YELLOW}Step 5: Starting iOS simulator...${NC}"

    # Check if a simulator is already running
    RUNNING_SIM=$(xcrun simctl list devices booted 2>/dev/null | grep "Booted" | head -1)

    if [ -z "$RUNNING_SIM" ]; then
      # Find an iPhone simulator
      DEVICE_ID=$(xcrun simctl list devices available 2>/dev/null | grep "iPhone" | grep -v "unavailable" | head -1 | sed 's/.*(\([A-Z0-9-]*\)).*/\1/')
      if [ -n "$DEVICE_ID" ]; then
        echo "${BLUE}Starting iOS simulator...${NC}"
        xcrun simctl boot "$DEVICE_ID" &
        IOS_PID=$!
        echo "${GREEN}✓ iOS simulator starting${NC}"
      else
        echo "${YELLOW}⚠ No iOS simulators available. Install via Xcode > Settings > Platforms.${NC}"
      fi
    else
      echo "${GREEN}✓ iOS simulator already running${NC}"
    fi
  else
    echo "${YELLOW}⚠ Xcode not found. Install Xcode for iOS development.${NC}"
  fi
else
  echo "${YELLOW}⚠ iOS development requires macOS. Skipping iOS simulator.${NC}"
fi
echo ""

# ===========================
# Summary
# ===========================
echo ""
echo "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo "${CYAN}║              All Platforms Running!                  ║${NC}"
echo "${CYAN}╠══════════════════════════════════════════════════════╣${NC}"
echo "${CYAN}║                                                      ║${NC}"
echo "${GREEN}║  Backend API:  http://localhost:5000                  ║${NC}"
echo "${GREEN}║  Web App:      http://localhost:3000                  ║${NC}"
if [ -n "$ANDROID_PID" ] || command -v adb &> /dev/null; then
echo "${GREEN}║  Android:      Running on emulator (port 8100)       ║${NC}"
fi
if [[ "$OSTYPE" == "darwin"* ]] && command -v xcrun &> /dev/null; then
echo "${GREEN}║  iOS:          Running on simulator (port 8100)      ║${NC}"
fi
echo "${CYAN}║                                                      ║${NC}"
echo "${CYAN}║  All platforms → http://localhost:5000 (backend)     ║${NC}"
echo "${CYAN}║                                                      ║${NC}"
echo "${CYAN}║  Press Ctrl+C to stop all servers                    ║${NC}"
echo "${CYAN}║                                                      ║${NC}"
echo "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ===========================
# Cleanup on exit
# ===========================
cleanup() {
  echo ""
  echo "${YELLOW}Shutting down all servers...${NC}"

  if [ -n "$SERVER_PID" ]; then
    kill $SERVER_PID 2>/dev/null && echo "${RED}✓ Backend server stopped${NC}"
  fi

  if [ -n "$WEB_PID" ]; then
    kill $WEB_PID 2>/dev/null && echo "${RED}✓ Web dev server stopped${NC}"
  fi

  if [ -n "$ANDROID_PID" ]; then
    echo "${YELLOW}Android emulator still running. Close it manually or run: adb emu kill${NC}"
  fi

  if [ -n "$IOS_PID" ]; then
    xcrun simctl shutdown all 2>/dev/null && echo "${RED}✓ iOS simulator stopped${NC}"
  fi

  echo "${GREEN}All servers stopped. Goodbye!${NC}"
  exit 0
}

# Trap Ctrl+C and cleanup
trap cleanup SIGINT SIGTERM

# Keep script running and wait for background processes
wait