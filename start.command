#!/bin/bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo; echo "Open this on your phone (same Wi-Fi):  http://$IP:3000"; echo
npm run dev
