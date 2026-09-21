# Panduan Fitur AI Waste Detection ReLoop

Fitur ini membuat pengguna bisa memotret sampah lewat kamera browser, lalu AI
di dalam browser menebak kategorinya: **Organik, Plastik, Kaca, Kertas, atau
Anorganik lainnya**, lengkap dengan persentase keyakinan (confidence).

Tidak ada API key. Tidak ada API eksternal. Foto tidak dikirim ke mana pun.

---

## 1. Struktur folder

```text
reloop/
├── index.html          <- diperbarui (modal kamera baru, script inline dihapus)
├── style.css           <- diperbarui (CSS tambahan di bagian paling bawah)
├── script.js           <- diperbarui (kode AI di bagian paling bawah)
├── (gambar-gambar Anda: pengelolaa.jpg, edukasi.jpg, dst. tetap di sini)
│
├── model/              <- WAJIB, Anda yang mengisi (lihat bagian 4 dan 5)
│   ├── model.json
│   ├── metadata.json
│   └── weights.bin     (atau group1-shard1of1.bin, dst.)
│
├── libs/               <- OPSIONAL
│   └── tf.min.js       (agar TensorFlow.js tidak diunduh dari internet)
│
└── training/           <- OPSIONAL, hanya jika melatih model dengan Python
    └── train_model.py
```

Folder `model/`, `libs/`, dan `training/` dibuat sendiri di samping
`index.html`. Folder `dataset/` tidak dipakai website dan ukurannya besar,
jadi tidak perlu ikut diunggah ke hosting (begitu juga `training/`).

---

## 2. Apa saja yang berubah di file Anda

| File | Perubahan |
|------|-----------|
| `index.html` | Modal "Verifikasi Sampah" diganti dengan versi baru: preview kamera, tombol **Ambil Foto**, **Ulangi Foto**, **Analisis**, tampilan loading, dan kartu hasil. Teks penjelasan di kotak verifikasi halaman Jemput Sampah diperbarui. Blok `<script>` inline kamera yang lama dihapus karena kodenya dipindah ke `script.js`. |
| `style.css` | Ditambah di bagian paling bawah. Tidak ada CSS lama yang diubah atau dihapus. |
| `script.js` | Ditambah di bagian paling bawah (bagian "AI DETEKSI SAMPAH"). Tidak ada fungsi lama yang diubah. |

Navbar, warna, font, halaman lain, peta, dan fitur Jemput/Pengelola/Dashboard
tidak disentuh.

Satu perbaikan kecil: di CSS lama, kotak `#cameraResult` diberi atribut
`hidden` tetapi juga `display: flex`, sehingga kotak "Belum ada verifikasi"
tetap terlihat sejak awal. Sekarang kotak itu baru muncul setelah ada hasil
AI.

---

## 3. Cara menjalankan website

### Kenapa harus lewat localhost?

1. **Kamera** (`getUserMedia`) hanya boleh dipakai di halaman **HTTPS** atau
   **localhost**.
2. **Model AI** dibaca dengan `fetch()` dari folder `model/`. Browser
   memblokirnya jika halaman dibuka langsung dari file (`file:///...`).

Jadi: **jangan klik dua kali `index.html`**. Jalankan lewat server lokal.

### Cara termudah (pilih salah satu)

**A. VS Code + Live Server**
1. Install ekstensi *Live Server*.
2. Klik kanan `index.html` > *Open with Live Server*.

**B. Python** (buka terminal di folder `reloop/`)
```bash
python -m http.server 8000
```
Lalu buka `http://localhost:8000` di browser.

### Mencoba di HP

- Membuka `http://192.168.x.x:8000` (alamat laptop di Wi-Fi) **tidak** dianggap
  aman oleh browser HP, jadi kamera langsung tidak bisa dibuka. Tombol
  **Pilih dari Galeri** tetap bisa dipakai: di HP, tombol itu menawarkan
  "Kamera" sehingga Anda bisa memotret lalu menganalisis.
- Untuk kamera langsung di HP, unggah website ke hosting **HTTPS** statis
  (Netlify, Vercel, GitHub Pages, dll.). Folder `model/` ikut diunggah.
  Model dan foto tetap diproses di HP, bukan di server hosting.

---

## 4. Membuat model AI

Model harus punya 5 kelas dengan nama berikut (huruf besar/kecil, spasi, dan
garis bawah tidak masalah):

