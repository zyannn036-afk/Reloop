/* =========================================================
   ReLoop - Kamera AI (deteksi langsung / real-time)

   Cara kerja:
   - Kamera dibuka lewat getUserMedia dan video diprediksi terus-menerus.
     Cukup arahkan SAMPAH PLASTIKNYA ke kamera (botol, kantong kresek,
     gelas, styrofoam, dll). Tidak perlu memperlihatkan simbol kodenya.
   - AI mengenali jenis plastik dari BENTUK, WARNA, dan TEKSTUR bendanya,
     lalu menentukan kode daur ulang 1-7.
   - Ada DUA pengenal yang dipakai bergantian:
     1) Model Teachable Machine milik Anda (folder model/) -- dipakai
        kalau sudah yakin ke salah satu kode 1-7.
     2) MobileNet (pengenal benda umum, tanpa perlu dilatih) sebagai
        cadangan: mengenali "botol", "kantong plastik", "gelas", dll. dari
        tampilannya lalu memetakannya ke kode (lihat POLA_OBJEK).
     Jadi botol plastik tetap terbaca walau model Anda belum dilatih.

   Penamaan kelas di model (dicocokkan otomatis, boleh lebih dari satu
   kelas untuk kode yang sama; probabilitasnya digabung per kode):
     - Nama kode      : PET / HDPE / PVC / LDPE / PP / PSS / PLA
     - Nama benda     : "botol air mineral", "botol sampo", "pipa paralon",
                        "kantong kresek", "gelas plastik", "styrofoam", ...
     - Berawalan angka: "3 - Pipa"
     - Diabaikan      : "tidak ada", "background", "kosong", dll.
   Kalau nama kelas Anda berbeda, ubah tabel POLA_KELAS di bawah.

   Supaya akurat, LATIH model dengan foto benda plastiknya utuh
   (berbagai sudut, cahaya, dan latar), bukan foto simbol kodenya.

   - Hasil "terkunci" bila kode yang sama terdeteksi yakin selama beberapa
     frame berturut-turut. Setelah itu tombol "Gunakan Hasil Ini" aktif.
   - Kamera hanya bisa jalan di HTTPS atau http://localhost.
========================================================= */

