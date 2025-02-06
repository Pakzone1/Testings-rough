#!/bin/bash

# Load environment variables if .env exists
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Install required system dependencies for Puppeteer
echo "Installing Puppeteer dependencies..."
if command -v apt-get &> /dev/null; then
    # For Ubuntu/Debian
    sudo apt-get update
    sudo apt-get install -y \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libcairo2 \
        libasound2 \
        libatspi2.0-0 \
        libgtk-3-0 \
        chromium-browser
elif command -v yum &> /dev/null; then
    # For Amazon Linux/CentOS/RHEL
    sudo yum update -y
    sudo yum install -y \
        atk \
        atk-devel \
        at-spi2-atk \
        cups-libs \
        dbus-glib \
        libXcomposite \
        libXcursor \
        libXdamage \
        libXext \
        libXi \
        libXrandr \
        libXScrnSaver \
        libXtst \
        pango \
        pango-devel \
        alsa-lib \
        xorg-x11-fonts-Type1 \
        xorg-x11-utils \
        libxkbcommon \
        libdrm \
        gtk3 \
        libgbm \
        nss \
        libX11
fi

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    if command -v apt-get &> /dev/null; then
        # For Ubuntu/Debian
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        # For CentOS/RHEL
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    fi
fi

# Install Python and pip if not already installed
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3 and pip..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y python3 python3-pip python3-venv
    else
        sudo yum install -y python3 python3-pip
    fi
fi

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
npm install
pip3 install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Get public IP (works on any Linux system)
PUBLIC_IP=$(hostname -I | awk '{print $1}')
if [ -z "$PUBLIC_IP" ]; then
    # Fallback to curl if hostname doesn't work
    PUBLIC_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com)
fi

# Set default port if not specified in .env
PORT=${PORT:-8080}

echo "======================================"
echo "Server will be accessible at:"
echo "http://$PUBLIC_IP:$PORT"
echo "https://$PUBLIC_IP:$PORT (if SSL is configured)"
echo "======================================"

# Start the Flask dashboard
echo "Starting Dashboard..."

# Start the Flask application with Gunicorn
./venv/bin/gunicorn --bind 0.0.0.0:$PORT dashboard:app --workers 3 --timeout 120