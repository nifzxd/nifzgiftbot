# 🎁 Telegram Gift Bot

Bot Telegram untuk mengirim gift kepada teman dengan sistem pembayaran berbasis **Telegram Stars** ⭐

---

## 📋 Fitur Utama

### 👥 Untuk User
- 🎁 **Katalog Gift** - Jelajahi berbagai gift menarik dengan harga terjangkau
- ⭐ **Favorit** - Akses cepat ke gift yang paling sering dibeli
- 📜 **Riwayat Order** - Lihat semua pesanan dengan status lengkap
- 💬 **Pesan Custom** - Tambahkan pesan personal untuk penerima gift
- 💳 **Pembayaran Stars** - Transaksi aman menggunakan Telegram Stars
- 🎯 **Kirim ke Siapa Saja** - Gunakan username atau ID Telegram penerima

### 👑 Untuk Owner
- 📊 **Dashboard Statistik** - Monitor penjualan, user, dan profit real-time
- 🎁 **Manajemen Gift** - Lihat daftar lengkap gift, harga, dan profit margin
- ⚙️ **Edit Config Dinamis** - Ubah setting tanpa perlu restart (untuk beberapa setting)
- 📣 **Broadcast** - Kirim pesan ke semua user sekaligus
- 💸 **Tracking Keuangan** - Total stars masuk, total profit, dan analisis penjualan
- ♻️ **Restart Bot** - Restart bot dari menu admin

---

## 🚀 Instalasi & Setup

