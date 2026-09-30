#!/usr/bin/env bash
# =============================================================================
# vps-setup-new.sh — Provisioning & Pengerasan VPS Baru (Ubuntu 24.04 / 22.04 LTS)
# 
# Dijalankan di VPS BARU (43.173.11.79):
#   bash scripts/vps-setup-new.sh
# =============================================================================
set -euo pipefail

echo "======================================================"
echo "==> [1/7] Mengatur Timezone ke Asia/Jakarta (WIB) ..."
echo "======================================================"
sudo timedatectl set-timezone Asia/Jakarta
echo "Timezone aktif: $(timedatectl | grep 'Time zone')"

echo
echo "======================================================"
echo "==> [2/7] Update OS & Install Dependensi Dasar ..."
echo "======================================================"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  tar \
  gzip \
  ufw \
  fail2ban \
  htop \
  rsync

echo
echo "======================================================"
echo "==> [3/7] Install Docker Engine & Docker Compose Plugin ..."
echo "======================================================"
if ! command -v docker &>/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  sudo systemctl enable docker
  sudo systemctl start docker
  echo "Docker berhasil diinstall!"
else
  echo "Docker sudah terinstall: $(docker --version)"
fi

echo "Menambahkan user $USER ke grup docker ..."
sudo usermod -aG docker "$USER"

echo
echo "======================================================"
echo "==> [4/7] Pengaturan Swapiness & Kernel Limits ..."
echo "======================================================"
# Set swappiness = 10 agar prefer RAM fisik 8GB
if ! grep -q "vm.swappiness=10" /etc/sysctl.conf; then
  echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
fi

echo
echo "======================================================"
echo "==> [5/7] Konfigurasi Firewall (UFW) ..."
echo "======================================================"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP Caddy'
sudo ufw allow 443/tcp comment 'HTTPS Caddy'
sudo ufw allow 443/udp comment 'HTTP3 Caddy'
sudo ufw --force enable
sudo ufw status verbose

echo
echo "======================================================"
echo "==> [6/7] Menyiapkan Direktori Proyek /opt/wa-clinic-bot ..."
echo "======================================================"
sudo mkdir -p /opt/wa-clinic-bot
sudo chown -R "$USER:$USER" /opt/wa-clinic-bot
echo "Direktori /opt/wa-clinic-bot siap dengan kepemilikan $USER."

echo
echo "======================================================"
echo "==> [7/7] Otorisasi Kunci SSH Server Lama (Fast SCP) ..."
echo "======================================================"
OLD_SERVER_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDSLE+vlPTXy1bsoSPeohRTIRX5ASnmGSZFFIVayUdP4 vps-tencent"
if ! grep -q "$OLD_SERVER_PUBKEY" "$HOME/.ssh/authorized_keys" 2>/dev/null; then
  echo "$OLD_SERVER_PUBKEY" >> "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  echo "Kunci publik server lama berhasil ditambahkan ke authorized_keys."
else
  echo "Kunci publik server lama sudah ada di authorized_keys."
fi

echo
echo "======================================================"
echo "✅ PROVISIONING VPS BARU SELESAI!"
echo "Docker: $(docker --version 2>/dev/null || echo 'Perlu re-login shell')"
echo "Compose: $(docker compose version 2>/dev/null || echo 'Perlu re-login shell')"
echo "======================================================"