`Organic`, `Plastic`, `Glass`, `Paper`, `Other Inorganic`

`script.js` mencocokkan **berdasarkan nama kelas** di `metadata.json`, bukan
urutan, jadi urutan kelas bebas.

### Siapkan dataset dulu

```text
dataset/
├── organic/
├── plastic/
├── glass/
├── paper/
└── other_inorganic/
```

Tips agar akurat:
- Minimal **100 foto per kelas**, idealnya 300 atau lebih.
- Jumlah foto tiap kelas jangan terlalu timpang.
- Variasikan latar, cahaya, sudut, jarak, dan kondisi (bersih, kotor,
  penyok, basah).
- Foto sampah **asli di lingkungan Anda** (misalnya lewat kamera HP) jauh
  lebih berguna daripada foto katalog.
- Dataset publik bisa dipakai sebagai tambahan (misalnya dataset
  "Garbage Classification" di Kaggle atau TrashNet). Cek lisensinya, dan
  petakan kelasnya ke 5 folder di atas. Kelas seperti logam, baterai, kain,
  dan sepatu masuk ke `other_inorganic`.
- Pisahkan sekitar 20 foto per kelas yang **tidak dipakai melatih** untuk
  menguji model nanti.

### Cara A (disarankan untuk pemula): Teachable Machine

1. Buka <https://teachablemachine.withgoogle.com> > *Get Started* >
   **Image Project** > **Standard image model**.
2. Ubah nama 5 kelas menjadi `Organic`, `Plastic`, `Glass`, `Paper`,
   `Other Inorganic`.
3. Untuk tiap kelas, klik *Upload* dan pilih foto dari folder dataset Anda.
4. Klik **Train Model** dan tunggu selesai. Jangan pindah tab saat training.
5. Uji di panel *Preview* memakai foto yang tidak ikut dilatih.
6. Klik **Export Model** > tab **TensorFlow.js** > pilih
   **Download my model** > klik *Download my model*.
   (Jangan pilih *Upload my model*: itu menyimpan modelnya di server Google.)
7. Ekstrak file zip. Isinya `model.json`, `metadata.json`, dan `weights.bin`.

### Cara B: latih sendiri dengan Python (transfer learning)

Skrip `training/train_model.py` memakai MobileNetV2 yang sudah pintar
mengenali gambar, lalu dilatih ulang untuk 5 kategori Anda.

```bash
pip install "tensorflow==2.15.*" tensorflowjs
python training/train_model.py --dataset dataset --output model
```

Jika instalasi bermasalah (versi paket sering bentrok), gunakan virtual
environment baru atau Google Colab. Skrip menulis `model.json`, file `.bin`,
dan `metadata.json` langsung ke folder `model/`. Skrip juga mencetak akurasi
pada data validasi.

---

## 5. Memasukkan model ke website

1. Salin **semua** file hasil export ke folder `model/` di samping
   `index.html`:
   `model.json`, `metadata.json`, dan semua file `.bin`.
2. Jangan mengubah nama file `.bin` tanpa mengubah nama yang sama di
   dalam `model.json`.
3. Jalankan website lewat localhost (bagian 3), buka **Jemput Sampah** >
   **Buka Kamera**, ambil foto, tekan **Analisis**.

Jika ingin memakai lokasi lain, ubah dua baris ini di bagian atas kode AI di
`script.js`:

```javascript
const WASTE_MODEL_URL = "model/model.json";
const WASTE_METADATA_URL = "model/metadata.json";
```

### Opsional: TensorFlow.js tanpa internet

Secara bawaan, `script.js` mencoba `libs/tf.min.js` dulu, lalu jika tidak ada
mengunduh library dari CDN jsDelivr. Yang diunduh hanya **kode library**, bukan
foto. Agar website tidak mengunduh apa pun dari luar untuk fitur ini, simpan
file berikut sebagai `libs/tf.min.js`:

<https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js>

(Website Anda sendiri masih memuat Leaflet dari CDN untuk peta. Itu bagian
lama dan tidak terkait dengan AI.)

---

## 6. Cara kerja kode (bahasa sederhana)

Semua ada di bagian bawah `script.js`.

1. **Buka Kamera**: `openWasteCamera()` membuka modal dan meminta izin
   kamera lewat `navigator.mediaDevices.getUserMedia`. Di saat yang sama model
   mulai dimuat di latar belakang.
