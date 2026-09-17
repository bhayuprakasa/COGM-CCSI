# COGM Manufacturing BOM System
## Panduan Deploy di Server Lokal (LAN/Intranet)

---

## STRUKTUR FOLDER

```
cogm-server/
├── server.js           ← Entry point server
├── package.json        ← Daftar dependensi
├── INSTALL.bat         ← Installer Windows (double-click)
├── START.bat           ← Jalankan server Windows
├── BACKUP.bat          ← Backup database manual
├── start.sh            ← Jalankan server Linux/Mac
├── db/
│   ├── database.js     ← Schema & koneksi database
│   └── auth.js         ← Autentikasi & session
├── routes/
│   ├── master.js       ← API master data
│   └── bom.js          ← API BOM & Master BOM
├── public/             ← File frontend (index.html)
│   └── api-client.js   ← Koneksi frontend ke API
├── data/               ← Database SQLite (auto-created)
│   ├── cogm.db
│   └── backups/
└── scripts/
    └── backup.js       ← Script backup otomatis
```

---

## CARA INSTALL (WINDOWS)

### Langkah 1 — Install Node.js
1. Buka browser, pergi ke **https://nodejs.org**
2. Download versi **LTS** (misal: 20.x LTS)
3. Jalankan installer, klik Next terus sampai selesai
4. Restart komputer

