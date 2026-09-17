#!/bin/bash
# start.sh - Linux/Mac startup script

echo ""
echo "============================================"
echo "  COGM Manufacturing BOM System"
echo "============================================"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "[ERROR] Node.js belum terinstall."
  echo "Install dengan: sudo apt install nodejs npm (Ubuntu)"
  echo "atau download dari: https://nodejs.org"
  exit 1
fi

echo "[OK] Node.js: $(node -v)"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Menginstall dependencies..."
  npm install
fi

# Create folders
mkdir -p public data data/backups

# Copy frontend if exists
if [ -f "bom-system.html" ]; then
  cp bom-system.html public/index.html
  echo "[OK] Frontend disalin ke public/index.html"
fi

# Get IP
IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Server berjalan di:"
echo "  Local  : http://localhost:3001"
echo "  Network: http://$IP:3001"
echo ""
echo "Tekan Ctrl+C untuk berhenti."
echo "============================================"
echo ""

node server.js