2. **Ambil Foto**: `captureWastePhoto()` menyalin satu gambar dari video ke
   `<canvas>`, lalu mematikan kamera.
3. **Ulangi Foto**: `retakeWastePhoto()` menghidupkan kamera lagi.
4. **Analisis**: `analyzeWastePhoto()` menampilkan loading, lalu memanggil
   `classifyWasteCanvas()`. Fungsi ini:
   - membaca piksel dari canvas (`tf.browser.fromPixels`),
   - memotong bagian tengah menjadi persegi dan mengecilkannya ke 224x224,
   - mengubah nilai piksel 0..255 menjadi -1..1 (sama seperti saat model
     dilatih),
   - meminta model menghitung skor tiap kategori (`model.predict`),
   - mengurutkan skor dari terbesar. Yang terbesar menjadi hasil, dan
     skornya menjadi confidence.
5. **Menampilkan hasil**: `renderWasteResult()` mengisi kartu hasil, dan
   `updateJemputVerification()` membandingkan hasil AI dengan pilihan "Jenis
   Sampah" di form Jemput.

Tidak ada hasil yang diacak atau ditulis manual. Kategori selalu berasal dari
angka keluaran model. Jika model belum ada, aplikasi menampilkan pesan error,
bukan hasil palsu.

Kalau confidence di bawah 60%, muncul peringatan agar pengguna memotret ulang.
Angka 60% bisa diubah di `WASTE_LOW_CONFIDENCE`.

---

## 7. Privasi

- Foto hanya berpindah dari kamera ke `<canvas>`, lalu dibaca model yang
  berjalan di browser. Tidak ada `fetch`/`POST` yang membawa foto.
- Model (`model.json` dan `.bin`) diunduh **ke** browser dari website Anda
  sendiri. Arahnya ke pengguna, bukan sebaliknya.
- Anda bisa membuktikannya sendiri: buka DevTools (F12) > tab **Network**,
  ambil foto, tekan Analisis. Tidak akan ada permintaan yang mengirim data
  gambar.
- Hasil AI saat ini hanya tampil di layar. Belum disimpan ke data batch.

---

## 8. Keterbatasan yang perlu diketahui

- AI ini **perkiraan visual**, bukan pengganti pengecekan manusia. Karena itu
  hasilnya di form Jemput berupa penanda "sesuai / berbeda", bukan penolakan.
- Akurasi sepenuhnya bergantung pada dataset. Kelas `Other Inorganic`
  biasanya paling sulit karena isinya beragam (logam, kain, elektronik).
- Model selalu memilih salah satu dari 5 kelas, bahkan untuk benda yang
  bukan sampah. Peringatan confidence rendah membantu, tetapi tidak sempurna.
- Model dari Teachable Machine berukuran kecil (beberapa MB) sehingga
  ringan di HP.

---

## 9. Jika ada masalah

| Pesan / gejala | Penyebab dan solusi |
|----------------|---------------------|
| "Model AI belum ditemukan" | File belum ada di `model/`, atau nama folder/file salah. Pastikan `model/metadata.json` bisa dibuka di `http://localhost:8000/model/metadata.json`. |
| "Model gagal dimuat" | `model.json` ada tetapi file `.bin` tidak ikut disalin, atau namanya berubah. |
| "Website dibuka langsung dari file" | Buka lewat localhost, bukan klik dua kali `index.html`. |
| "Library TensorFlow.js gagal dimuat" | Tidak ada internet dan `libs/tf.min.js` belum ada. Simpan file tersebut (bagian 5). |
| "Izin kamera ditolak" | Klik ikon gembok di address bar > izinkan Kamera > buka ulang kamera. |
| Kamera tidak bisa dibuka di HP | Alamat bukan HTTPS/localhost. Pakai hosting HTTPS, atau tombol *Pilih dari Galeri*. |
| Jumlah label tidak sama dengan output model | `metadata.json` berasal dari model lain. Pakai pasangan `model.json` dan `metadata.json` dari export yang sama. |
| Hasil sering salah | Tambah foto latih yang beragam, terutama dari kondisi nyata, lalu latih ulang. |
| Error setelah update model | Tekan Ctrl+F5 agar browser tidak memakai model lama dari cache. |