### Prerequisites
- Node.js v14+ 
- npm atau yarn
- Telegram Bot Token dari [@BotFather](https://t.me/BotFather)

### Langkah-Langkah Instalasi

1. **Clone atau download project**
   ```bash
   git clone <repo-url>
   cd telegram-gift-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup config.js**
   ```bash
   cp config.example.js config.js
   # atau buat config.js baru dengan struktur di bawah
   ```

4. **Konfigurasi `config.js`**
   ```javascript
   module.exports = {
     // ✅ WAJIB
     BOT_TOKEN: "YOUR_BOT_TOKEN_HERE",
     OWNER_ID: 123456789,  // ID Telegram owner
   
     // 💰 Markup (profit setting)
     MARKUP_FLAT: 0,        // Flat markup dalam stars
     MARKUP_PERCENT: 20,    // Persentase profit (%)
   
     // 📢 Logging
     LOG_CHANNEL_ID: null,  // ID channel untuk log (null = disabled)
   
     // ⏳ Cooldown & Limit
     INVOICE_COOLDOWN_SEC: 5,   // Delay antar order
     MAX_CUSTOM_TEXT_LEN: 250,  // Panjang max teks custom
     BROADCAST_DELAY_MS: 500,   // Delay antar broadcast (ms)
   
     // 📁 Database
     DATA_DIR: "data",
     DB_FILE: "db.json",
   };
   ```

5. **Update Gift Catalog (opsional)**
   
   Edit section `GIFTS` di `index.js`:
   ```javascript
   const GIFTS = {
     "5170145012310081615": { name: "Hati 💖",    price: 15  },
     "5170233102089322756": { name: "Boneka 🧸", price: 15  },
     // ... tambah gift baru sesuai kebutuhan
   };
   ```
   
   > **Catatan:** Gift ID diambil dari Telegram API. Dapatkan dengan mengirim gift secara manual terlebih dahulu.

6. **Jalankan Bot**
   ```bash
   node index.js
   ```

---

## ⚙️ Konfigurasi

### Mengubah Config

Ada 2 cara:

#### **Cara 1: Langsung di code** (perlu restart)
Edit `config.js` dan restart bot dengan `/restart`

#### **Cara 2: Melalui Owner Menu** (recommended)
1. Ketik `/owner` 
2. Pilih "⚙️ Edit Config"
3. Pilih field yang ingin diubah
4. Kirim nilai baru

> ⚠️ Beberapa setting (BOT_TOKEN, paths) memerlukan restart bot agar aktif sepenuhnya.

### Parameter Penting

| Parameter | Tipe | Deskripsi |
|-----------|------|-----------|
| `BOT_TOKEN` | string | Token bot dari BotFather |
| `OWNER_ID` | number | User ID owner untuk akses admin |
| `MARKUP_FLAT` | number | Keuntungan flat per transaksi (stars) |
| `MARKUP_PERCENT` | number | Persentase profit dari harga gift |
| `LOG_CHANNEL_ID` | number \| null | Channel untuk logging aktivitas |
| `INVOICE_COOLDOWN_SEC` | number | Detik tunggu antar order |

---

## 📱 User Guide

### Mengirim Gift

1. Ketik `/start` untuk membuka menu utama
2. Pilih "🎁 Katalog Gift" atau "⭐ Favorit"
3. Pilih gift yang ingin dikirim
4. Masukkan username/ID penerima (misal: `@username` atau `123456789`)
5. Tambahkan pesan custom (opsional)
6. Verifikasi ringkasan pesanan
7. Lakukan pembayaran dengan Stars
8. ✅ Gift terkirim!

### Lihat Riwayat

- Ketik `/start`
- Pilih "📜 Riwayat Order"
- Lihat status semua transaksi Anda

---

## 👑 Owner Commands

| Command | Deskripsi |
|---------|-----------|
| `/owner` | Buka panel owner |
| `/restart` | Restart bot (dari command) |

### Menu Owner

**📊 Statistik**
- Total user yang sudah /start
- Breakdown order (sukses, refunded, failed, pending)
- Total stars masuk dan profit

**🎁 Daftar Gift**
- Lihat semua gift dengan harga cost dan jual
- Lihat ID gift untuk Telegram API

**⚙️ Edit Config**
- Ubah semua setting dinamis
- Lihat value lama dan baru
- Konfirmasi jika perlu restart

**📣 Broadcast**
- Kirim pesan ke semua user sekaligus
- Preview sebelum mengirim
- Lihat statistik delivery (sukses/gagal)

**♻️ Restart Bot**
- Restart bot tanpa perlu terminal

---

## 💾 Database

Bot menggunakan **JSON file** untuk storage:

```
data/
└── db.json
```

### Struktur Database

```json
{
  "users": {
    "123456789": {
      "username": "nifxx",
      "firstName": "Nif",
      "firstSeen": 1234567890,
      "lastSeen": 1234567890,
      "totalOrders": 5,
      "totalSpent": 250,
      "giftCount": {
        "5170145012310081615": 3,
        "5170233102089322756": 2
      }
    }
  },
  "orders": {
    "abc12345": {
      "userId": 123456789,
      "giftId": "5170145012310081615",
      "giftName": "Hati 💖",
      "recipientId": 987654321,
      "recipientLabel": "@recipient",
      "customText": "Untuk kamu, semoga bahagia!",
      "senderName": "@nifxx",
      "price": 18,
      "costPrice": 15,
      "displayPrice": 18,
      "markup": 3,
      "status": "paid",
      "chargeId": "charge_xyz",
      "createdAt": 1234567890,
      "paidAt": 1234567891
    }
  },
  "stats": {
    "totalSold": 10,
    "totalStars": 250,
    "totalProfit": 50
  }
}
```

### Status Order

| Status | Keterangan |
|--------|-----------|
| `pending` | Menunggu pembayaran |
| `paid` | Berhasil dikirim |
| `refunded` | Pembayaran dikembalikan |
| `failed` | Gagal + butuh intervensi manual |

---

## 🔧 Troubleshooting

### Bot tidak merespons
- ✅ Cek token di `config.js`
- ✅ Restart bot dengan `/restart`
- ✅ Lihat logs di console

### Gift gagal terkirim
- Cek apakah penerima sudah pernah `/start` bot
- Lihat status di "📜 Riwayat Order"
- Owner cek menu "📊 Statistik" untuk order yang failed

### Config tidak berubah
- Beberapa setting memerlukan *restart* bot
- Lihat tanda 🔄 di menu "⚙️ Edit Config"
- Gunakan `/restart` untuk apply perubahan

### Database error
- Cek folder `data/` tersedia dan writable
- Backup `db.json` jika ada error
- Bot akan auto-reset jika file rusak

---

## 📊 Monitoring

Bot mencatat aktivitas penting ke log channel (jika dikonfigurasi).

Events yang dicatat:
- ✅ Order sukses
- 💸 Refund otomatis
- 🚨 Error & refund manual
- ⚙️ Config changes
- ♻️ Bot restart
- ❌ General errors

---

## 🎯 Best Practices

### Untuk Owner

1. **Set LOG_CHANNEL_ID** untuk monitoring lebih mudah
2. **Backup db.json** secara berkala
3. **Monitor "failed" orders** di statistik — mungkin butuh refund manual
4. **Adjust MARKUP** sesuai kebutuhan profit
5. **Update INVOICE_COOLDOWN** untuk cegah spam order

### Untuk Menjaga Bot Healthy

- Gunakan process manager seperti **PM2** atau **systemd** untuk auto-restart
- Monitor disk space untuk folder `data/`
- Cek heartbeat di logs (rekoneksi otomatis jika polling terputus)

---

## 🌐 Deployment

### Dengan PM2 (recommended)

1. Install PM2:
   ```bash
   npm install -g pm2
   ```

2. Buat `ecosystem.config.js`:
   ```javascript
   module.exports = {
     apps: [{
       name: "gift-bot",
       script: "index.js",
       autorestart: true,
       max_memory_restart: "500M",
       env: {
         NODE_ENV: "production"
       }
     }]
   };
   ```

3. Jalankan:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### Dengan Docker (opsional)

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "index.js"]
```

Build & run:
```bash
docker build -t gift-bot .
docker run -d --name gift-bot -v gift-bot-data:/app/data gift-bot
```

---

## 📝 License

Bebas digunakan dan dimodifikasi.

---

## 👨‍💻 Developer

**Script Developer:** [@nifxx](https://t.me/nifxx) on Telegram

Jika ada pertanyaan, saran, atau bug report — hubungi developer via Telegram!

---

## 📚 Dependencies

- **telegraf** - Telegram bot framework
- **Node.js built-in** - fs, path, child_process

---

## ✨ Changelog

### v1.0.0
- ✅ Fitur core: katalog, favorit, order, payment
- ✅ Owner panel dengan statistik
- ✅ Dynamic config editor
- ✅ Broadcast system
- ✅ Auto refund & error handling
- ✅ Database persistence

---

## 🤝 Contributing

Untuk modifikasi atau improve bot, silakan:
1. Fork / copy project
2. Buat fitur baru
3. Test secara menyeluruh
4. Share improvements ke developer

---

**Happy gifting! 🎁⭐**