(function () {
  "use strict";

  const CONFIG = {
    MODEL_URL: "./model/",
    MIN_CONFIDENCE: 0.6, // cukup 60% yakin, tidak perlu 100%
    MIN_MARGIN: 0.1, // selisih minimum dengan kode peringkat 2 agar dianggap tertinggi
    MIN_CONFIDENCE_OBJEK: 0.3, // ambang untuk pengenal benda umum (MobileNet)
    STABLE_FRAMES: 3, // 3 frame berturut-turut sudah terkunci
    INTERVAL_MS: 100, // jeda antar prediksi (lebih rapat = lebih cepat)
    SMOOTHING: 0.6, // 0-1, makin kecil makin halus, makin besar makin responsif
    TF_SRC: "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js",
    MN_SRC: "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@1.0.1",
    TM_SRC:
      "https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js",
  };

  // Urutan penting: yang pertama cocok dipakai.
  const POLA_ABAIKAN = /tidak|none|background|latar|kosong|no[\s_-]?code|\bbg\b/i;
  const POLA_KELAS = [
    // 1) Nama kode resmi
    { kode: 1, pola: /\bpet\b|\bpete\b/i },
    { kode: 2, pola: /\bhdpe\b/i },
    { kode: 3, pola: /\bpvc\b/i },
    { kode: 4, pola: /\bldpe\b/i },
    { kode: 5, pola: /\bpp\b/i },
    { kode: 6, pola: /\bpss?\b|\bps\b/i },
    { kode: 7, pola: /\bpla\b|\bpc\b|bioplastik/i },
    // 2) Kelas diawali angka, mis. "3 - PVC"
    { kode: null, pola: /^\s*([1-7])\b/ },
    // 3) Nama benda (pengenalan dari tampilan sampahnya)
    { kode: 1, pola: /botol\s*(air|mineral|minum|soda|kecap|saus)|aqua|le\s*minerale|air\s*mineral/i },
    { kode: 2, pola: /sampo|shampoo|deterjen|sabun\s*cair|botol\s*susu|jerigen|galon\s*obat/i },
    { kode: 3, pola: /pipa|paralon|kabel|pvc/i },
    { kode: 4, pola: /kresek|kantong|tas\s*plastik|kantung|plastik\s*(wrap|pembungkus|bening)|cling/i },
    { kode: 5, pola: /wadah|tempat\s*(makan|bekal)|tupperware|sedotan|gelas|cup|tutup|ember/i },
    { kode: 6, pola: /styrofoam|steorofoam|foam|kotak\s*makan\s*sekali/i },
    { kode: 7, pola: /galon\s*(air|isi\s*ulang)|polikarbonat|botol\s*bayi/i },
  ];

  // Nama resmi tiap kode daur ulang (yang tampil di hasil kamera).
  const NAMA_KODE = {
    1: "PET",
    2: "HDPE",
    3: "PVC",
    4: "LDPE",
    5: "PP",
    6: "PSS",
    7: "PLA",
  };

  // Pemetaan nama benda (label ImageNet dari MobileNet, bahasa Inggris)
  // ke kode plastik. Ini perkiraan berdasarkan jenis benda yang umumnya
  // dibuat dari plastik tersebut.
  const POLA_OBJEK = [
    { kode: 1, pola: /water bottle|pop bottle|soda bottle/i },
    { kode: 2, pola: /pill bottle|soap dispenser|lotion|sunscreen|sunblock|bucket|pail/i },
    { kode: 4, pola: /plastic bag|shower cap/i },
    { kode: 5, pola: /measuring cup|\bcup\b|mixing bowl|pitcher|Petri dish/i },
    { kode: 7, pola: /water jug/i },
  ];

  // Format kode daur ulang yang ditampilkan: "1PET", "2HDPE", dst.
  const labelKode = (kode) => kode + NAMA_KODE[kode];

  const NAMA_LENGKAP = {
    1: "Polyethylene Terephthalate",
    2: "High-Density Polyethylene",
    3: "Polyvinyl Chloride",
    4: "Low-Density Polyethylene",
    5: "Polypropylene",
    6: "Polystyrene",
    7: "Lainnya / PLA",
  };

  const state = {
    model: null,
    modelPromise: null,
    obj: null,
    objPromise: null,
    stream: null,
    facing: "environment",
    session: 0, // naik setiap modal dibuka/ditutup, untuk membatalkan proses lama
    running: false,
    timer: null,
    history: [],
    ema: {}, // probabilitas per kode yang sudah dihaluskan
    frozen: false, // hasil dibekukan sampai pengguna menekan "Ulangi"
    locked: null, // hasil terkunci: { type: "kode", kode }
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- Pemuatan pustaka & model ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ai-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === "1") return resolve();
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Gagal memuat " + src)));
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.dataset.aiSrc = src;
      el.onload = () => {
        el.dataset.loaded = "1";
        resolve();
      };
      el.onerror = () => reject(new Error("Gagal memuat " + src));
      document.head.appendChild(el);
    });
  }

  function loadModel() {
    if (state.model) return Promise.resolve(state.model);
    if (state.modelPromise) return state.modelPromise;

    state.modelPromise = (async () => {
      if (typeof window.tmImage === "undefined") {
        await loadScript(CONFIG.TF_SRC);
        await loadScript(CONFIG.TM_SRC);
      }
      const base = CONFIG.MODEL_URL.endsWith("/")
        ? CONFIG.MODEL_URL
        : CONFIG.MODEL_URL + "/";
      state.model = await window.tmImage.load(
        base + "model.json",
        base + "metadata.json",
      );
      return state.model;
    })().catch((err) => {
      state.modelPromise = null; // izinkan coba lagi
      throw err;
    });

    return state.modelPromise;
  }

  function loadObjek() {
    if (state.obj) return Promise.resolve(state.obj);
    if (state.objPromise) return state.objPromise;
    state.objPromise = (async () => {
      if (typeof window.mobilenet === "undefined") {
        await loadScript(CONFIG.TF_SRC);
        await loadScript(CONFIG.MN_SRC);
      }
      state.obj = await window.mobilenet.load();
      return state.obj;
    })().catch((err) => {
      state.objPromise = null;
      throw err;
    });
    return state.objPromise;
  }

  // Muat kedua pengenal; cukup salah satu yang berhasil.
  async function loadSemuaModel() {
    const [tm, ob] = await Promise.allSettled([loadModel(), loadObjek()]);
    if (tm.status !== "fulfilled") console.error("Model Teachable Machine gagal:", tm.reason);
    if (ob.status !== "fulfilled") console.error("Model MobileNet gagal:", ob.reason);
    if (tm.status !== "fulfilled" && ob.status !== "fulfilled") {
      throw new Error(
        "Model AI tidak bisa dimuat. Periksa koneksi internet, dan pastikan halaman dibuka " +
          "lewat server (bukan file://).",
      );
    }
  }

  /* ---------- Pemetaan nama kelas -> kode ---------- */

  function klasifikasiNama(nama) {
    if (POLA_ABAIKAN.test(nama)) return { type: "none" };
    for (const item of POLA_KELAS) {
      const m = nama.match(item.pola);
      if (m) return { type: "kode", kode: item.kode || parseInt(m[1], 10) };
    }
    return { type: "unknown" };
  }

  // Gabungkan probabilitas semua kelas yang menuju kode yang sama.
  function gabungPerKode(preds) {
    const map = new Map();
    let none = 0;
    preds.forEach((p) => {
      const info = klasifikasiNama(p.className);
      if (info.type === "kode") {
        map.set(info.kode, (map.get(info.kode) || 0) + p.probability);
      } else {
        // Kelas apa pun yang bukan kode 1-7 (kaca, kain, background, dll.)
        // dianggap "bukan kode plastik" dan tidak pernah ditampilkan.
        none += p.probability;
      }
    });
    const list = Array.from(map.entries())
      .map(([kode, probability]) => ({ kode, probability }))
      .sort((a, b) => a.kode - b.kode);
    return { list, none };
  }

  // Petakan hasil MobileNet (nama benda) ke kode 1-7. Selalu mengembalikan
  // ketujuh kode supaya batang persentase lengkap.
  function gabungObjek(preds) {
    const jumlah = {};
    let ada = false;
    preds.forEach((p) => {
      for (const item of POLA_OBJEK) {
        if (item.pola.test(p.className)) {
          jumlah[item.kode] = (jumlah[item.kode] || 0) + p.probability;
          ada = true;
          break;
        }
      }
    });
    const list = [1, 2, 3, 4, 5, 6, 7].map((k) => ({
      kode: k,
      probability: Math.min(1, jumlah[k] || 0),
    }));
    return { list, ada };
  }

  // Haluskan antar frame agar hasil tidak berkedip.
  function haluskan(list) {
    const a = CONFIG.SMOOTHING;
    const baru = {};
    list.forEach((x) => {
      const prev = state.ema[x.kode];
      baru[x.kode] = prev === undefined ? x.probability : prev * (1 - a) + x.probability * a;
    });
    state.ema = baru;
    return list.map((x) => ({ kode: x.kode, probability: baru[x.kode] }));
  }

  /* ---------- Tampilan ---------- */

  function setVerdict(stateName, code, label, conf) {
    $("kameraAIVerdict").dataset.state = stateName;
    $("kameraAIVerdictCode").textContent = code;
    $("kameraAIVerdictLabel").textContent = label;
    $("kameraAIVerdictConf").textContent = conf || "";
  }

  function showOverlay(text) {
    const el = $("kameraAIOverlay");
    el.textContent = text || "";
    el.hidden = !text;
  }

  function showError(msg) {
    const el = $("kameraAIError");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function renderBars(list) {
    const wrap = $("kameraAIBars");
    if (wrap.children.length !== list.length) {
      wrap.innerHTML = list
        .map(
          () =>
            '<div class="kamera-ai-bar"><span></span>' +
            '<div class="kamera-ai-bar-track"><div class="kamera-ai-bar-fill"></div></div>' +
            "<span>0%</span></div>",
        )
        .join("");
    }
    list.forEach((x, i) => {
      const row = wrap.children[i];
      const persen = Math.round(x.probability * 100) + "%";
      row.children[0].textContent = labelKode(x.kode);
      row.querySelector(".kamera-ai-bar-fill").style.width = persen;
      row.children[2].textContent = persen;
    });
  }

  /* ---------- Loop deteksi ---------- */

  function handlePredictions(hasil) {
    const gabung = { none: hasil.none };
    const minConf = hasil.minConf;
    const list = haluskan(hasil.list);
    renderBars(list);

    // Model tidak punya kelas kode 1-7 sama sekali.
    if (!list.length) {
      state.locked = null;
      $("kameraAIUseBtn").disabled = true;
      setVerdict("idle", "?", "Jenis plastik belum dikenali", "");
      return;
    }

    const top = list.reduce((a, b) => (b.probability > a.probability ? b : a));
    const persenAngka = Math.round(top.probability * 100);
    const persen = persenAngka + "% yakin";
    const kedua = list
      .filter((x) => x.kode !== top.kode)
      .reduce((m, x) => Math.max(m, x.probability), 0);
    // Kesimpulan diambil dari kemungkinan TERTINGGI: cukup yakin, atau
    // unggul jelas dari kode lain (tidak perlu mencapai 100%).
    const unggul =
      top.probability >= minConf * 0.5 &&
      top.probability - kedua >= CONFIG.MIN_MARGIN &&
      top.probability > gabung.none;
    const yakin = top.probability >= minConf || unggul;
    const kunci = yakin ? "kode-" + top.kode : null;

    state.history.push(kunci);
    if (state.history.length > CONFIG.STABLE_FRAMES) state.history.shift();

    const stabil =
      state.history.length === CONFIG.STABLE_FRAMES &&
      state.history.every((k) => k && k === kunci);

    
    const nama = NAMA_KODE[top.kode];

    const judul = labelKode(top.kode);
    const lengkap = NAMA_LENGKAP[top.kode];

    if (stabil) {
      state.locked = { type: "kode", kode: top.kode };
      state.frozen = true; // tahan hasil; tekan "Ulangi Deteksi" untuk mengulang
      setVerdict("locked", "\u2713", judul, "Kesimpulan: " + lengkap + " | kemungkinan tertinggi " + persenAngka + "%");
      $("kameraAIUseBtn").disabled = false;
    } else if (kunci) {
      setVerdict("detecting", "\u2026", judul, lengkap + " | " + persenAngka + "% - menyimpulkan...");
    } else if (top.probability >= minConf * 0.65 && top.probability > gabung.none) {
      // Tebakan sementara, belum cukup yakin untuk dikunci.
      setVerdict(
        "idle",
        "?",
        "Mungkin " + judul,
        persenAngka + "% - tahan sampah di depan kamera agar lebih yakin.",
      );
    } else if (gabung.none > 0.5) {
      setVerdict(
        "idle",
        "?",
        "Jenis plastik belum dikenali",
        "Arahkan sampah plastik ke kamera, pastikan terlihat jelas dan cukup terang.",
      );
    } else {
      setVerdict("idle", "?", "Mengenali...", "Tahan sampah plastik di depan kamera sebentar.");
    }

    // Kalau deteksi menghilang, lepas kunci supaya tidak salah pakai.
    if (!stabil && !kunci) {
      state.locked = null;
      $("kameraAIUseBtn").disabled = true;
    }
  }

  // Jalankan pengenal: Teachable Machine dulu; kalau belum yakin ke kode
  // mana pun, coba pengenal benda umum (MobileNet).
  async function analisis(video) {
    let g = { list: [], none: 0 };
    if (state.model) g = gabungPerKode(await state.model.predict(video));
    const terbaik = g.list.reduce((m, x) => Math.max(m, x.probability), 0);

    if (state.obj && terbaik < CONFIG.MIN_CONFIDENCE) {
      const go = gabungObjek(await state.obj.classify(video, 5));
      if (go.ada) {
        return { list: go.list, none: 0, minConf: CONFIG.MIN_CONFIDENCE_OBJEK };
      }
    }
    return { list: g.list, none: g.none, minConf: CONFIG.MIN_CONFIDENCE };
  }

  function loop(session) {
    if (!state.running || session !== state.session) return;

    const video = $("kameraAIVideo");
    const siap = video.readyState >= 2 && video.videoWidth > 0 && !document.hidden;

    const next = () => {
      state.timer = setTimeout(() => loop(session), CONFIG.INTERVAL_MS);
    };

    if (!siap || state.frozen) return next();

    analisis(video)
      .then((hasil) => {
        if (session === state.session && state.running && !state.frozen) handlePredictions(hasil);
      })
      .catch((err) => console.error("Prediksi gagal:", err))
      .finally(() => {
        if (session === state.session) next();
      });
  }

  /* ---------- Kamera ---------- */

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const video = $("kameraAIVideo");
    if (video) video.srcObject = null;
  }

  async function startStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Kamera tidak tersedia. Buka ReLoop lewat HTTPS atau http://localhost, lalu coba lagi.",
      );
    }
    stopStream();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: state.facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    const video = $("kameraAIVideo");
    video.srcObject = state.stream;
    await video.play().catch(() => {});
  }

  function pesanError(err) {
    if (err && err.name === "NotAllowedError")
      return "Izin kamera ditolak. Izinkan akses kamera di browser, lalu buka kembali Kamera AI.";
    if (err && err.name === "NotFoundError")
      return "Kamera tidak ditemukan di perangkat ini.";
    if (err && err.name === "NotReadableError")
      return "Kamera sedang dipakai aplikasi lain.";
    return (err && err.message) || "Terjadi kesalahan pada kamera.";
  }

  /* ---------- API publik (dipanggil dari HTML) ---------- */

  async function openKameraAI() {
    const session = ++state.session;
    state.history = [];
    state.ema = {};
    state.frozen = false;
    state.locked = null;
    $("kameraAIUseBtn").disabled = true;
    $("kameraAIBars").innerHTML = "";
    showError("");
    setVerdict("idle", "?", "Menyiapkan...", "");
    showOverlay("Memuat model AI dan kamera...");
    $("kameraAIModal").classList.add("open");

    try {
      await Promise.all([loadSemuaModel(), startStream()]);
    } catch (err) {
      if (session !== state.session) return releaseIfClosed();
      showOverlay("");
      showError(pesanError(err));
      setVerdict("idle", "!", "Kamera AI belum bisa dipakai", "");
      stopStream();
      return;
    }

    if (session !== state.session) return releaseIfClosed(); // modal sudah ditutup

    showOverlay("");
    setVerdict("idle", "?", "Arahkan sampah plastik ke kamera", "Deteksi berjalan otomatis.");
    state.running = true;
    loop(session);
  }

  // Kalau modal ditutup saat kamera masih menyala (proses async terlambat),
  // matikan kamera supaya lampunya tidak tetap hidup.
  function releaseIfClosed() {
    if (!$("kameraAIModal").classList.contains("open")) stopStream();
  }

  function modelError(err) {
    console.error("Gagal memuat model:", err);
    throw new Error(
      "Model AI tidak bisa dimuat. Pastikan file model.json, metadata.json, dan weights.bin " +
        "ada di folder model/ (atau ubah CONFIG.MODEL_URL di ai-kamera.js), dan halaman dibuka " +
        "lewat server (bukan file://).",
    );
  }

  function closeKameraAI() {
    state.session++;
    state.running = false;
    clearTimeout(state.timer);
    stopStream();
    $("kameraAIModal").classList.remove("open");
  }

  // Ulangi: lepas hasil yang dibekukan dan mulai mendeteksi lagi.
  function ulangiKameraAI() {
    state.history = [];
    state.ema = {};
    state.frozen = false;
    state.locked = null;
    $("kameraAIUseBtn").disabled = true;
    $("kameraAIBars").innerHTML = "";
    showError("");
    if (state.running) {
      setVerdict("idle", "?", "Arahkan sampah plastik ke kamera", "Deteksi berjalan otomatis.");
    }
  }

  async function switchKameraAI() {
    if (!state.running) return;
    state.facing = state.facing === "environment" ? "user" : "environment";
    state.history = [];
    state.ema = {};
    state.frozen = false;
    state.locked = null;
    $("kameraAIUseBtn").disabled = true;
    try {
      await startStream();
    } catch (err) {
      showError(pesanError(err));
    }
  }

  // Kamera hanya mengisi Kode Daur Ulang (kategori plastik). Jenis Sampah
  // (Organik/Plastik) tidak diubah -- itu tetap dipilih pengguna sendiri.
  function useKameraAIResult() {
    const hasil = state.locked;
    if (!hasil || hasil.type !== "kode") return;

    $("jemputKodeDaur").value = String(hasil.kode);

    const note = $("jemputKameraNote");
    if (note) {
      note.textContent =
        "Kategori plastik terisi otomatis dari Kamera AI: " +
        labelKode(hasil.kode) +
        ".";
      note.hidden = false;
    }

    closeKameraAI();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("kameraAIModal").classList.contains("open")) {
      closeKameraAI();
    }
  });

  window.openKameraAI = openKameraAI;
  window.closeKameraAI = closeKameraAI;
  window.switchKameraAI = switchKameraAI;
  window.ulangiKameraAI = ulangiKameraAI;
  window.useKameraAIResult = useKameraAIResult;
})();