### Langkah 2 — Siapkan File
1. Salin seluruh folder `cogm-server` ke komputer server
   (misal: `C:\cogm-server\`)
2. Salin file `bom-system.html` ke dalam folder tersebut

### Langkah 3 — Install
1. Masuk ke folder `cogm-server`
2. Double-click **`INSTALL.bat`**
3. Tunggu hingga selesai (akan ada tulisan "Instalasi selesai!")

### Langkah 4 — Jalankan Server
1. Double-click **`START.bat`**
2. Server berjalan. Akan tampil alamat IP server.

### Langkah 5 — Akses dari Komputer Lain
Di komputer user lain (yang terhubung ke WiFi/LAN yang sama):
1. Buka browser (Chrome/Edge/Firefox)
2. Ketik: `http://192.168.1.xxx:3001`
   (ganti dengan IP yang tampil di START.bat)
3. Login dengan akun yang tersedia

---

## CARA INSTALL (LINUX/UBUNTU)

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Pindah ke folder
cd /home/user/cogm-server

# 3. Salin frontend
cp /path/to/bom-system.html public/index.html

# 4. Install dan jalankan
chmod +x start.sh
./start.sh
```

### Jalankan otomatis saat server menyala (Linux):
```bash
# Install PM2
sudo npm install -g pm2

# Jalankan dengan PM2
cd /home/user/cogm-server
pm2 start server.js --name cogm

# Auto-start saat reboot
pm2 startup
pm2 save
```

---

## CARA INSTALL (RASPBERRY PI)

Raspberry Pi adalah pilihan hemat listrik (~5W) untuk server 24 jam.

```bash
# 1. Flash Raspberry Pi OS ke SD card
# 2. Nyalakan, hubungkan ke jaringan
# 3. SSH masuk:
ssh pi@raspberrypi.local

# 4. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 5. Salin file (dari PC ke Raspberry Pi)
# Di PC:
scp -r cogm-server pi@raspberrypi.local:/home/pi/
scp bom-system.html pi@raspberrypi.local:/home/pi/cogm-server/

# 6. Di Raspberry Pi:
cd /home/pi/cogm-server
npm install
cp bom-system.html public/index.html

# 7. Jalankan permanen
sudo npm install -g pm2
pm2 start server.js --name cogm
pm2 startup systemd
pm2 save
```

---

## AKUN DEFAULT

| Username | Password  | Role         | Akses                                    |
|----------|-----------|--------------|------------------------------------------|
| admin    | admin123  | Administrator| Semua akses + approve + kelola user      |
| editor   | edit123   | Editor       | Input & edit semua master data + BOM     |
| approver | appr123   | Approver     | Approve/reject BOM                       |
| viewer   | view123   | Viewer       | Lihat semua data, tidak bisa edit        |

**⚠️ PENTING: Ganti semua password default sebelum dipakai produksi!**
Masuk sebagai admin → halaman Access Role → Edit user → ganti password.

---

## BACKUP DATABASE

### Manual (Windows):
Double-click `BACKUP.bat`

### Manual (Linux):
```bash
cd /home/user/cogm-server
node scripts/backup.js
```

### Otomatis setiap hari jam 23:00 (Windows Task Scheduler):
1. Buka Task Scheduler
2. Create Basic Task → Name: "COGM Backup"
3. Trigger: Daily, 23:00
4. Action: Start a program
5. Program: `C:\cogm-server\BACKUP.bat`

### Otomatis setiap hari (Linux cron):
```bash
crontab -e
# Tambahkan baris:
0 23 * * * cd /home/user/cogm-server && node scripts/backup.js >> /tmp/cogm-backup.log 2>&1
```

File backup tersimpan di: `data/backups/cogm_YYYY-MM-DDTHH-MM-SS.db`
Otomatis hapus backup lebih dari 30 hari.

---

## TROUBLESHOOTING

### "Port 3001 sudah dipakai"
```bash
# Windows: cari proses yang pakai port 3001
netstat -ano | findstr :3001
# Kill proses dengan PID yang ditemukan
taskkill /PID <PID> /F

# Linux:
sudo lsof -i :3001
sudo kill -9 <PID>
```
Atau ganti port: edit server.js baris `const PORT = 3001;`

### Tidak bisa akses dari komputer lain
- Pastikan kedua komputer terhubung ke WiFi/LAN yang sama
- Periksa firewall Windows: Control Panel → Windows Defender Firewall
  → Allow an app → Node.js → centang Private
- Atau matikan sementara firewall untuk test

### Database corrupt/hilang
Restore dari backup:
```bash
# Stop server dulu
# Copy file backup:
cp data/backups/cogm_2024-xx-xx.db data/cogm.db
# Start server lagi
```

### Lupa password admin
```bash
# Jalankan di folder cogm-server:
node -e "
const db = require('better-sqlite3')('./data/cogm.db');
db.prepare(\"UPDATE users SET password='admin123' WHERE username='admin'\").run();
console.log('Password admin direset ke: admin123');
"
```

---

## KEAMANAN (untuk lingkungan UMKM)

1. **Ganti semua password default** segera setelah install
2. **Firewall**: pastikan port 3001 hanya bisa diakses dari jaringan internal (LAN)
3. **Backup rutin**: aktifkan backup otomatis harian
4. **UPS**: pasang UPS di komputer server agar tidak mati tiba-tiba
5. **Jangan expose ke internet** tanpa konfigurasi keamanan tambahan (HTTPS, reverse proxy)

---

## SPESIFIKASI MINIMUM SERVER

| Komponen | Minimum      | Rekomendasi     |
|----------|-------------|-----------------|
| RAM      | 512 MB      | 1 GB            |
| Storage  | 1 GB free   | 10 GB (backup)  |
| OS       | Windows 7+  | Windows 10/11   |
| CPU      | Dual-core   | Any modern CPU  |
| Network  | WiFi/LAN    | Kabel LAN       |

Database SQLite untuk UMKM (<100 user, <100k transaksi) tidak akan melebihi 500 MB.

---

## API ENDPOINTS (untuk integrasi)

| Method | Endpoint                  | Deskripsi              |
|--------|--------------------------|------------------------|
| POST   | /api/auth/login           | Login                  |
| GET    | /api/items                | Daftar item            |
| POST   | /api/items                | Tambah item            |
| PUT    | /api/items/:id            | Update item            |
| DELETE | /api/items/:id            | Hapus item             |
| GET    | /api/prices               | Daftar purchase price  |
| GET    | /api/exrates              | Daftar exchange rate   |
| GET    | /api/dlfoh                | Daftar DL-FOH          |
| GET    | /api/mesin                | Daftar mesin           |
| GET    | /api/kapasitas            | Daftar kapasitas       |
| GET    | /api/masterbom            | Daftar master BOM      |
| GET    | /api/bom                  | Daftar BOM             |
| POST   | /api/bom/:id/submit       | Submit BOM             |
| POST   | /api/bom/:id/approve      | Approve/Reject BOM     |
| GET    | /api/bom/history          | History BOM approved   |
| GET    | /api/health               | Status server          |

Semua endpoint butuh header: `x-token: <token_dari_login>`
