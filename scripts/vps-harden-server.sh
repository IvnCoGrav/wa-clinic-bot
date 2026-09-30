#!/usr/bin/env bash
# =============================================================================
# vps-harden-server.sh — Pengerasan Keamanan Fondasional VPS Baru (Anti-Lockout)
# 
# Dijalankan di VPS BARU (43.173.11.79):
#   bash scripts/vps-harden-server.sh
# =============================================================================
set -euo pipefail

echo "======================================================"
echo "==> [1/5] Membuka Port SSH Kustom (1403) di Firewall .."
echo "======================================================"
sudo ufw allow 1403/tcp comment 'SSH Hardened'
sudo ufw status | grep 1403

echo
echo "======================================================"
echo "==> [2/5] Mengonfigurasi Pengerasan SSH ..."
echo "======================================================"
# Pastikan cloud-init tidak menimpa PasswordAuthentication
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config 2>/dev/null || true
if [ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ]; then
  sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf
fi

# Tulis drop-in configuration SSH dengan prioritas tinggi (99-hardened.conf)
sudo tee /etc/ssh/sshd_config.d/99-hardened.conf > /dev/null << 'EOF'
# Hardened SSH Configuration
Port 1403
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
EOF

echo "Menguji sintaks konfigurasi sshd..."
if ! sudo sshd -t; then
  echo "FATAL: Konfigurasi sshd tidak valid! Membatalkan restart SSH..."
  sudo rm -f /etc/ssh/sshd_config.d/99-hardened.conf
  exit 1
fi
echo "Sintaks sshd valid ✓"

echo "Me-restart service SSH pada port 1403..."
sudo systemctl restart ssh
echo "Service SSH aktif di port 1403."

echo
echo "======================================================"
echo "==> [3/5] Mengonfigurasi Fail2ban Agresif (Jail 24 Jam) ..."
echo "======================================================"
sudo tee /etc/fail2ban/jail.local > /dev/null << 'EOF'
[DEFAULT]
bantime = 1d
findtime = 10m
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = 1403
EOF

sudo systemctl restart fail2ban
sudo fail2ban-client status sshd

echo
echo "======================================================"
echo "==> [4/5] Hardening Kernel Network (Anti-DDoS & Spoof) ..."
echo "======================================================"
sudo tee /etc/sysctl.d/99-security.conf > /dev/null << 'EOF'
# Anti-SYN flood protection
net.ipv4.tcp_syncookies = 1

# Anti-IP spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP broadcast / Smurf attack
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Disable ICMP redirect acceptance
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Disable IP source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
EOF

sudo sysctl --system > /dev/null
echo "Kernel security parameters berhasil diterapkan ✓"

echo
echo "======================================================"
echo "==> [5/5] Hardening Shared Memory (/dev/shm) ..."
echo "======================================================"
if ! grep -q "/dev/shm.*noexec" /etc/fstab; then
  echo "tmpfs /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0" | sudo tee -a /etc/fstab
fi
sudo mount -o remount,noexec,nosuid,nodev /dev/shm 2>/dev/null || true
echo "Mount /dev/shm terproteksi noexec,nosuid,nodev ✓"

echo
echo "======================================================"
echo "✅ HARDENING SELESAI!"
echo "Port SSH aktif di: 1403"
echo "Login Password: NONAKTIF (Hanya SSH Key)"
echo "Login Root: DITUTUP"
echo "======================================================"
