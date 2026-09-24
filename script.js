/* =========================================
   KONFIGURASI GOOGLE PLACES API
   -----------------------------------------
   Supaya data bank sampah di halaman "Pengelola"
   benar-benar diambil real-time dari Google Maps
   (lengkap dengan foto aslinya), isi API key di
   bawah ini dengan Google Maps API key milik Anda.

   Cara mendapatkannya:
   1. Buka https://console.cloud.google.com/
   2. Buat/pilih project, aktifkan billing.
   3. Aktifkan "Places API (New)".
   4. Buat API key, lalu batasi (restrict) key
      tersebut hanya untuk domain website ReLoop
      Anda (HTTP referrer) supaya aman dipakai di
      sisi browser (client-side).
   5. Tempelkan API key ke variabel di bawah ini.

   Selama key ini masih kosong, ReLoop tetap
   berjalan normal dengan data pengelola yang
   sudah ada (manual + hasil "Daftar sebagai
   Pengelola"), hanya saja sinkronisasi Google
   Maps dinonaktifkan.
========================================= */

const GOOGLE_PLACES_API_KEY = ""; // <-- isi API key Google Maps di sini

let googleWasteBanksLoaded = false; // supaya tidak fetch berulang-ulang
let googleWasteBanksLoading = false;

/* =========================================
   NAVIGATION
========================================= */

function showPage(pageId) {
  // Halaman khusus akun Pengelola
  if (
    ["pihak-produksi", "profil-pengelola"].indexOf(pageId) !== -1 &&
    !(getCurrentUser() && getCurrentUser().role === "pengelola")
  ) {
    pageId = "login";
  }

  // Ambil semua halaman
  const pages = document.querySelectorAll(".page");

  // Sembunyikan semua halaman
  pages.forEach(function (page) {
    page.classList.remove("active-page");
  });

  // Tampilkan halaman yang dipilih
  const selectedPage = document.getElementById(pageId);

  if (selectedPage) {
    selectedPage.classList.add("active-page");
  }

  // Update tombol navbar
  const navButtons = document.querySelectorAll(".nav-button");

  navButtons.forEach(function (button) {
    button.classList.remove("active");

    if (button.dataset.page === pageId) {
      button.classList.add("active");
    }
  });

  // Kembali ke bagian paling atas
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  // Inisialisasi / refresh peta saat halaman terkait ditampilkan
  if (pageId === "home") {
    initHomeMap();
  } else if (pageId === "pengelola") {
    // Halaman Pengelola kini juga memuat "Ajukan Penjemputan" (dulunya
    // halaman terpisah "jemput"), jadi inisialisasi keduanya sekaligus.
    initPengelolaMap();
    loadGoogleWasteBanksIntoPage(false);
    renderJemputAuthState();
    populateJemputPengelolaSelect();
    renderJemputRekomendasi();
    renderRiwayatBatches();
    renderPanelPengelola();
  } else if (pageId === "dashboard") {
    renderDashboard();
  } else if (pageId === "portal-pengelola") {
    renderPortalPengelola();
  } else if (pageId === "produksi") {
    goToProductionSlide(0);
  } else if (pageId === "pihak-produksi") {
    renderPihakProduksi();
  } else if (pageId === "profil-pengelola") {
    renderProfilPengelola();
  }

  // Sinkronkan tampilan akun (navbar, tombol tambah produk, halaman
  // pengaturan) setiap kali berpindah halaman.
  updateAuthUI();
}

/* =========================================
   ALUR PRODUKSI - SLIDER
   -----------------------------------------
   Slider "Alur Produksi" di halaman Produksi.
   Tombol prev/next, tab nomor tahap, dan dot
   semuanya mengontrol tahap yang sedang aktif
   sehingga penjelasan tiap proses bisa dilihat
   satu per satu.
========================================= */

let productionSlideIndex = 0;
const PRODUCTION_SLIDE_COUNT = 4;

function goToProductionSlide(index) {
  const track = document.getElementById("productionSliderTrack");

  if (!track) return;

  // Batasi index supaya tidak keluar jangkauan
  if (index < 0) index = PRODUCTION_SLIDE_COUNT - 1;
  if (index > PRODUCTION_SLIDE_COUNT - 1) index = 0;

  productionSlideIndex = index;

  // Geser track slider
  track.style.transform = `translateX(-${index * 100}%)`;

  // Update tab aktif
  const tabs = document.querySelectorAll(".production-tab");

  tabs.forEach(function (tab) {
    const isActive = Number(tab.dataset.index) === index;

    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  // Update dot aktif
  const dots = document.querySelectorAll(".production-dot");

  dots.forEach(function (dot, dotIndex) {
    dot.classList.toggle("active", dotIndex === index);
  });
}

function nextProductionSlide() {
  goToProductionSlide(productionSlideIndex + 1);
}

function prevProductionSlide() {
  goToProductionSlide(productionSlideIndex - 1);
}

// Dukungan swipe (geser jari) di layar sentuh
(function setupProductionSwipe() {
  let touchStartX = 0;
  let touchEndX = 0;

  document.addEventListener("DOMContentLoaded", function () {
    const slider = document.getElementById("productionSlider");

    if (!slider) return;

    slider.addEventListener(
      "touchstart",
      function (e) {
        touchStartX = e.changedTouches[0].screenX;
      },
      { passive: true },
    );

    slider.addEventListener(
      "touchend",
      function (e) {
        touchEndX = e.changedTouches[0].screenX;

        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) < 40) return;

        if (diff > 0) {
          nextProductionSlide();
        } else {
          prevProductionSlide();
        }
      },
      { passive: true },
    );
  });
})();

/* =========================================
   NAVBAR BUTTON
========================================= */

document.querySelectorAll(".nav-button").forEach(function (button) {
  button.addEventListener("click", function () {
    const page = button.dataset.page;

    showPage(page);
  });
});

/* =========================================
   PILIH SAMPAH
========================================= */

function selectWaste(type) {
  showPage("pengelola");

  setTimeout(function () {
    filterManager(type);
  }, 100);
}

/* =========================================
   FILTER PENGELOLA
========================================= */

/* =========================================
   SUMBER DATA TUNGGAL: KATEGORI SAMPAH
   -----------------------------------------
   Prototipe ini sengaja dipersempit ke dua kategori sampah saja:
   Organik dan Plastik (Plastik punya sub-jenis Kode Daur Ulang 1-7,
   lihat KODE_DAUR_ULANG_LABELS di bawah). Semua tombol filter,
   dropdown, dan checkbox jenis sampah di seluruh halaman dibangun
   dari larik WASTE_CATEGORIES ini lewat renderCategoryUI() supaya
   kalau nanti kategori baru perlu ditambahkan lagi, cukup ubah di
   satu tempat ini saja.
========================================= */
const WASTE_CATEGORIES = ["Organik", "Plastik"];

function filterManager(category) {
  const managers = document.querySelectorAll(".manager-result");

  let found = false;

  const categoryLower = category.toLowerCase();

  managers.forEach(function (manager) {
    const categories = manager.dataset.category.toLowerCase().split(",");

    const matches = category === "Semua" || categories.includes(categoryLower);

    if (matches) {
      manager.style.display = "grid";

      found = true;
    } else {
      manager.style.display = "none";
    }
  });

  const notAvailable = document.getElementById("notAvailable");

  if (found) {
    notAvailable.style.display = "none";
  } else {
    notAvailable.style.display = "block";
  }
}

/* =========================================
   RENDER UI KATEGORI SAMPAH
   -----------------------------------------
   Membangun ulang semua tombol/checkbox/dropdown jenis sampah dari
   WASTE_CATEGORIES, supaya tidak ada daftar kategori yang ditulis
   berulang-ulang secara manual di banyak tempat.
========================================= */
function renderCategoryUI() {
  // Home: grid "Pilih Jenis Sampah"
  const wasteGrid = document.getElementById("wasteGrid");
  if (wasteGrid) {
    wasteGrid.innerHTML = WASTE_CATEGORIES.map(function (cat) {
      return (
        "<button onclick=\"selectWaste('" + cat + "')\">" + cat + "</button>"
      );
    }).join("");
  }

  // Pengelola: sidebar filter kategori (tombol "Semua Sampah" tetap statis)
  const categoryList = document.getElementById("categoryList");
  if (categoryList) {
    const generated = WASTE_CATEGORIES.map(function (cat) {
      return (
        "<button onclick=\"filterManager('" + cat + "')\">" + cat + "</button>"
      );
    }).join("");
    categoryList.insertAdjacentHTML("beforeend", generated);
  }

  // Modal "Daftar sebagai Pengelola": jenis sampah yang diterima
  const regGrid = document.getElementById("regCategoryGrid");
  if (regGrid) {
    regGrid.innerHTML = WASTE_CATEGORIES.map(function (cat) {
      return (
        '<label><input type="checkbox" value="' +
        cat +
        '" /> ' +
        cat +
        "</label>"
      );
    }).join("");
  }

  // Ajukan Penjemputan: dropdown "Jenis Sampah"
  const jemputJenis = document.getElementById("jemputJenis");
  if (jemputJenis) {
    jemputJenis.innerHTML = WASTE_CATEGORIES.map(function (cat) {
      return '<option value="' + cat + '">' + cat + "</option>";
    }).join("");
  }

  // Modal "Tambahkan Produk Baru": kategori produk
  const prodKategori = document.getElementById("prodKategori");
  if (prodKategori) {
    prodKategori.innerHTML = WASTE_CATEGORIES.map(function (cat) {
      return '<option value="' + cat + '">Produk ' + cat + "</option>";
    }).join("");
  }

  // Pembelian: sidebar filter kategori produk (tombol "Semua Produk" tetap statis)
  const productCategoryFilter = document.getElementById(
    "productCategoryFilter",
  );
  if (productCategoryFilter) {
    const generated = WASTE_CATEGORIES.map(function (cat) {
      return (
        "<button onclick=\"filterProduct('" +
        cat +
        "')\">Produk " +
        cat +
        "</button>"
      );
    }).join("");
    productCategoryFilter.insertAdjacentHTML("beforeend", generated);
  }

  // Sinkronkan visibilitas field Kode Daur Ulang dengan pilihan awal
  updateJemputKodeDaurVisibility();
}

/* =========================================
   SEARCH JENIS SAMPAH
========================================= */

const wasteSearch = document.getElementById("wasteSearch");

if (wasteSearch) {
  wasteSearch.addEventListener("input", function () {
    const search = wasteSearch.value.toLowerCase();

    const managers = document.querySelectorAll(".manager-result");

    let found = false;

    managers.forEach(function (manager) {
      const categories = manager.dataset.category.toLowerCase();

      if (categories.includes(search)) {
        manager.style.display = "grid";

        found = true;
      } else {
        manager.style.display = "none";
      }
    });

    const notAvailable = document.getElementById("notAvailable");

    if (search === "") {
      managers.forEach(function (manager) {
        manager.style.display = "grid";
      });

      notAvailable.style.display = "none";
    } else if (!found) {
      notAvailable.style.display = "block";
    } else {
      notAvailable.style.display = "none";
    }
  });
}

/* =========================================
   LOCATION
========================================= */

function getUserLocation() {
  const locationText = document.getElementById("locationText");

  if (!navigator.geolocation) {
    alert("Browser Anda tidak mendukung fitur lokasi.");

    return;
  }

  locationText.textContent = "Mencari lokasi Anda...";

  navigator.geolocation.getCurrentPosition(
    function (position) {
      const latitude = position.coords.latitude;

      const longitude = position.coords.longitude;

      locationText.textContent =
        "Lokasi ditemukan: " +
        latitude.toFixed(4) +
        ", " +
        longitude.toFixed(4);

      userLocation = { lat: latitude, lng: longitude };

      updateDistancesFromUserLocation();

      // Lokasi berubah -> sinkronkan ulang bank sampah Google Maps
      // supaya hasil pencarian sesuai lokasi terbaru pengguna.
      loadGoogleWasteBanksIntoPage(true);
    },

    function (error) {
      locationText.textContent = "Lokasi tidak dapat ditemukan.";

      alert(
        "Lokasi tidak dapat diakses. " +
          "Pastikan izin lokasi sudah diberikan.",
      );
    },
  );
}

/* =========================================
   DETAIL PENGELOLA
========================================= */

function showManagerDetail(name) {
  alert(
    "Detail Pengelola\n\n" +
      name +
      "\n\n" +
      "Nanti bagian ini akan dibuat menjadi halaman detail yang berisi:\n" +
      "- Foto pengelola\n" +
      "- Jenis sampah yang diterima\n" +
      "- Jam operasional\n" +
      "- Alamat\n" +
      "- Google Maps\n" +
      "- Nomor kontak\n" +
      "- Layanan penjemputan",
  );
}

/* =========================================
   HUBUNGI PENGELOLA
========================================= */

function contactManager(name, phone) {
  if (phone) {
    const digits = phone.replace(/[^0-9]/g, "");
    const nomorWa = digits.startsWith("0") ? "62" + digits.slice(1) : digits;

    const pesan = encodeURIComponent(
      "Halo, saya ingin bertanya mengenai layanan pengelolaan sampah di " +
        name +
        ".",
    );

    window.open("https://wa.me/" + nomorWa + "?text=" + pesan, "_blank");
    return;
  }

  alert(
    "Nomor kontak untuk " +
      name +
      " belum tersedia secara publik.\n\n" +
      "Silakan datang langsung ke lokasi, atau gunakan tombol " +
      '"Buka di Google Maps" untuk info lebih lanjut.',
  );
}

/* =========================================
   LIHAT DI GOOGLE MAPS
========================================= */

function viewOnGoogleMaps(lat, lng, mapsUri) {
  if (mapsUri) {
    window.open(mapsUri, "_blank");
    return;
  }

  window.open("https://www.google.com/maps?q=" + lat + "," + lng, "_blank");
}

/* =========================================
   EDUKASI (kini menjadi bagian dari Home)
========================================= */

// Edukasi tidak lagi jadi halaman terpisah, jadi tombol yang dulu memanggil
// showPage('edukasi') sekarang memakai ini: pastikan halaman Home aktif,
// lalu gulir ke bagian Edukasi di halaman tersebut.
function goToEducation() {
  showPage("home");

  setTimeout(function () {
    const target = document.getElementById("home-edukasi");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  }, 100);
}

function openEducation(type) {
  if (type === "plastik") {
    alert(
      "Cara Mengelola Sampah Plastik\n\n" +
        "1. Pisahkan plastik dari sampah lain.\n" +
        "2. Bersihkan plastik.\n" +
        "3. Keringkan.\n" +
        "4. Pisahkan berdasarkan jenis plastik.\n" +
        "5. Gunakan kembali atau kirim ke bank sampah.",
    );
  } else if (type === "kompos") {
    alert(
      "Cara Membuat Kompos\n\n" +
        "1. Siapkan sampah organik.\n" +
        "2. Potong menjadi bagian kecil.\n" +
        "3. Masukkan ke wadah kompos.\n" +
        "4. Jaga kelembapan.\n" +
        "5. Aduk secara berkala.\n" +
        "6. Tunggu sampai menjadi kompos.",
    );
  }
}

/* =========================================
   PEMBELIAN
========================================= */

// Data produk yang sedang dibuka di jendela "Detail Produk"
let currentProduct = { name: "", price: 0, kontak: "", qty: 1 };

// Ubah angka jadi format rupiah, contoh: 75000 -> "Rp 75.000"
function formatRupiah(angka) {
  return "Rp " + Number(angka).toLocaleString("id-ID");
}

// Dipanggil saat tombol "Beli Produk" ditekan.
// Fungsi ini mencari kartu produknya, lalu menampilkan nama & harga
// di jendela Detail Produk.
function buyProduct(productName, kontak) {
  // Cari kartu produk di halaman Pembelian berdasarkan nama produk
  const cards = document.querySelectorAll("#productGrid .shop-product");
  let card = null;

  cards.forEach(function (item) {
    const title = item.querySelector("h3");

    if (title && title.textContent.trim() === productName.trim()) {
      card = item;
    }
  });

  // Ambil harga dari kartu (contoh teks: "Rp 75.000" -> 75000)
  const priceEl = card ? card.querySelector("strong") : null;
  const price = priceEl
    ? Number(priceEl.textContent.replace(/[^0-9]/g, ""))
    : 0;

  const imgEl = card ? card.querySelector("img") : null;
  const categoryEl = card ? card.querySelector(":scope > span") : null;
  const descEl = card ? card.querySelector("p") : null;

  // Simpan data produk yang sedang dibuka
  currentProduct = {
    name: productName,
    price: price,
    kontak: kontak || "",
    qty: 1,
  };

  // Isi jendela Detail Produk (textContent lebih aman daripada innerHTML)
  document.getElementById("pdName").textContent = productName;
  document.getElementById("pdPrice").textContent = formatRupiah(price);
  document.getElementById("pdCategory").textContent = categoryEl
    ? categoryEl.textContent.trim().replace(/\s*Baru$/, "")
    : "";
  document.getElementById("pdDesc").textContent = descEl
    ? descEl.textContent.trim()
    : "Produk hasil daur ulang";

  const pdImage = document.getElementById("pdImage");
  pdImage.src = imgEl ? imgEl.getAttribute("src") : "";
  pdImage.alt = productName;

  document.getElementById("pdNote").hidden = true;

  updateProductTotal();

  document.getElementById("productDetailModal").classList.add("open");
}

// Tambah / kurangi jumlah beli (minimal 1)
function changeProductQty(delta) {
  currentProduct.qty = Math.max(1, currentProduct.qty + delta);
  updateProductTotal();
}

// Hitung ulang jumlah dan total harga
function updateProductTotal() {
  document.getElementById("pdQty").textContent = currentProduct.qty;
  document.getElementById("pdTotal").textContent = formatRupiah(
    currentProduct.price * currentProduct.qty,
  );
}

function closeProductDetail() {
  document.getElementById("productDetailModal").classList.remove("open");
}

// Tombol "Beli Sekarang" di jendela Detail Produk
function confirmBuyProduct() {
  // Jika produk dari fitur "Tambahkan Produk Baru" dan punya nomor kontak,
  // arahkan langsung ke WhatsApp penjual.
  if (currentProduct.kontak) {
    const digits = currentProduct.kontak.replace(/[^0-9]/g, "");
    const nomorWa = digits.startsWith("0") ? "62" + digits.slice(1) : digits;

    const pesan = encodeURIComponent(
      "Halo, saya tertarik dengan produk " +
        currentProduct.name +
        " (" +
        currentProduct.qty +
        " pcs, total " +
        formatRupiah(currentProduct.price * currentProduct.qty) +
        ") yang ada di ReLoop.",
    );

    window.open("https://wa.me/" + nomorWa + "?text=" + pesan, "_blank");
    return;
  }

  // Produk bawaan belum punya tautan penjual, tampilkan catatan
  document.getElementById("pdNote").hidden = false;
}

/* =========================================
   FILTER KATEGORI PRODUK (PEMBELIAN)
========================================= */

function filterProduct(category) {
  const products = document.querySelectorAll("#productGrid .shop-product");

  let found = false;

  products.forEach(function (product) {
    const productCategory = product.dataset.category || "";

    if (category === "Semua" || productCategory === category) {
      product.style.display = "flex";
      found = true;
    } else {
      product.style.display = "none";
    }
  });

  const notAvailable = document.getElementById("productNotAvailable");

  if (notAvailable) {
    notAvailable.style.display = found ? "none" : "block";
  }
}

/* Catatan: fungsi "makeProduct" (halaman Produk lama, tutorial DIY)
   dihapus bersama restrukturisasi navigasi. */

/* =========================================
   PRODUK DI HALAMAN PRODUKSI -> PEMBELIAN
   -----------------------------------------
   Dipanggil saat produk pada halaman Produksi
   ditekan. Membawa pengguna ke halaman
   Pembelian, memfilter sesuai kategori produk
   tersebut, lalu membuka detailnya supaya
   pengguna bisa lanjut melihat produk lain.
========================================= */

function viewProductInPembelian(productName, category) {
  showPage("pembelian");

  // Tunggu sebentar sampai halaman Pembelian aktif & grid produk
  // sudah tampil, baru filter kategori dan buka detail produknya.
  setTimeout(function () {
    if (category) {
      filterProduct(category);
    }

    if (productName) {
      buyProduct(productName);
    }
  }, 150);
}

/* =========================================
   SORT PENGELOLA
========================================= */

const sortManager = document.getElementById("sortManager");

function sortManagerListBy(value) {
  const list = document.getElementById("managerList");

  if (!list) return;

  const managers = Array.from(list.querySelectorAll(".manager-result"));

  if (value === "rating") {
    managers.sort(function (a, b) {
      const ratingA = parseFloat(a.querySelector(".rating").textContent);

      const ratingB = parseFloat(b.querySelector(".rating").textContent);

      return ratingB - ratingA;
    });
  } else {
    managers.sort(function (a, b) {
      const distanceA = parseFloat(
        a.querySelector(".distance").textContent.replace(",", "."),
      );

      const distanceB = parseFloat(
        b.querySelector(".distance").textContent.replace(",", "."),
      );

      return distanceA - distanceB;
    });
  }

  managers.forEach(function (manager) {
    list.appendChild(manager);
  });
}

if (sortManager) {
  sortManager.addEventListener("change", function () {
    sortManagerListBy(sortManager.value);
  });

  // Urutkan berdasarkan jarak sejak awal, supaya kartu pertama di
  // slide/carousel selalu tempat terdekat.
  sortManagerListBy(sortManager.value || "distance");
}

/* =========================================
   SLIDE / CAROUSEL HASIL PENCARIAN (ANDROID)
   -----------------------------------------
   Di layar sempit, #managerList jadi track horizontal (lihat
   style.css). Dua tombol ‹ › di bawah ini menggeser satu kartu
   per klik, dan titik-titik indikator + status tombol mengikuti
   kartu mana yang sedang terlihat lewat MutationObserver, jadi
   tetap sinkron walau daftar difilter/diurutkan/ditambah dari
   fungsi lain.
========================================= */
function getVisibleManagerCards() {
  const list = document.getElementById("managerList");

  if (!list) return [];

  return Array.from(list.querySelectorAll(".manager-result")).filter(
    function (card) {
      return card.style.display !== "none";
    },
  );
}

function slideManager(direction) {
  const list = document.getElementById("managerList");

  const cards = getVisibleManagerCards();

  if (!list || !cards.length) return;

  const cardWidth = cards[0].getBoundingClientRect().width + 14; // +gap

  list.scrollBy({ left: direction * cardWidth, behavior: "smooth" });
}

function updateManagerCarouselUI() {
  const list = document.getElementById("managerList");

  const dotsWrap = document.getElementById("managerCarouselDots");

  const prevBtn = document.getElementById("managerPrevBtn");

  const nextBtn = document.getElementById("managerNextBtn");

  if (!list) return;

  const cards = getVisibleManagerCards();

  if (dotsWrap) {
    const currentDotCount = dotsWrap.children.length;

    if (currentDotCount !== cards.length) {
      dotsWrap.innerHTML = cards
        .map(function () {
          return "<span></span>";
        })
        .join("");
    }
  }

  const dots = dotsWrap ? Array.from(dotsWrap.children) : [];

  if (!cards.length) {
    if (prevBtn) prevBtn.disabled = true;

    if (nextBtn) nextBtn.disabled = true;

    return;
  }

  const listLeft = list.getBoundingClientRect().left;

  let activeIndex = 0;

  let smallestDiff = Infinity;

  cards.forEach(function (card, index) {
    const diff = Math.abs(card.getBoundingClientRect().left - listLeft);

    if (diff < smallestDiff) {
      smallestDiff = diff;

      activeIndex = index;
    }
  });

  dots.forEach(function (dot, index) {
    dot.classList.toggle("active", index === activeIndex);
  });

  if (prevBtn) prevBtn.disabled = activeIndex === 0;

  if (nextBtn) nextBtn.disabled = activeIndex === cards.length - 1;
}

(function initManagerCarousel() {
  const list = document.getElementById("managerList");

  if (!list) return;

  let refreshQueued = false;

  function queueRefresh() {
    if (refreshQueued) return;

    refreshQueued = true;

    requestAnimationFrame(function () {
      refreshQueued = false;

      updateManagerCarouselUI();
    });
  }

  list.addEventListener("scroll", queueRefresh);

  window.addEventListener("resize", queueRefresh);

  const observer = new MutationObserver(queueRefresh);

  observer.observe(list, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });

  queueRefresh();
})();

/* =========================================
   PETA INTERAKTIF (LEAFLET + OPENSTREETMAP)
   -----------------------------------------
   Catatan: peta ini pakai Leaflet + OpenStreetMap
   karena bisa langsung jalan tanpa API key.
   Kalau nanti punya Google Maps API key
   (berbayar), tinggal ganti L.tileLayer di bawah
   dengan Google Maps JavaScript API memakai
   library seperti @googlemaps/js-api-loader.
========================================= */

const MALANG_CENTER = { lat: -7.9666, lng: 112.6326 };

let homeMapObj = null;
let pengelolaMapObj = null;
let homeMarkersLayer = null;
let pengelolaMarkersLayer = null;
let userMarkerHome = null;
let userMarkerPengelola = null;
let userLocation = null; // { lat, lng }

// Icon lingkaran biru untuk menandai lokasi pengguna
function createUserIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="user-location-marker"></div>',
    iconSize: [16, 16],
  });
}

// Ambil semua data bank sampah langsung dari DOM (#managerList)
// supaya data peta selalu sinkron dengan data yang tampil di daftar.
function getManagerData() {
  const articles = document.querySelectorAll("#managerList .manager-result");

  const data = [];

  articles.forEach(function (article) {
    const lat = parseFloat(article.dataset.lat);
    const lng = parseFloat(article.dataset.lng);

    if (isNaN(lat) || isNaN(lng)) return;

    data.push({
      el: article,
      lat: lat,
      lng: lng,
      name: article.querySelector("h3")
        ? article.querySelector("h3").textContent
        : "Bank Sampah",
      address: article.querySelector(".manager-info p:last-child")
        ? article.querySelector(".manager-info p:last-child").textContent
        : "",
    });
  });

  return data;
}

function initHomeMap() {
  const container = document.getElementById("homeMap");

  if (!container || typeof L === "undefined") return;

  if (!homeMapObj) {
    homeMapObj = L.map(container).setView(
      [MALANG_CENTER.lat, MALANG_CENTER.lng],
      13,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(homeMapObj);

    homeMarkersLayer = L.layerGroup().addTo(homeMapObj);

    renderMarkers(homeMapObj, homeMarkersLayer, getManagerData());
  }

  // Leaflet butuh invalidateSize saat container baru terlihat
  setTimeout(function () {
    homeMapObj.invalidateSize();
  }, 150);
}

function initPengelolaMap() {
  const container = document.getElementById("pengelolaMap");

  if (!container || typeof L === "undefined") return;

  if (!pengelolaMapObj) {
    pengelolaMapObj = L.map(container).setView(
      [MALANG_CENTER.lat, MALANG_CENTER.lng],
      13,
    );

    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(pengelolaMapObj);

    pengelolaMarkersLayer = L.layerGroup().addTo(pengelolaMapObj);

    renderMarkers(pengelolaMapObj, pengelolaMarkersLayer, getManagerData());
  } else {
    // Refresh marker (mungkin ada pengelola baru yang didaftarkan)
    renderMarkers(pengelolaMapObj, pengelolaMarkersLayer, getManagerData());
  }

  setTimeout(function () {
    pengelolaMapObj.invalidateSize();
  }, 150);
}

function renderMarkers(mapObj, layerGroup, managers) {
  layerGroup.clearLayers();

  managers.forEach(function (manager) {
    const marker = L.marker([manager.lat, manager.lng]).addTo(layerGroup);

    marker.bindPopup(
      "<strong>" +
        manager.name +
        "</strong><br>" +
        manager.address +
        "<br><button onclick=\"showManagerDetail('" +
        manager.name.replace(/'/g, "\\'") +
        '\')" style="margin-top:6px;background:#087153;color:white;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;">Lihat Detail</button>',
    );
  });
}

/* =========================================
   HAVERSINE - HITUNG JARAK ANTAR KOORDINAT
========================================= */

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // radius bumi (km)

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Update jarak tiap kartu pengelola berdasarkan lokasi pengguna sungguhan,
// lalu urutkan otomatis dari yang terdekat.
function updateDistancesFromUserLocation() {
  if (!userLocation) return;

  const managers = getManagerData();

  managers.forEach(function (manager) {
    const distance = haversineDistanceKm(
      userLocation.lat,
      userLocation.lng,
      manager.lat,
      manager.lng,
    );

    const distanceEl = manager.el.querySelector(".distance");

    if (distanceEl) {
      distanceEl.textContent = distance.toFixed(1).replace(".", ",") + " km";
      manager.el.dataset.distanceValue = distance;
    }
  });

  // Urutkan daftar berdasarkan jarak terdekat
  const list = document.getElementById("managerList");

  if (list) {
    const items = Array.from(list.querySelectorAll(".manager-result"));

    items.sort(function (a, b) {
      return (
        parseFloat(a.dataset.distanceValue || 999) -
        parseFloat(b.dataset.distanceValue || 999)
      );
    });

    items.forEach(function (item) {
      list.appendChild(item);
    });
  }

  // Tandai posisi pengguna di kedua peta
  if (homeMapObj) {
    if (userMarkerHome) homeMapObj.removeLayer(userMarkerHome);

    userMarkerHome = L.marker([userLocation.lat, userLocation.lng], {
      icon: createUserIcon(),
    })
      .addTo(homeMapObj)
      .bindPopup("Lokasi Anda");

    homeMapObj.setView([userLocation.lat, userLocation.lng], 13);
  }

  if (pengelolaMapObj) {
    if (userMarkerPengelola) pengelolaMapObj.removeLayer(userMarkerPengelola);

    userMarkerPengelola = L.marker([userLocation.lat, userLocation.lng], {
      icon: createUserIcon(),
    })
      .addTo(pengelolaMapObj)
      .bindPopup("Lokasi Anda");

    pengelolaMapObj.setView([userLocation.lat, userLocation.lng], 13);
  }
}

/* =========================================
   DAFTAR SEBAGAI PENGELOLA
========================================= */

let registerLocation = null; // { lat, lng } hasil GPS saat mengisi form

function openRegisterModal() {
  const modal = document.getElementById("registerModal");

  if (modal) modal.classList.add("open");
}

function closeRegisterModal() {
  const modal = document.getElementById("registerModal");

  if (modal) modal.classList.remove("open");
}

function captureRegisterLocation() {
  const status = document.getElementById("regLokasiStatus");

  if (!navigator.geolocation) {
    status.textContent = "Browser Anda tidak mendukung fitur lokasi.";
    return;
  }

  status.textContent = "Mengambil lokasi Anda...";

  navigator.geolocation.getCurrentPosition(
    function (position) {
      registerLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      status.textContent =
        "Lokasi berhasil diambil: " +
        registerLocation.lat.toFixed(4) +
        ", " +
        registerLocation.lng.toFixed(4);
    },
    function () {
      status.textContent =
        "Lokasi tidak dapat diakses. Pastikan izin lokasi sudah diberikan.";
    },
  );
}

function getStoredManagers() {
  try {
    const raw = localStorage.getItem("reloop_pengelola_terdaftar");

    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredManagers(list) {
  try {
    localStorage.setItem("reloop_pengelola_terdaftar", JSON.stringify(list));
  } catch (error) {
    console.error("Gagal menyimpan data pengelola:", error);
  }
}

// Buat elemen kartu <article> baru untuk pengelola yang baru didaftarkan
// ATAU untuk pengelola hasil sinkronisasi Google Maps (data.source === "google").
function buildManagerCard(data) {
  const article = document.createElement("article");

  const isGoogle = data.source === "google";

  article.className = "manager-result";
  article.dataset.category = data.categories.join(",");
  article.dataset.lat = data.lat;
  article.dataset.lng = data.lng;
  if (isGoogle) article.dataset.source = "google";

  const badge = data.seed
    ? '<span class="new-badge new-badge--google">Terdaftar di ReLoop</span>'
    : isGoogle
    ? '<span class="new-badge new-badge--google">Data Google Maps</span>'
    : '<span class="new-badge">Baru Didaftarkan</span>';

  const fotoSrc = data.foto || "botol.webp";

  const ratingHtml = isGoogle
    ? '<p class="rating">★ ' +
      (data.rating ? data.rating.toFixed(1) : "-") +
      " (" +
      (data.jumlahUlasan || 0) +
      " ulasan Google)</p>"
    : '<p class="rating">★ Belum ada ulasan</p>';

  const pengelolaBaris = isGoogle
    ? "<p>Sumber: Google Maps</p>"
    : "<p>Pengelola: " + data.ketua + "</p>";

  const infoTambahan = isGoogle
    ? "<p>Kategori sampah belum diverifikasi (perkiraan bank sampah umum)</p>"
    : "<p>Jumlah Karyawan: " + data.jumlahKaryawan + "</p>";

  // Badge kelas pengelola + bar kapasitas harian (hanya untuk pengelola
  // yang mendaftar langsung di Reloop, bukan hasil sinkronisasi Google Maps,
  // karena data kelas/kapasitas hanya diisi lewat form pendaftaran Reloop).
  let kelasCapacityHtml = "";
  if (!isGoogle && data.kelas) {
    const isInstitusional = data.kelas === "institusional";
    const kelasLabel = isInstitusional
      ? '<span class="kelas-badge kelas-badge--institusional">🏛 Institusional</span>'
      : '<span class="kelas-badge kelas-badge--mandiri">👤 Mandiri</span>';

    const kapasitas = data.kapasitas || 0;
    const terpakai = getVerifiedWeightTodayFor(data.namaTempat);
    const sisa = Math.max(kapasitas - terpakai, 0);
    const pct = kapasitas > 0 ? Math.min((terpakai / kapasitas) * 100, 100) : 0;

    kelasCapacityHtml =
      '<div class="capacity-box">' +
      kelasLabel +
      '<div class="capacity-bar"><div class="capacity-bar-fill" style="width:' +
      pct +
      '%"></div></div>' +
      "<small>Kapasitas hari ini: " +
      terpakai +
      " / " +
      kapasitas +
      " kg terpakai (sisa " +
      sisa +
      " kg)</small>" +
      "</div>";
  }

  // Untuk hasil Google, tombol utama memakai nomor telepon jika tersedia
  // (langsung ke WhatsApp), atau diarahkan ke Google Maps jika tidak ada.
  const mapsButtonHtml = isGoogle
    ? '<button class="secondary-button" onclick="viewOnGoogleMaps(' +
      data.lat +
      ", " +
      data.lng +
      ", '" +
      (data.googleMapsUri || "").replace(/'/g, "\\'") +
      "')\">Lihat di Google Maps</button>"
    : '<button class="secondary-button" onclick="viewOnGoogleMaps(' +
      data.lat +
      ", " +
      data.lng +
      ')">Lihat di Google Maps</button>';

  const actionButtons = isGoogle
    ? (data.telepon
        ? '<button class="primary-button" onclick="contactManager(\'' +
          data.namaTempat.replace(/'/g, "\\'") +
          "', '" +
          data.telepon.replace(/'/g, "\\'") +
          "')\">Hubungi</button>" +
          mapsButtonHtml
        : '<button class="primary-button" onclick="window.open(\'' +
          (data.googleMapsUri || "https://www.google.com/maps").replace(
            /'/g,
            "\\'",
          ) +
          "', '_blank')\">Buka di Google Maps</button>") +
      '<button class="secondary-button" onclick="showManagerDetail(\'' +
      data.namaTempat.replace(/'/g, "\\'") +
      "')\">Lihat Detail →</button>"
    : '<button class="primary-button" onclick="contactManager(\'' +
      data.namaTempat.replace(/'/g, "\\'") +
      "', '" +
      (data.telepon || "").replace(/'/g, "\\'") +
      "')\">Hubungi</button>" +
      mapsButtonHtml +
      '<button class="secondary-button" onclick="showManagerDetail(\'' +
      data.namaTempat.replace(/'/g, "\\'") +
      "')\">Lihat Detail →</button>";

  article.innerHTML =
    '<img src="' +
    fotoSrc +
    '" alt="' +
    data.namaTempat +
    '" />' +
    '<div class="manager-info">' +
    '<span class="distance">- km</span>' +
    "<h3>" +
    data.namaTempat +
    badge +
    "</h3>" +
    pengelolaBaris +
    ratingHtml +
    "<p>" +
    data.alamat +
    "</p>" +
    "</div>" +
    '<div class="manager-services">' +
    '<div class="tags">' +
    data.categories
      .map(function (c) {
        return "<span>" + c + "</span>";
      })
      .join("") +
    "</div>" +
    "<p>Buka: " +
    (data.jamOperasional || "Belum diisi") +
    "</p>" +
    infoTambahan +
    kelasCapacityHtml +
    "</div>" +
    '<div class="manager-actions">' +
    actionButtons +
    "</div>";

  return article;
}

/* =========================================
   SINKRONISASI BANK SAMPAH DARI GOOGLE MAPS
   -----------------------------------------
   Memakai Places API (New) - Text Search, supaya
   pencarian "bank sampah" di sekitar lokasi
   pengguna bisa diambil beserta rating, alamat,
   dan foto aslinya dari Google.
========================================= */

async function fetchGoogleWasteBanks(center) {
  const endpoint = "https://places.googleapis.com/v1/places:searchText";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location," +
        "places.rating,places.userRatingCount,places.photos," +
        "places.googleMapsUri,places.id,places.nationalPhoneNumber",
    },
    body: JSON.stringify({
      textQuery: "bank sampah",
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: 8000.0,
        },
      },
      maxResultCount: 15,
      languageCode: "id",
    }),
  });

  if (!response.ok) {
    throw new Error("Gagal mengambil data dari Google Places API.");
  }

  const json = await response.json();

  return (json.places || []).map(function (place) {
    let photoUrl = null;

    if (place.photos && place.photos.length > 0) {
      photoUrl =
        "https://places.googleapis.com/v1/" +
        place.photos[0].name +
        "/media?maxWidthPx=500&key=" +
        GOOGLE_PLACES_API_KEY;
    }

    return {
      namaTempat: place.displayName ? place.displayName.text : "Bank Sampah",
      alamat: place.formattedAddress || "Alamat tidak tersedia",
      lat: place.location ? place.location.latitude : center.lat,
      lng: place.location ? place.location.longitude : center.lng,
      rating: place.rating || null,
      jumlahUlasan: place.userRatingCount || 0,
      telepon: place.nationalPhoneNumber || null,
      // Places API tidak menyediakan rincian jenis sampah yang diterima,
      // jadi dipakai kategori umum sebagai perkiraan awal.
      categories: ["Plastik"],
      foto: photoUrl,
      googleMapsUri: place.googleMapsUri || null,
      source: "google",
      googlePlaceId: place.id,
    };
  });
}

async function loadGoogleWasteBanksIntoPage(forceRefresh) {
  const statusEl = document.getElementById("googleSyncStatus");
  const list = document.getElementById("managerList");

  if (!list) return;

  if (!GOOGLE_PLACES_API_KEY) {
    if (statusEl) {
      statusEl.textContent =
        "Sinkronisasi Google Maps belum aktif. Tambahkan API key Google " +
        "Maps pada script.js (GOOGLE_PLACES_API_KEY) agar data bank " +
        "sampah dari Google Maps otomatis tampil di sini.";
    }
    return;
  }

  if (googleWasteBanksLoading) return;

  if (googleWasteBanksLoaded && !forceRefresh) return;

  googleWasteBanksLoading = true;

  if (statusEl) {
    statusEl.textContent = "Mengambil data bank sampah dari Google Maps...";
  }

  const center = userLocation || MALANG_CENTER;

  try {
    const results = await fetchGoogleWasteBanks(center);

    // Hapus kartu Google lama sebelum menambahkan hasil terbaru,
    // supaya tidak ada duplikat saat tombol "Perbarui" ditekan.
    list
      .querySelectorAll('.manager-result[data-source="google"]')
      .forEach(function (el) {
        el.remove();
      });

    results.forEach(function (data) {
      const card = buildManagerCard(data);
      list.appendChild(card);
    });

    if (pengelolaMapObj) {
      renderMarkers(pengelolaMapObj, pengelolaMarkersLayer, getManagerData());
    }

    if (userLocation) {
      updateDistancesFromUserLocation();
    }

    googleWasteBanksLoaded = true;

    if (statusEl) {
      statusEl.textContent =
        results.length > 0
          ? "Menampilkan " +
            results.length +
            " bank sampah dari Google Maps di sekitar Anda."
          : "Tidak ditemukan bank sampah dari Google Maps di sekitar lokasi ini.";
    }
  } catch (error) {
    console.error(error);

    if (statusEl) {
      statusEl.textContent =
        "Gagal mengambil data dari Google Maps. Periksa API key dan " +
        "koneksi internet Anda, lalu coba tombol perbarui lagi.";
    }
  } finally {
    googleWasteBanksLoading = false;
  }
}

function handleRegisterSubmit(event) {
  event.preventDefault();

  const namaTempat = document.getElementById("regNamaTempat").value.trim();
  const ketua = document.getElementById("regKetua").value.trim();
  const jumlahKaryawan = document.getElementById("regJumlahKaryawan").value;
  const telepon = document.getElementById("regTelepon").value.trim();
  const alamat = document.getElementById("regAlamat").value.trim();
  const jamOperasional = document
    .getElementById("regJamOperasional")
    .value.trim();

  const kelasInput = document.querySelector(
    "#registerForm input[name='regKelas']:checked",
  );
  const kelas = kelasInput ? kelasInput.value : "mandiri";
  const kapasitas =
    parseFloat(document.getElementById("regKapasitas").value) || 0;

  const categories = Array.from(
    document.querySelectorAll("#registerForm .reg-checkbox-grid input:checked"),
  ).map(function (input) {
    return input.value;
  });

  if (categories.length === 0) {
    alert("Pilih minimal satu jenis sampah yang diterima.");
    return;
  }

  // Kalau pengguna belum menekan tombol "Gunakan Lokasi Saya", titik lokasi
  // akan memakai pusat Kota Malang sebagai perkiraan sementara. Untuk
  // penempatan titik yang akurat sesuai alamat yang diketik, dibutuhkan
  // layanan geocoding (misalnya Google Geocoding API berbayar).
  const finalLocation = registerLocation || MALANG_CENTER;

  const owner = getCurrentUser();

  const data = {
    namaTempat: namaTempat,
    ketua: ketua,
    jumlahKaryawan: jumlahKaryawan,
    telepon: telepon,
    alamat: alamat,
    jamOperasional: jamOperasional,
    categories: categories,
    lat: finalLocation.lat,
    lng: finalLocation.lng,
    isApprox: !registerLocation,
    kelas: kelas, // 'institusional' atau 'mandiri'
    kapasitas: kapasitas, // kg per hari
    ownerEmail: owner ? owner.email : null,
  };

  // Simpan ke localStorage supaya tetap ada setelah halaman dimuat ulang
  const stored = getStoredManagers();
  stored.push(data);
  saveStoredManagers(stored);

  // Tambahkan langsung ke daftar & peta
  const list = document.getElementById("managerList");
  const card = buildManagerCard(data);
  list.appendChild(card);

  if (pengelolaMapObj) {
    renderMarkers(pengelolaMapObj, pengelolaMarkersLayer, getManagerData());
  }

  if (userLocation) {
    updateDistancesFromUserLocation();
  }

  document.getElementById("registerForm").reset();
  registerLocation = null;
  document.getElementById("regLokasiStatus").textContent =
    "Lokasi belum diambil. Titik lokasi menentukan posisi di peta.";

  closeRegisterModal();

  alert(
    "Terima kasih! " +
      namaTempat +
      " berhasil didaftarkan dan sekarang tampil di daftar & peta pengelola." +
      (data.isApprox
        ? '\n\nCatatan: karena lokasi GPS belum diambil, titik pada peta memakai perkiraan pusat Kota Malang. Gunakan tombol "Gunakan Lokasi Saya" agar posisinya akurat.'
        : ""),
  );
}

// Muat kembali data pengelola yang pernah didaftarkan (localStorage)
// setiap kali halaman dibuka ulang.
function loadStoredManagersOnStart() {
  const stored = getStoredManagers();

  if (stored.length === 0) return;

  const list = document.getElementById("managerList");

  if (!list) return;

  stored.forEach(function (data) {
    // Tempat bawaan (akun seed) sudah punya kartu statis di HTML
    if (data.seed && managerCardExists(data.namaTempat)) return;
    const card = buildManagerCard(data);
    list.appendChild(card);
  });
}

// Tutup modal jika klik area gelap di luar kotak modal
document.addEventListener("click", function (event) {
  const modal = document.getElementById("registerModal");

  if (modal && event.target === modal) {
    closeRegisterModal();
  }
});

/* =========================================
   TAMBAHKAN PRODUK BARU (MUNCUL DI PEMBELIAN)
========================================= */

let productPhotoDataUrl = null; // foto produk hasil unggahan, disimpan sbg data URL

function openProductModal() {
  const modal = document.getElementById("productModal");

  if (modal) modal.classList.add("open");

  populateProductBatchOptions();
}

// Isi dropdown "Kode Batch Asal" hanya dengan batch milik pengelola yang
// sedang login, yang sudah terverifikasi, dan belum dipakai produk lain.
function populateProductBatchOptions() {
  const select = document.getElementById("prodKodeBatch");
  if (!select) return;

  select.innerHTML =
    '<option value="">Tidak dihubungkan ke penjemputan Reloop</option>';

  const user = getCurrentUser();
  if (!user) return;

  const myManagers = getStoredManagers().filter(function (m) {
    return m.ownerEmail === user.email;
  });

  const myNames = myManagers.map(function (m) {
    return m.namaTempat;
  });

  const batches = getStoredBatches().filter(function (b) {
    return (
      myNames.includes(b.pengelolaTujuan) &&
      (b.status === "terverifikasi" || b.status === "ditinjau") &&
      !b.usedInProduct
    );
  });

  batches.forEach(function (b) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent =
      b.id +
      " — " +
      (b.verifiedJenis || b.jenisDeclared) +
      ", " +
      b.verifiedWeight +
      " kg";
    select.appendChild(opt);
  });
}

function closeProductModal() {
  const modal = document.getElementById("productModal");

  if (modal) modal.classList.remove("open");
}

function handleProductPhotoChange(event) {
  const file = event.target.files && event.target.files[0];
  const preview = document.getElementById("prodFotoPreview");

  if (!file) {
    productPhotoDataUrl = null;
    if (preview) preview.innerHTML = "Belum ada foto dipilih.";
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    productPhotoDataUrl = e.target.result;

    if (preview) {
      preview.innerHTML =
        '<img src="' + productPhotoDataUrl + '" alt="Pratinjau produk" />';
    }
  };

  reader.readAsDataURL(file);
}

function getStoredProducts() {
  try {
    const raw = localStorage.getItem("reloop_produk_tambahan");

    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredProducts(list) {
  try {
    localStorage.setItem("reloop_produk_tambahan", JSON.stringify(list));
  } catch (error) {
    console.error("Gagal menyimpan data produk:", error);
  }
}

// Buat elemen kartu <article> produk baru, memakai struktur yang sama
// dengan produk bawaan di halaman Pembelian (.shop-product).
function buildProductCard(data) {
  const article = document.createElement("article");

  article.className = "shop-product";
  article.dataset.category = data.kategori;

  const namaAman = data.nama.replace(/'/g, "\\'");
  const kontakAman = data.kontak.replace(/'/g, "\\'");

  const traceHtml = data.kodeBatch
    ? '<span class="trace-badge" onclick="showBatchOrigin(\'' +
      data.kodeBatch +
      "')\">🔗 Kode Lacak: " +
      data.kodeBatch +
      " &mdash; Lihat Asal</span>"
    : '<span class="trace-badge trace-badge--none">Belum tertelusuri ke batch penjemputan</span>';

  article.innerHTML =
    '<img src="' +
    data.foto +
    '" alt="' +
    data.nama +
    '" />' +
    "<span> Dari " +
    data.kategori +
    ' <span class="new-badge">Baru</span></span>' +
    "<h3>" +
    data.nama +
    "</h3>" +
    "<p>" +
    (data.deskripsi || "Produk hasil daur ulang") +
    "</p>" +
    traceHtml +
    "<strong> Rp " +
    Number(data.harga).toLocaleString("id-ID") +
    " </strong>" +
    "<button onclick=\"buyProduct('" +
    namaAman +
    "', '" +
    kontakAman +
    "')\">Beli Produk</button>";

  return article;
}

// Tampilkan asal-usul produk berdasarkan kode batch yang ditautkan
// (traceability sederhana: kode batch -> data penjemputan terverifikasi).
function showBatchOrigin(kodeBatch) {
  const batches = getStoredBatches();
  const batch = batches.find(function (b) {
    return b.id === kodeBatch;
  });

  if (!batch) {
    alert(
      "Kode batch " +
        kodeBatch +
        " tidak ditemukan di data penjemputan perangkat ini.",
    );
    return;
  }

  alert(
    "Jejak Asal Produk\n\n" +
      "Kode Batch: " +
      batch.id +
      "\n" +
      "Jenis Sampah: " +
      (batch.verifiedJenis || batch.jenisDeclared) +
      "\n" +
      "Berat Terverifikasi: " +
      (batch.verifiedWeight != null
        ? batch.verifiedWeight +
          " kg (deklarasi awal: " +
          batch.beratDeclared +
          " kg)"
        : "Belum diverifikasi") +
      "\n" +
      "Pengelola: " +
      batch.pengelolaTujuan +
      "\n" +
      "Status: " +
      formatBatchStatus(batch.status) +
      "\n" +
      "Tanggal Verifikasi: " +
      (batch.tanggalVerifikasi
        ? new Date(batch.tanggalVerifikasi).toLocaleString("id-ID")
        : "-"),
  );
}

function handleProductSubmit(event) {
  event.preventDefault();

  const nama = document.getElementById("prodNama").value.trim();
  const kategori = document.getElementById("prodKategori").value;
  const harga = document.getElementById("prodHarga").value;
  const kontak = document.getElementById("prodKontak").value.trim();
  const deskripsi = document.getElementById("prodDeskripsi").value.trim();
  const kodeBatchEl = document.getElementById("prodKodeBatch");
  const kodeBatch = kodeBatchEl ? kodeBatchEl.value : "";

  if (!productPhotoDataUrl) {
    alert("Silakan unggah foto produk terlebih dahulu.");
    return;
  }

  const data = {
    nama: nama,
    kategori: kategori,
    harga: harga,
    kontak: kontak,
    deskripsi: deskripsi,
    foto: productPhotoDataUrl,
    kodeBatch: kodeBatch || null,
    ownerEmail: (getCurrentUser() || {}).email || null,
  };

  // Simpan ke localStorage supaya produk tetap ada setelah halaman dimuat ulang
  const stored = getStoredProducts();
  stored.push(data);
  saveStoredProducts(stored);

  // Kunci batch ini supaya tidak dipakai berulang oleh produk lain
  if (kodeBatch) {
    const batches = getStoredBatches();
    const batch = batches.find(function (b) {
      return b.id === kodeBatch;
    });
    if (batch) {
      batch.usedInProduct = true;
      saveStoredBatches(batches);
    }
  }

  // Tambahkan langsung ke grid produk di halaman Pembelian
  const grid = document.getElementById("productGrid");

  if (grid) {
    const card = buildProductCard(data);
    grid.appendChild(card);
  }

  document.getElementById("productForm").reset();
  productPhotoDataUrl = null;
  document.getElementById("prodFotoPreview").innerHTML =
    "Belum ada foto dipilih.";

  closeProductModal();

  alert(
    "Produk " +
      nama +
      " berhasil diunggah dan sekarang tampil di menu Pembelian.",
  );
}

// Muat kembali produk yang pernah diunggah (localStorage) setiap kali
// halaman dibuka ulang.
function loadStoredProductsOnStart() {
  const stored = getStoredProducts();

  if (stored.length === 0) return;

  const grid = document.getElementById("productGrid");

  if (!grid) return;

  stored.forEach(function (data) {
    const card = buildProductCard(data);
    grid.appendChild(card);
  });
}

// Tutup modal produk jika klik area gelap di luar kotak modal
document.addEventListener("click", function (event) {
  const modal = document.getElementById("productModal");

  if (modal && event.target === modal) {
    closeProductModal();
  }
});

/* =========================================
   JEMPUT SAMPAH: PASPOR DIGITAL (KODE BATCH)
   -----------------------------------------
   Setiap pengajuan penjemputan disimpan sebagai satu "batch" dengan
   status declared -> verified, supaya bisa dibedakan klaim awal
   pengguna dengan hasil konfirmasi pengelola saat menerima sampah.
========================================= */

function getStoredBatches() {
  try {
    const raw = localStorage.getItem("reloop_batches");
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredBatches(list) {
  try {
    localStorage.setItem("reloop_batches", JSON.stringify(list));
  } catch (error) {
    console.error("Gagal menyimpan data batch:", error);
  }
}

function generateBatchId() {
  const random = Math.floor(Math.random() * 90000) + 10000;
  return "RL-" + random;
}

function formatBatchStatus(status) {
  if (status === "diajukan") return "Diajukan (menunggu verifikasi)";
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "ditinjau")
    return "Terverifikasi, tapi ditinjau (selisih besar)";
  return status;
}

// Total berat batch yang sudah diverifikasi HARI INI untuk satu nama
// pengelola tertentu. Dipakai untuk menghitung sisa kapasitas harian.
function getVerifiedWeightTodayFor(namaTempat) {
  const today = new Date().toDateString();

  const batches = getStoredBatches();

  return batches
    .filter(function (b) {
      return (
        b.pengelolaTujuan === namaTempat &&
        (b.status === "terverifikasi" || b.status === "ditinjau") &&
        b.tanggalVerifikasi &&
        new Date(b.tanggalVerifikasi).toDateString() === today
      );
    })
    .reduce(function (sum, b) {
      return sum + (b.verifiedWeight || 0);
    }, 0);
}

// Isi dropdown "Pengelola Tujuan" di form Jemput dari daftar pengelola
// yang tampil di halaman Pengelola (gabungan data statis + terdaftar +
// hasil sinkronisasi Google Maps), supaya konsisten dengan fitur lokasi.
// Ambil nama + koordinat semua pengelola yang tampil di #managerList
// (baik data statis, hasil "Daftar sebagai Pengelola", maupun sinkronisasi
// Google Maps). Nama di-strip dari badge "Baru" supaya konsisten dengan
// nilai yang dipakai di <select> "Pengelola Tujuan".
function getManagerLocations() {
  const articles = document.querySelectorAll("#managerList .manager-result");

  const seen = new Set();
  const data = [];

  articles.forEach(function (article) {
    const lat = parseFloat(article.dataset.lat);
    const lng = parseFloat(article.dataset.lng);

    if (isNaN(lat) || isNaN(lng)) return;

    let name = "";
    const h3 = article.querySelector("h3");

    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelectorAll(".new-badge").forEach(function (b) {
        b.remove();
      });
      name = clone.textContent.trim();
    }

    if (!name || seen.has(name)) return;
    seen.add(name);

    data.push({ lat: lat, lng: lng, name: name });
  });

  return data;
}

function populateJemputPengelolaSelect() {
  const select = document.getElementById("jemputPengelola");
  if (!select) return;

  const locations = getManagerLocations();

  if (locations.length === 0) {
    select.innerHTML = '<option value="">Belum ada pengelola tersedia</option>';
    return;
  }

  // Urutkan dari yang terdekat kalau lokasi pengguna sudah didapat.
  if (userLocation) {
    locations.forEach(function (m) {
      m.distance = haversineDistanceKm(
        userLocation.lat,
        userLocation.lng,
        m.lat,
        m.lng,
      );
    });

    locations.sort(function (a, b) {
      return a.distance - b.distance;
    });
  }

  const previousValue = select.value;

  select.innerHTML = "";

  locations.forEach(function (m) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent =
      m.name +
      (m.distance != null
        ? " (" + m.distance.toFixed(1).replace(".", ",") + " km)"
        : "");
    select.appendChild(opt);
  });

  const stillExists = locations.some(function (m) {
    return m.name === previousValue;
  });

  if (previousValue && stillExists) {
    select.value = previousValue;
  }
}

/* =========================================
   AKSES HALAMAN JEMPUT SAMPAH
   -----------------------------------------
   Form pengajuan hanya ditampilkan untuk akun yang sudah login.
   Tamu tetap bisa melihat rekomendasi pengelola terdekat & peta, tapi
   diarahkan untuk masuk/daftar dulu sebelum bisa mengajukan penjemputan.
========================================= */

function renderJemputAuthState() {
  const form = document.getElementById("jemputForm");
  const lockedNote = document.getElementById("jemputLockedNote");
  if (!form || !lockedNote) return;

  const user = getCurrentUser();

  if (user) {
    form.style.display = "flex";
    lockedNote.style.display = "none";
  } else {
    form.style.display = "none";
    lockedNote.style.display = "block";
  }
}

/* =========================================
   REKOMENDASI PENGELOLA TERDEKAT & RUTE
   (halaman Jemput Sampah)
========================================= */

let jemputMapObj = null;
let jemputMarkersLayer = null;
let jemputRouteLine = null;

// Rata-rata kecepatan tempuh dalam kota yang dipakai untuk memperkirakan
// waktu tempuh dari jarak garis lurus (prototipe, tanpa mesin routing jalan).
const JEMPUT_ASUMSI_KECEPATAN_KMJAM = 25;

function renderJemputRekomendasi() {
  const list = document.getElementById("jemputRekomendasiList");
  if (!list) return;

  const locations = getManagerLocations();

  if (locations.length === 0) {
    list.innerHTML = '<p class="empty-note">Belum ada data pengelola.</p>';
    renderJemputMap([]);
    return;
  }

  if (!userLocation) {
    list.innerHTML =
      '<p class="empty-note">Aktifkan izin lokasi untuk melihat pengelola terdekat dari Anda.</p>' +
      '<button type="button" class="secondary-button" onclick="requestJemputLocation()">📍 Gunakan Lokasi Saya</button>';
    renderJemputMap(locations);
    return;
  }

  locations.forEach(function (m) {
    m.distance = haversineDistanceKm(
      userLocation.lat,
      userLocation.lng,
      m.lat,
      m.lng,
    );
  });

  locations.sort(function (a, b) {
    return a.distance - b.distance;
  });

  const top = locations.slice(0, 5);
  const selected = document.getElementById("jemputPengelola")
    ? document.getElementById("jemputPengelola").value
    : "";

  list.innerHTML = top
    .map(function (m) {
      return (
        '<button type="button" class="jemput-rekomendasi-item' +
        (m.name === selected ? " active" : "") +
        '" data-manager="' +
        m.name.replace(/"/g, "&quot;") +
        '">' +
        "<span>" +
        m.name +
        "</span>" +
        '<span class="distance">' +
        m.distance.toFixed(1).replace(".", ",") +
        " km</span>" +
        "</button>"
      );
    })
    .join("");

  renderJemputMap(top);
}

function requestJemputLocation() {
  if (!navigator.geolocation) {
    alert("Browser Anda tidak mendukung fitur lokasi.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (position) {
      userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      updateDistancesFromUserLocation();
      populateJemputPengelolaSelect();
      renderJemputRekomendasi();
    },
    function () {
      alert(
        "Lokasi tidak dapat diakses. Pastikan izin lokasi sudah diberikan.",
      );
    },
  );
}

// Klik salah satu rekomendasi -> isi otomatis "Pengelola Tujuan" di form
// dan tampilkan rutenya di peta.
const jemputRekomendasiListEl = document.getElementById(
  "jemputRekomendasiList",
);
if (jemputRekomendasiListEl) {
  jemputRekomendasiListEl.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-manager]");
    if (!btn) return;

    const select = document.getElementById("jemputPengelola");
    if (!select) return;

    const name = btn.dataset.manager;
    const alreadyExists = Array.from(select.options).some(function (opt) {
      return opt.value === name;
    });

    if (!alreadyExists) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }

    select.value = name;
    select.dispatchEvent(new Event("change"));
  });
}

function renderJemputMap(managers) {
  const container = document.getElementById("jemputMap");
  if (!container || typeof L === "undefined") return;

  if (!jemputMapObj) {
    jemputMapObj = L.map(container).setView(
      [MALANG_CENTER.lat, MALANG_CENTER.lng],
      13,
    );

    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(jemputMapObj);

    jemputMarkersLayer = L.layerGroup().addTo(jemputMapObj);
  }

  jemputMarkersLayer.clearLayers();

  if (jemputRouteLine) {
    jemputMapObj.removeLayer(jemputRouteLine);
    jemputRouteLine = null;
  }

  if (userLocation) {
    L.marker([userLocation.lat, userLocation.lng], { icon: createUserIcon() })
      .addTo(jemputMarkersLayer)
      .bindPopup("Lokasi Anda");

    jemputMapObj.setView([userLocation.lat, userLocation.lng], 13);
  }

  managers.forEach(function (m) {
    const popupDistance =
      m.distance != null
        ? "<br>" + m.distance.toFixed(1).replace(".", ",") + " km dari Anda"
        : "";

    L.marker([m.lat, m.lng])
      .addTo(jemputMarkersLayer)
      .bindPopup("<strong>" + m.name + "</strong>" + popupDistance);
  });

  setTimeout(function () {
    jemputMapObj.invalidateSize();
  }, 150);

  updateJemputRoutePreview();
}

// Gambar rute (garis lurus) + info jarak & estimasi waktu antara dua titik.
function drawStraightRoute(mapObj, from, to, options) {
  const distanceKm = haversineDistanceKm(from.lat, from.lng, to.lat, to.lng);
  const minutes = (distanceKm / JEMPUT_ASUMSI_KECEPATAN_KMJAM) * 60;

  const line = L.polyline(
    [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    { color: "#087153", weight: 4, dashArray: "6,8" },
  ).addTo(mapObj);

  mapObj.fitBounds(line.getBounds(), { padding: [30, 30] });

  return { line: line, distanceKm: distanceKm, minutes: minutes };
}

function formatRouteInfo(distanceKm, minutes) {
  return (
    "<span>🚴 Jarak garis lurus: <strong>" +
    distanceKm.toFixed(1).replace(".", ",") +
    " km</strong></span>" +
    "<span>⏱️ Estimasi waktu tempuh: <strong>~" +
    Math.max(1, Math.round(minutes)) +
    " menit</strong></span>"
  );
}

// Tampilkan rute dari lokasi pengguna ke pengelola yang sedang dipilih di
// form (dipanggil setiap kali <select id="jemputPengelola"> berubah).
function updateJemputRoutePreview() {
  const select = document.getElementById("jemputPengelola");
  const infoEl = document.getElementById("jemputRouteInfo");

  if (jemputRouteLine && jemputMapObj) {
    jemputMapObj.removeLayer(jemputRouteLine);
    jemputRouteLine = null;
  }

  if (infoEl) infoEl.innerHTML = "";

  if (!select || !jemputMapObj || !userLocation) return;

  const name = select.value;
  if (!name) return;

  const target = getManagerLocations().find(function (m) {
    return m.name === name;
  });

  if (!target) return;

  const result = drawStraightRoute(jemputMapObj, userLocation, target);
  jemputRouteLine = result.line;

  if (infoEl) {
    infoEl.innerHTML = formatRouteInfo(result.distanceKm, result.minutes);
  }

  // Tandai rekomendasi yang aktif sesuai pilihan saat ini
  document
    .querySelectorAll("#jemputRekomendasiList .jemput-rekomendasi-item")
    .forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.manager === name);
    });
}

const jemputPengelolaSelectEl = document.getElementById("jemputPengelola");
if (jemputPengelolaSelectEl) {
  jemputPengelolaSelectEl.addEventListener("change", updateJemputRoutePreview);
}

/* =========================================
   MODAL: LIHAT RUTE PENJEMPUTAN
   -----------------------------------------
   Dipakai oleh pengguna (riwayat penjemputannya sendiri) maupun pengelola
   (pengajuan yang masuk), berdasarkan lokasi yang tersimpan di batch saat
   pengajuan dibuat.
========================================= */

let routeModalMapObj = null;
let routeModalMarkersLayer = null;
let routeModalLine = null;

function openRouteModal(batchId) {
  const batch = getStoredBatches().find(function (b) {
    return b.id === batchId;
  });

  if (!batch) return;

  if (batch.userLat == null || batch.userLng == null) {
    alert(
      "Lokasi penjemputan tidak tersedia untuk pengajuan ini (izin lokasi " +
        "belum diberikan saat pengajuan dibuat).",
    );
    return;
  }

  const target = getManagerLocations().find(function (m) {
    return m.name === batch.pengelolaTujuan;
  });

  if (!target) {
    alert("Data lokasi pengelola tujuan tidak ditemukan.");
    return;
  }

  const modal = document.getElementById("routeModal");
  if (modal) modal.classList.add("open");

  const titleEl = document.getElementById("routeModalTitle");
  if (titleEl) titleEl.textContent = "Rute Penjemputan - " + batch.id;

  setTimeout(function () {
    const container = document.getElementById("routeModalMap");
    if (!container || typeof L === "undefined") return;

    if (!routeModalMapObj) {
      routeModalMapObj = L.map(container);

      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 20,
      }).addTo(routeModalMapObj);

      routeModalMarkersLayer = L.layerGroup().addTo(routeModalMapObj);
    }

    routeModalMarkersLayer.clearLayers();

    if (routeModalLine) {
      routeModalMapObj.removeLayer(routeModalLine);
      routeModalLine = null;
    }

    L.marker([batch.userLat, batch.userLng], { icon: createUserIcon() })
      .addTo(routeModalMarkersLayer)
      .bindPopup("Lokasi penjemputan (" + (batch.userNama || "Pengguna") + ")");

    L.marker([target.lat, target.lng])
      .addTo(routeModalMarkersLayer)
      .bindPopup("<strong>" + target.name + "</strong>");

    const result = drawStraightRoute(
      routeModalMapObj,
      { lat: batch.userLat, lng: batch.userLng },
      target,
    );
    routeModalLine = result.line;

    routeModalMapObj.invalidateSize();

    const infoEl = document.getElementById("routeModalInfo");
    if (infoEl) {
      infoEl.innerHTML = formatRouteInfo(result.distanceKm, result.minutes);
    }
  }, 150);
}

function closeRouteModal() {
  const modal = document.getElementById("routeModal");
  if (modal) modal.classList.remove("open");
}

// Kode daur ulang plastik (Resin Identification Code) 1-7. Kode 7 adalah PLA
// (bioplastik). Nilainya bisa dipilih
// manual lewat dropdown "Kode Daur Ulang", atau terisi otomatis dari Kamera
// AI (lihat ai-kamera.js, tombol "Deteksi dengan Kamera AI").
const KODE_DAUR_ULANG_LABELS = {
  1: "1 - PET",
  2: "2 - HDPE",
  3: "3 - PVC",
  4: "4 - LDPE",
  5: "5 - PP",
  6: "6 - PSS",
  7: "7 - PLA",
};

// Kode Daur Ulang (1-7) hanya relevan untuk sub-jenis sampah Plastik,
// jadi field ini disembunyikan & tidak wajib diisi saat jenis sampah
// yang dipilih adalah Organik.
function updateJemputKodeDaurVisibility() {
  const jenisSelect = document.getElementById("jemputJenis");
  const kodeWrap = document.getElementById("jemputKodeDaurWrap");
  const kodeSelect = document.getElementById("jemputKodeDaur");

  if (!jenisSelect || !kodeWrap || !kodeSelect) return;

  const isPlastik = jenisSelect.value === "Plastik";

  kodeWrap.style.display = isPlastik ? "" : "none";
  kodeSelect.required = isPlastik;

  // Tombol Kamera AI hanya mengenali kategori plastik (kode 1-7), jadi ikut
  // tampil/tersembunyi bersama field Kode Daur Ulang.
  const kameraBtn = document.getElementById("jemputKameraBtn");
  const kameraNote = document.getElementById("jemputKameraNote");
  if (kameraBtn) kameraBtn.style.display = isPlastik ? "" : "none";
  if (kameraNote && !isPlastik) kameraNote.hidden = true;

  if (!isPlastik) {
    kodeSelect.value = "";
  }
}

function handleJemputSubmit(event) {
  event.preventDefault();

  // Hanya pengguna yang sudah masuk (login) yang boleh mengajukan
  // penjemputan. Pemeriksaan ini melengkapi renderJemputAuthState(), yang
  // menyembunyikan form ini kalau belum login.
  const user = getCurrentUser();

  if (!user) {
    alert(
      "Silakan masuk (login) terlebih dahulu untuk mengajukan penjemputan.",
    );
    showPage("login");
    return;
  }

  const jenis = document.getElementById("jemputJenis").value;
  const berat = parseFloat(document.getElementById("jemputBerat").value);
  const pengelolaTujuan = document.getElementById("jemputPengelola").value;
  const catatan = document.getElementById("jemputCatatan").value.trim();
  const kodeDaurUlangRaw = document.getElementById("jemputKodeDaur").value;
  const kodeDaurUlang = kodeDaurUlangRaw
    ? parseInt(kodeDaurUlangRaw, 10)
    : null;

  if (!pengelolaTujuan) {
    alert("Silakan pilih pengelola tujuan.");
    return;
  }

  // Kode Daur Ulang WAJIB dipilih, tapi hanya untuk sub-jenis Plastik.
  // Selama AI belum ada, pengguna memilih kode ini sendiri secara manual
  // (lihat catatan di atas const KODE_DAUR_ULANG_LABELS).
  if (jenis === "Plastik" && !kodeDaurUlang) {
    alert("Silakan pilih Kode Daur Ulang untuk sampah Plastik Anda.");
    return;
  }

  const batch = {
    id: generateBatchId(),
    userEmail: user.email,
    userNama: user.nama,
    jenisDeclared: jenis,
    beratDeclared: berat,
    pengelolaTujuan: pengelolaTujuan,
    catatan: catatan,
    status: "diajukan",
    tanggalDiajukan: new Date().toISOString(),
    verifiedJenis: null,
    verifiedWeight: null,
    selisihPersen: null,
    tanggalVerifikasi: null,
    usedInProduct: false,
    // Kode daur ulang (1-7) yang dipilih pengguna secara manual saat
    // pengajuan dibuat (untuk jejak/traceability). Hanya terisi untuk
    // sub-jenis sampah Plastik.
    kodeDaurUlang: jenis === "Plastik" ? kodeDaurUlang : null,
    kodeDaurUlangLabel:
      jenis === "Plastik"
        ? KODE_DAUR_ULANG_LABELS[kodeDaurUlang] || null
        : null,
    // Lokasi pengguna saat pengajuan dibuat, supaya pengelola tujuan bisa
    // melihat rute penjemputan menuju lokasi ini. Bisa null kalau izin
    // lokasi belum/tidak diberikan.
    userLat: userLocation ? userLocation.lat : null,
    userLng: userLocation ? userLocation.lng : null,
  };

  const batches = getStoredBatches();
  batches.unshift(batch);
  saveStoredBatches(batches);

  document.getElementById("jemputForm").reset();
  updateJemputKodeDaurVisibility();

  renderRiwayatBatches();
  renderPanelPengelola();

  alert(
    "Pengajuan berhasil dibuat.\n\n" +
      "Kode Batch Anda: " +
      batch.id +
      "\n\n" +
      "Simpan kode ini untuk melacak status penjemputan sampai " +
      "diverifikasi oleh " +
      pengelolaTujuan +
      ".",
  );
}

// Riwayat penjemputan hanya menampilkan pengajuan dalam periode satu bulan
// (30 hari) terakhir di perangkat ini, dan dikelompokkan menjadi dua
// status: "diajukan" (masih dalam proses, menunggu verifikasi pengelola)
// dan "terverifikasi"/"ditinjau" (sudah benar-benar diserahkan & diterima
// oleh pengelola tujuan).
const RIWAYAT_PERIODE_HARI = 30;

// Membangun satu kartu batch untuk riwayat.
function buildRiwayatBatchCard(b) {
  const statusClass =
    b.status === "diajukan"
      ? "batch-status--pending"
      : b.status === "ditinjau"
        ? "batch-status--review"
        : "batch-status--verified";

  const verifiedInfo =
    b.status !== "diajukan"
      ? "<p>Berat terverifikasi: <strong>" +
        b.verifiedWeight +
        " kg</strong> (deklarasi awal: " +
        b.beratDeclared +
        " kg, selisih " +
        b.selisihPersen.toFixed(0) +
        "%)</p>"
      : "<p>Berat dideklarasikan: <strong>" +
        b.beratDeclared +
        " kg</strong></p>";

  const kodeDaurUlangInfo = b.kodeDaurUlangLabel
    ? "<p>Kode Daur Ulang: <strong>" + b.kodeDaurUlangLabel + "</strong></p>"
    : "";

  return (
    '<div class="batch-card">' +
    '<div class="batch-card-top">' +
    "<strong>" +
    b.id +
    "</strong>" +
    '<span class="batch-status ' +
    statusClass +
    '">' +
    formatBatchStatus(b.status) +
    "</span>" +
    "</div>" +
    "<p>" +
    b.jenisDeclared +
    " &rarr; " +
    b.pengelolaTujuan +
    "</p>" +
    verifiedInfo +
    kodeDaurUlangInfo +
    "<small>Diajukan oleh " +
    b.userNama +
    " pada " +
    new Date(b.tanggalDiajukan).toLocaleString("id-ID") +
    "</small>" +
    '<div class="batch-card-actions">' +
    (b.userLat != null && b.userLng != null
      ? '<button type="button" class="secondary-button" onclick="openRouteModal(\'' +
        b.id +
        "')\">🗺️ Lihat Rute</button>"
      : "") +
    "</div>" +
    "</div>"
  );
}

// Daftar riwayat batch di perangkat ini (tanpa backend multi-pengguna,
// jadi ditampilkan berdasarkan data localStorage browser ini).
function renderRiwayatBatches() {
  const container = document.getElementById("riwayatBatchList");
  if (!container) return;

  const now = Date.now();
  const periodeMs = RIWAYAT_PERIODE_HARI * 24 * 60 * 60 * 1000;

  const batches = getStoredBatches().filter(function (b) {
    const waktu = new Date(b.tanggalDiajukan).getTime();
    return !isNaN(waktu) && now - waktu <= periodeMs;
  });

  if (batches.length === 0) {
    container.innerHTML =
      '<p class="empty-note">Belum ada pengajuan penjemputan dalam 30 hari terakhir.</p>';
    return;
  }

  const masihProses = batches.filter(function (b) {
    return b.status === "diajukan";
  });

  const sudahDiserahkan = batches.filter(function (b) {
    return b.status === "terverifikasi" || b.status === "ditinjau";
  });

  const masihProsesHtml =
    masihProses.length > 0
      ? masihProses.map(buildRiwayatBatchCard).join("")
      : '<p class="empty-note">Tidak ada pengajuan yang masih diproses.</p>';

  const sudahDiserahkanHtml =
    sudahDiserahkan.length > 0
      ? sudahDiserahkan.map(buildRiwayatBatchCard).join("")
      : '<p class="empty-note">Belum ada penjemputan yang selesai diserahkan.</p>';

  container.innerHTML =
    '<div class="riwayat-group">' +
    '<h3 class="riwayat-group-title">📦 Masih Dalam Proses (' +
    masihProses.length +
    ")</h3>" +
    masihProsesHtml +
    "</div>" +
    '<div class="riwayat-group">' +
    '<h3 class="riwayat-group-title">✅ Sudah Diserahkan (' +
    sudahDiserahkan.length +
    ")</h3>" +
    sudahDiserahkanHtml +
    "</div>";
}

// Panel khusus akun Pengelola: menampilkan pengajuan yang ditujukan ke
// tempat mereka dan tombol untuk mengonfirmasi berat yang benar-benar
// diterima (menutup celah "declared" vs "verified").
function renderPanelPengelola() {
  const section = document.getElementById("panelPengelolaSection");
  const list = document.getElementById("panelPengelolaList");
  if (!section || !list) return;

  const user = getCurrentUser();

  if (!user || user.role !== "pengelola") {
    section.style.display = "none";
    return;
  }

  const myManagers = getStoredManagers().filter(function (m) {
    return m.ownerEmail === user.email;
  });

  const myNames = myManagers.map(function (m) {
    return m.namaTempat;
  });

  if (myNames.length === 0) {
    section.style.display = "block";
    list.innerHTML =
      '<p class="empty-note">Daftarkan tempat Anda lewat "Daftar sebagai Pengelola" di halaman Pengelola agar bisa menerima & memverifikasi pengajuan.</p>';
    return;
  }

  section.style.display = "block";

  const batches = getStoredBatches().filter(function (b) {
    return myNames.includes(b.pengelolaTujuan) && b.status === "diajukan";
  });

  if (batches.length === 0) {
    list.innerHTML =
      '<p class="empty-note">Tidak ada pengajuan yang menunggu.</p>';
    return;
  }

  list.innerHTML = batches
    .map(function (b) {
      return (
        '<div class="batch-card">' +
        '<div class="batch-card-top">' +
        "<strong>" +
        b.id +
        "</strong>" +
        '<span class="batch-status batch-status--pending">Menunggu Verifikasi</span>' +
        "</div>" +
        "<p>" +
        b.jenisDeclared +
        ", perkiraan " +
        b.beratDeclared +
        " kg dari " +
        b.userNama +
        "</p>" +
        (b.catatan ? "<p><em>Catatan: " + b.catatan + "</em></p>" : "") +
        (b.kodeDaurUlangLabel
          ? "<p>Kode Daur Ulang: <strong>" +
            b.kodeDaurUlangLabel +
            "</strong></p>"
          : "") +
        '<div class="batch-card-actions">' +
        '<button class="primary-button" onclick="confirmBatchReceipt(\'' +
        b.id +
        "')\">Konfirmasi Penerimaan</button>" +
        (b.userLat != null && b.userLng != null
          ? '<button type="button" class="secondary-button" onclick="openRouteModal(\'' +
            b.id +
            "')\">🗺️ Lihat Rute</button>"
          : "") +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

function confirmBatchReceipt(batchId) {
  const batches = getStoredBatches();
  const batch = batches.find(function (b) {
    return b.id === batchId;
  });

  if (!batch) return;

  const input = prompt(
    "Berat " +
      batch.jenisDeclared +
      " yang benar-benar diterima (kg)?\n" +
      "(Deklarasi awal pengguna: " +
      batch.beratDeclared +
      " kg)",
    batch.beratDeclared,
  );

  if (input === null) return;

  const actual = parseFloat(input);

  if (isNaN(actual) || actual < 0) {
    alert("Berat tidak valid.");
    return;
  }

  const selisihPersen =
    batch.beratDeclared > 0
      ? (Math.abs(actual - batch.beratDeclared) / batch.beratDeclared) * 100
      : 0;

  batch.verifiedWeight = actual;
  batch.verifiedJenis = batch.jenisDeclared;
  batch.selisihPersen = selisihPersen;
  batch.tanggalVerifikasi = new Date().toISOString();
  batch.status = selisihPersen > 25 ? "ditinjau" : "terverifikasi";

  saveStoredBatches(batches);

  renderPanelPengelola();
  renderRiwayatBatches();

  // Kapasitas pengelola berubah -> refresh kartu di halaman Pengelola
  refreshManagerCardsCapacity();

  alert(
    "Batch " +
      batch.id +
      " ditandai " +
      formatBatchStatus(batch.status) +
      ".\nSelisih dari deklarasi awal: " +
      selisihPersen.toFixed(0) +
      "%.",
  );
}

// Setelah verifikasi baru, render ulang kartu pengelola supaya bar
// kapasitas harian ikut ter-update.
function refreshManagerCardsCapacity() {
  const list = document.getElementById("managerList");
  if (!list) return;

  const stored = getStoredManagers();

  stored.forEach(function (data) {
    const existing = Array.from(list.querySelectorAll(".manager-result")).find(
      function (el) {
        const h3 = el.querySelector("h3");
        return h3 && h3.textContent.trim().startsWith(data.namaTempat);
      },
    );

    if (existing) {
      const replacement = buildManagerCard(data);
      existing.replaceWith(replacement);
    }
  });
}

/* =========================================
   DASHBOARD (AGREGAT)
========================================= */

function renderDashboard() {
  const batches = getStoredBatches();
  const managers = getStoredManagers();
  const products = getStoredProducts();

  const totalBatch = batches.length;

  const verifiedBatches = batches.filter(function (b) {
    return b.status === "terverifikasi" || b.status === "ditinjau";
  });

  const totalVerified = verifiedBatches.length;

  const totalVerifiedWeight = verifiedBatches.reduce(function (sum, b) {
    return sum + (b.verifiedWeight || 0);
  }, 0);

  const avgSelisih =
    verifiedBatches.length > 0
      ? verifiedBatches.reduce(function (sum, b) {
          return sum + (b.selisihPersen || 0);
        }, 0) / verifiedBatches.length
      : null;

  const avgAccuracy =
    avgSelisih !== null ? Math.max(100 - avgSelisih, 0) : null;

  const institusional = managers.filter(function (m) {
    return m.kelas === "institusional";
  }).length;

  const mandiri = managers.filter(function (m) {
    return m.kelas === "mandiri";
  }).length;

  const produkLacak = products.filter(function (p) {
    return !!p.kodeBatch;
  }).length;

  const setText = function (id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText("statTotalBatch", totalBatch);
  setText("statVerified", totalVerified);
  setText("statVerifiedWeight", totalVerifiedWeight.toFixed(1) + " kg");
  setText(
    "statAccuracy",
    avgAccuracy !== null ? avgAccuracy.toFixed(0) + "%" : "-",
  );
  setText("statPengelola", institusional + " / " + mandiri);
  setText("statProdukLacak", produkLacak + " / " + products.length);
}

/* =========================================
   AKUN (LOGIN, SIGN UP, PERAN PENGGUNA)
   -----------------------------------------
   Catatan: ini implementasi akun sederhana di sisi
   browser (localStorage) untuk keperluan demo/prototipe.
   Untuk aplikasi produksi, autentikasi & kata sandi harus
   diproses di server dengan enkripsi yang layak.
========================================= */

function getStoredUsers() {
  try {
    const raw = localStorage.getItem("reloop_users");
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredUsers(list) {
  try {
    localStorage.setItem("reloop_users", JSON.stringify(list));
  } catch (error) {
    console.error("Gagal menyimpan data akun:", error);
  }
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem("reloop_current_user");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem("reloop_current_user", JSON.stringify(user));
}

function clearCurrentUser() {
  localStorage.removeItem("reloop_current_user");
}

// Tombol profil di navbar: kalau belum masuk, arahkan ke halaman Login.
// Kalau sudah masuk, arahkan ke halaman Pengaturan.
function handleProfileClick() {
  const user = getCurrentUser();
  showPage(user ? "pengaturan" : "login");
}

function handleSignupSubmit(event) {
  event.preventDefault();

  const nama = document.getElementById("signupNama").value.trim();
  const email = document
    .getElementById("signupEmail")
    .value.trim()
    .toLowerCase();
  const password = document.getElementById("signupPassword").value;
  const roleInput = document.querySelector(
    "#signupForm input[name='signupRole']:checked",
  );
  const role = roleInput ? roleInput.value : "pengguna";

  const users = getStoredUsers();

  const alreadyExists = users.some(function (u) {
    return u.email === email;
  });

  if (alreadyExists) {
    alert("Email tersebut sudah terdaftar. Silakan masuk (login).");
    return;
  }

  users.push({ nama: nama, email: email, password: password, role: role });
  saveStoredUsers(users);

  setCurrentUser({ nama: nama, email: email, role: role });
  updateAuthUI();

  document.getElementById("signupForm").reset();

  alert(
    "Akun berhasil dibuat sebagai " +
      (role === "pengelola" ? "Pengelola" : "Pengguna Biasa") +
      ". Selamat datang, " +
      nama +
      "!",
  );

  showPage(role === "pengelola" ? "portal-pengelola" : "home");
}

function handleLoginSubmit(event) {
  event.preventDefault();

  const email = document
    .getElementById("loginEmail")
    .value.trim()
    .toLowerCase();
  const password = document.getElementById("loginPassword").value;

  // Jenis akun yang dipilih di form ("Masuk Sebagai")
  const roleInput = document.querySelector(
    "#loginForm input[name='loginRole']:checked",
  );
  const chosenRole = roleInput ? roleInput.value : "pengguna";

  const errorEl = document.getElementById("loginError");

  const showError = function (message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      alert(message);
    }
  };

  if (errorEl) errorEl.hidden = true;

  const users = getStoredUsers();

  const found = users.find(function (u) {
    return u.email === email && u.password === password;
  });

  if (!found) {
    showError("Email atau kata sandi salah, atau akun belum terdaftar.");
    return;
  }

  // Akun lama tanpa field role dianggap Pengguna Biasa
  const accountRole = found.role === "pengelola" ? "pengelola" : "pengguna";

  // Jenis akun yang dipilih harus sama dengan jenis akun saat mendaftar
  if (accountRole !== chosenRole) {
    showError(
      accountRole === "pengelola"
        ? 'Akun ini terdaftar sebagai Pengelola. Pilih "Pengelola" pada bagian "Masuk Sebagai", lalu coba lagi.'
        : 'Akun ini terdaftar sebagai Pengguna Biasa. Pilih "Pengguna Biasa" pada bagian "Masuk Sebagai", lalu coba lagi.',
    );
    return;
  }

  setCurrentUser({ nama: found.nama, email: found.email, role: accountRole });
  updateAuthUI();

  document.getElementById("loginForm").reset();

  // Pengelola langsung masuk ke Portal Pengelola, pengguna biasa ke Home
  showPage(accountRole === "pengelola" ? "portal-pengelola" : "home");
}

function logoutUser() {
  clearCurrentUser();
  updateAuthUI();
  showPage("home");
}

// Sinkronkan tampilan (navbar, halaman Pengaturan, tombol Tambah Produk)
// dengan status login & peran akun saat ini. Dipanggil setiap kali
// halaman berpindah, dan setelah login/logout/daftar.
function updateAuthUI() {
  const user = getCurrentUser();

  // Form pengajuan penjemputan hanya untuk akun yang sudah login, jadi
  // ikut disinkronkan setiap kali status login berubah.
  renderJemputAuthState();

  const profileIcon = document.getElementById("profileIcon");
  if (profileIcon) {
    profileIcon.textContent = user ? user.nama.charAt(0).toUpperCase() : "P";
  }

  const productBtn = document.getElementById("openProductBtn");
  const productNote = document.getElementById("productLockedNote");
  const isPengelola = !!user && user.role === "pengelola";
  document.body.classList.toggle("role-pengelola", isPengelola);

  if (productBtn) {
    productBtn.style.display = isPengelola ? "block" : "none";
  }
  if (productNote) {
    productNote.style.display = isPengelola ? "none" : "block";
  }

  // Menu "Portal Pengelola" di navbar & baris "Buka Portal" di Pengaturan
  // hanya tampil untuk akun Pengelola.
  const navPortalBtn = document.getElementById("navPortalBtn");
  if (navPortalBtn) {
    navPortalBtn.style.display = isPengelola ? "" : "none";
  }

  const portalRow = document.getElementById("accountPortalRow");
  if (portalRow) {
    portalRow.style.display = isPengelola ? "flex" : "none";
  }

  const loggedInBlock = document.getElementById("accountLoggedIn");
  const loggedOutBlock = document.getElementById("accountLoggedOut");

  if (loggedInBlock && loggedOutBlock) {
    if (user) {
      loggedInBlock.style.display = "block";
      loggedOutBlock.style.display = "none";

      document.getElementById("accountNamaDisplay").textContent = user.nama;
      document.getElementById("accountEmailDisplay").textContent = user.email;
      document.getElementById("accountRoleDisplay").textContent =
        user.role === "pengelola" ? "Pengelola" : "Pengguna Biasa";
    } else {
      loggedInBlock.style.display = "none";
      loggedOutBlock.style.display = "block";
    }
  }
}

/* =========================================
   PORTAL PENGELOLA
   -----------------------------------------
   Ruang kerja khusus akun role "pengelola" (halaman #portal-pengelola).
   Memakai ulang data localStorage yang SUDAH ADA, tanpa skema baru:
   reloop_users / reloop_current_user, reloop_pengelola_terdaftar,
   reloop_batches, dan reloop_produk_tambahan.

   Catatan: pembatasan akses di sini hanya di sisi tampilan (prototipe
   tanpa backend). Pada versi produksi, hak akses harus dicek di server.
========================================= */

// Selisih berat (%) di atas angka ini -> status "ditinjau".
// Samakan dengan angka di confirmBatchReceipt() (panel lama di Jemput Sampah).
const PORTAL_REVIEW_THRESHOLD = 25;

const PORTAL_FILTERS = [
  { key: "semua", label: "Semua" },
  { key: "diajukan", label: "Menunggu" },
  { key: "terverifikasi", label: "Terverifikasi" },
  { key: "ditinjau", label: "Ditinjau" },
];

let portalActivePlace = null; // namaTempat yang sedang dilihat
let portalActiveTab = "pengajuan"; // pengajuan | riwayat | profil
let portalActiveFilter = "semua"; // semua | diajukan | terverifikasi | ditinjau
let portalFlashTimer = null;

/* ---------- Helper umum ---------- */

// Data dari localStorage (nama tempat, catatan, nama pengguna, dst) berasal
// dari input pengguna, jadi selalu di-escape sebelum masuk ke innerHTML.
function portalEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function portalFormatKg(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return rounded.toLocaleString("id-ID") + " kg";
}

function portalFormatDate(iso) {
  return iso ? new Date(iso).toLocaleString("id-ID") : "-";
}

function portalSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function portalStatusBadge(status) {
  if (status === "diajukan") {
    return '<span class="batch-status batch-status--pending">Menunggu Verifikasi</span>';
  }
  if (status === "ditinjau") {
    return '<span class="batch-status batch-status--review">Ditinjau (selisih besar)</span>';
  }
  return '<span class="batch-status batch-status--verified">Terverifikasi</span>';
}

function showPortalFlash(message, type) {
  const el = document.getElementById("portalFlash");
  if (!el) return;

  el.textContent = message;
  el.className = "portal-flash portal-flash--" + (type || "ok");
  el.hidden = false;

  clearTimeout(portalFlashTimer);
  portalFlashTimer = setTimeout(function () {
    el.hidden = true;
  }, 7000);
}

/* ---------- Status akun & tempat ---------- */

// Menentukan apa yang boleh dilihat akun saat ini:
// "guest" (belum masuk), "wrong-role" (bukan pengelola),
// "no-place" (pengelola tapi belum mendaftarkan tempat), atau "ok".
function resolvePortalState() {
  const user = getCurrentUser();

  if (!user) {
    return { state: "guest", user: null, places: [], place: null };
  }

  if (user.role !== "pengelola") {
    return { state: "wrong-role", user: user, places: [], place: null };
  }

  const places = getStoredManagers().filter(function (m) {
    return m.ownerEmail === user.email;
  });

  if (places.length === 0) {
    return { state: "no-place", user: user, places: [], place: null };
  }

  let place = places.find(function (m) {
    return m.namaTempat === portalActivePlace;
  });

  if (!place) {
    place = places[0];
    portalActivePlace = place.namaTempat;
  }

  return { state: "ok", user: user, places: places, place: place };
}

function openPortalRegister() {
  showPage("pengelola");
  openRegisterModal();
}

function openPortalProduct() {
  showPage("pengelola");
  openProductModal();
}

// Pesan terkunci (pola sama dengan .locked-feature-note di halaman Pengelola)
function renderPortalLocked(ctx) {
  const box = document.getElementById("portalLocked");
  const content = document.getElementById("portalContent");
  if (!box || !content) return;

  let html;

  if (ctx.state === "guest") {
    html =
      "Portal ini khusus untuk <strong>akun Pengelola</strong>. " +
      '<button type="button" class="link-button" onclick="showPage(\'login\')">Masuk</button> ' +
      "atau " +
      '<button type="button" class="link-button" onclick="showPage(\'signup\')">daftar sebagai Pengelola</button> ' +
      "terlebih dahulu.";
  } else if (ctx.state === "wrong-role") {
    html =
      "Akun Anda terdaftar sebagai <strong>Pengguna Biasa</strong>, sedangkan " +
      "portal ini khusus <strong>akun Pengelola</strong>. " +
      '<button type="button" class="link-button" onclick="logoutUser(); showPage(\'login\')">Keluar dan masuk sebagai Pengelola</button> ' +
      "atau " +
      '<button type="button" class="link-button" onclick="logoutUser(); showPage(\'signup\')">buat akun Pengelola</button>.';
  } else {
    html =
      "Anda belum mendaftarkan tempat pengelolaan. " +
      '<button type="button" class="link-button" onclick="openPortalRegister()">Daftarkan tempat Anda</button> ' +
      "lewat &quot;Daftar sebagai Pengelola&quot; agar bisa menerima &amp; " +
      "memverifikasi pengajuan penjemputan.";
  }

  box.innerHTML =
    '<div class="locked-feature-note portal-locked">' + html + "</div>";
  box.style.display = "block";
  content.style.display = "none";
}

/* ---------- Render halaman ---------- */

// Render penuh: dipanggil saat halaman dibuka (showPage) atau ganti tempat.
function renderPortalPengelola() {
  if (!document.getElementById("portalContent")) return;

  const ctx = resolvePortalState();

  if (ctx.state !== "ok") {
    renderPortalLocked(ctx);
    return;
  }

  document.getElementById("portalLocked").style.display = "none";
  document.getElementById("portalContent").style.display = "block";

  renderPortalPlaceSwitch(ctx);
  fillPortalProfilForm(ctx.place);
  applyPortalTab();
  renderPortalData(ctx);
}

// Render ringan: hanya data (ringkasan, performa, daftar). Form profil TIDAK
// disentuh supaya isian yang belum disimpan tidak hilang.
function refreshPortalData() {
  if (!document.getElementById("portalContent")) return;

  const ctx = resolvePortalState();

  if (ctx.state !== "ok") {
    renderPortalLocked(ctx);
    return;
  }

  renderPortalData(ctx);
}

function renderPortalData(ctx) {
  renderPortalPlaceSummary(ctx.place);
  renderPortalPerformance(ctx);
  renderPortalBatchPanel(ctx.place);
  renderPortalRiwayat(ctx.place);
}

function renderPortalPlaceSwitch(ctx) {
  const wrap = document.getElementById("portalPlaceSwitch");
  const select = document.getElementById("portalPlaceSelect");
  if (!wrap || !select) return;

  if (ctx.places.length <= 1) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";

  select.innerHTML = ctx.places
    .map(function (m) {
      return (
        '<option value="' +
        portalEscape(m.namaTempat) +
        '"' +
        (m.namaTempat === ctx.place.namaTempat ? " selected" : "") +
        ">" +
        portalEscape(m.namaTempat) +
        "</option>"
      );
    })
    .join("");
}

function handlePortalPlaceChange() {
  const select = document.getElementById("portalPlaceSelect");
  if (!select) return;

  portalActivePlace = select.value;
  portalActiveFilter = "semua";

  renderPortalPengelola();
}

function switchPortalTab(tab) {
  portalActiveTab = tab;
  applyPortalTab();
}

function applyPortalTab() {
  const panels = {
    pengajuan: "portalPanelPengajuan",
    riwayat: "portalPanelRiwayat",
    profil: "portalPanelProfil",
  };

  document.querySelectorAll(".portal-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === portalActiveTab);
  });

  Object.keys(panels).forEach(function (name) {
    const el = document.getElementById(panels[name]);
    if (el) el.style.display = name === portalActiveTab ? "block" : "none";
  });
}

/* ---------- 1. Ringkasan tempat & sisa kapasitas ---------- */

function renderPortalPlaceSummary(place) {
  portalSetText("portalPlaceName", place.namaTempat);

  const kelasEl = document.getElementById("portalPlaceKelas");
  if (kelasEl) {
    kelasEl.innerHTML =
      place.kelas === "institusional"
        ? '<span class="kelas-badge kelas-badge--institusional">🏛 Institusional</span>'
        : place.kelas === "mandiri"
          ? '<span class="kelas-badge kelas-badge--mandiri">👤 Mandiri</span>'
          : "";
  }

  // Sisa kapasitas dihitung langsung dari batch terverifikasi HARI INI
  const kapasitas = Number(place.kapasitas) || 0;
  const terpakai = getVerifiedWeightTodayFor(place.namaTempat);
  const sisa = Math.max(kapasitas - terpakai, 0);
  const lebih = Math.max(terpakai - kapasitas, 0);
  const pct = kapasitas > 0 ? Math.min((terpakai / kapasitas) * 100, 100) : 0;

  portalSetText("portalCapDaily", portalFormatKg(kapasitas));
  portalSetText("portalCapUsed", portalFormatKg(terpakai));
  portalSetText("portalCapLeft", portalFormatKg(sisa));

  const fill = document.getElementById("portalCapFill");
  if (fill) {
    fill.style.width = pct + "%";
    fill.classList.toggle("capacity-bar-fill--full", pct >= 100);
  }

  portalSetText(
    "portalCapText",
    lebih > 0
      ? "Kapasitas hari ini terlampaui " + portalFormatKg(lebih) + "."
      : Math.round(pct) + "% dari kapasitas harian sudah terpakai.",
  );

  const meta = document.getElementById("portalPlaceMeta");
  if (meta) {
    const cats = (place.categories || [])
      .map(function (c) {
        return "<span>" + portalEscape(c) + "</span>";
      })
      .join("");

    meta.innerHTML =
      "<p>📍 " +
      portalEscape(place.alamat || "-") +
      "</p>" +
      "<p>🕒 " +
      portalEscape(place.jamOperasional || "Jam operasional belum diisi") +
      "</p>" +
      "<p>📞 " +
      portalEscape(place.telepon || "-") +
      "</p>" +
      '<div class="tags">' +
      cats +
      "</div>";
  }
}

/* ---------- 5. Ringkasan performa ---------- */

function getPortalBatches(placeName) {
  return getStoredBatches().filter(function (b) {
    return b.pengelolaTujuan === placeName;
  });
}

function getPortalVerifiedBatches(placeName) {
  return getPortalBatches(placeName).filter(function (b) {
    return b.status === "terverifikasi" || b.status === "ditinjau";
  });
}

// Produk milik pengelola yang login. Produk baru menyimpan ownerEmail;
// produk lama (tanpa ownerEmail) hanya bisa dikenali lewat kodeBatch-nya.
function getPortalMyProducts(ctx) {
  const myNames = ctx.places.map(function (m) {
    return m.namaTempat;
  });

  const batchById = {};
  getStoredBatches().forEach(function (b) {
    batchById[b.id] = b;
  });

  return getStoredProducts().filter(function (p) {
    if (p.ownerEmail) return p.ownerEmail === ctx.user.email;

    if (p.kodeBatch) {
      const batch = batchById[p.kodeBatch];
      return !!batch && myNames.includes(batch.pengelolaTujuan);
    }

    return false;
  });
}

function renderPortalPerformance(ctx) {
  const verified = getPortalVerifiedBatches(ctx.place.namaTempat);
  const now = new Date();

  const monthWeight = verified
    .filter(function (b) {
      const d = new Date(b.tanggalVerifikasi);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    })
    .reduce(function (sum, b) {
      return sum + (Number(b.verifiedWeight) || 0);
    }, 0);

  portalSetText("portalStatMonthWeight", portalFormatKg(monthWeight));

  if (verified.length > 0) {
    const avgSelisih =
      verified.reduce(function (sum, b) {
        return sum + (Number(b.selisihPersen) || 0);
      }, 0) / verified.length;

    portalSetText("portalStatAvgDiff", avgSelisih.toFixed(0) + "%");
    portalSetText(
      "portalStatAvgHint",
      "Akurasi deklarasi rata-rata " +
        Math.max(100 - avgSelisih, 0).toFixed(0) +
        "% (" +
        verified.length +
        " batch)",
    );
  } else {
    portalSetText("portalStatAvgDiff", "-");
    portalSetText("portalStatAvgHint", "Belum ada batch terverifikasi");
  }

  const myProducts = getPortalMyProducts(ctx);

  const traced = myProducts.filter(function (p) {
    return !!p.kodeBatch;
  }).length;

  portalSetText("portalStatTraced", traced);
  portalSetText("portalStatUntraced", myProducts.length - traced);
}

/* ---------- 2. Daftar pengajuan + filter status ---------- */

function renderPortalBatchPanel(place) {
  const all = getPortalBatches(place.namaTempat);

  const counts = {
    semua: all.length,
    diajukan: 0,
    terverifikasi: 0,
    ditinjau: 0,
  };
  all.forEach(function (b) {
    if (counts[b.status] !== undefined) counts[b.status]++;
  });

  const countEl = document.getElementById("portalTabPendingCount");
  if (countEl) {
    countEl.textContent = counts.diajukan;
    countEl.hidden = counts.diajukan === 0;
  }

  const chips = document.getElementById("portalFilters");
  if (chips) {
    chips.innerHTML = PORTAL_FILTERS.map(function (f) {
      return (
        '<button type="button" class="portal-chip' +
        (f.key === portalActiveFilter ? " active" : "") +
        '" data-filter="' +
        f.key +
        '">' +
        f.label +
        "<span>" +
        counts[f.key] +
        "</span></button>"
      );
    }).join("");
  }

  const list = document.getElementById("portalBatchList");
  if (!list) return;

  const shown =
    portalActiveFilter === "semua"
      ? all
      : all.filter(function (b) {
          return b.status === portalActiveFilter;
        });

  if (shown.length === 0) {
    list.innerHTML =
      '<p class="empty-note">' +
      (all.length === 0
        ? "Belum ada pengajuan penjemputan yang ditujukan ke tempat Anda."
        : "Tidak ada pengajuan dengan status ini.") +
      "</p>";
    return;
  }

  list.innerHTML = shown.map(buildPortalBatchCard).join("");
}

function buildPortalBatchCard(b) {
  const isPending = b.status === "diajukan";

  const detail = isPending
    ? "<p>Deklarasi: <strong>" +
      portalEscape(b.jenisDeclared) +
      ", " +
      portalFormatKg(b.beratDeclared) +
      "</strong></p>"
    : "<p>Diterima: <strong>" +
      portalEscape(b.verifiedJenis || b.jenisDeclared) +
      ", " +
      portalFormatKg(b.verifiedWeight) +
      "</strong> (deklarasi " +
      portalFormatKg(b.beratDeclared) +
      ", selisih " +
      (Number(b.selisihPersen) || 0).toFixed(0) +
      "%)</p>";

  return (
    '<div class="batch-card">' +
    '<div class="batch-card-top"><strong>' +
    portalEscape(b.id) +
    "</strong>" +
    portalStatusBadge(b.status) +
    "</div>" +
    "<p>Dari <strong>" +
    portalEscape(b.userNama || "Tamu") +
    "</strong></p>" +
    detail +
    (b.kodeDaurUlangLabel
      ? "<p>Kode Daur Ulang: <strong>" +
        portalEscape(b.kodeDaurUlangLabel) +
        "</strong></p>"
      : "") +
    (b.catatan
      ? "<p><em>Catatan: " + portalEscape(b.catatan) + "</em></p>"
      : "") +
    "<small>Diajukan " +
    portalFormatDate(b.tanggalDiajukan) +
    (isPending
      ? ""
      : " &middot; Diverifikasi " + portalFormatDate(b.tanggalVerifikasi)) +
    "</small>" +
    '<div class="batch-card-actions">' +
    (isPending
      ? '<button type="button" class="primary-button" data-confirm-batch="' +
        portalEscape(b.id) +
        '">Konfirmasi Penerimaan</button>'
      : "") +
    (b.userLat != null && b.userLng != null
      ? '<button type="button" class="secondary-button" data-view-route="' +
        portalEscape(b.id) +
        '">🗺️ Lihat Rute</button>'
      : "") +
    "</div>" +
    "</div>"
  );
}

// Delegasi klik: tombol konfirmasi & chip filter dibuat ulang setiap render.
const portalBatchListEl = document.getElementById("portalBatchList");
if (portalBatchListEl) {
  portalBatchListEl.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-confirm-batch]");
    if (btn) openPortalConfirmModal(btn.dataset.confirmBatch);

    const routeBtn = event.target.closest("[data-view-route]");
    if (routeBtn) openRouteModal(routeBtn.dataset.viewRoute);
  });
}

const portalFiltersEl = document.getElementById("portalFilters");
if (portalFiltersEl) {
  portalFiltersEl.addEventListener("click", function (event) {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;

    portalActiveFilter = chip.dataset.filter;
    refreshPortalData();
  });
}

/* ---------- 4. Riwayat verifikasi + traceability ---------- */

function renderPortalRiwayat(place) {
  const list = document.getElementById("portalRiwayatList");
  if (!list) return;

  const verified = getPortalVerifiedBatches(place.namaTempat).sort(
    function (a, b) {
      return new Date(b.tanggalVerifikasi) - new Date(a.tanggalVerifikasi);
    },
  );

  const products = getStoredProducts();

  const linkedCount = verified.filter(function (b) {
    return (
      b.usedInProduct ||
      products.some(function (p) {
        return p.kodeBatch === b.id;
      })
    );
  }).length;

  portalSetText(
    "portalRiwayatSummary",
    verified.length > 0
      ? linkedCount +
          " dari " +
          verified.length +
          " batch terverifikasi sudah ditautkan ke produk."
      : "",
  );

  if (verified.length === 0) {
    list.innerHTML =
      '<p class="empty-note">Belum ada batch yang Anda verifikasi.</p>';
    return;
  }

  list.innerHTML = verified
    .map(function (b) {
      return buildPortalRiwayatCard(b, products);
    })
    .join("");
}

function buildPortalTraceHtml(b, products) {
  const linked = products.filter(function (p) {
    return p.kodeBatch === b.id;
  });

  if (linked.length > 0) {
    return (
      '<div class="portal-trace"><strong>🔗 Produk tertaut:</strong> ' +
      linked
        .map(function (p) {
          return (
            '<span class="portal-trace-product">' +
            portalEscape(p.nama) +
            " (Rp " +
            (Number(p.harga) || 0).toLocaleString("id-ID") +
            ")</span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  if (b.usedInProduct) {
    return '<div class="portal-trace portal-trace--muted">Ditandai sudah dipakai produk, tetapi data produknya tidak ditemukan di perangkat ini.</div>';
  }

  return '<div class="portal-trace portal-trace--muted">Belum ditautkan ke produk apa pun.</div>';
}

function buildPortalRiwayatCard(b, products) {
  return (
    '<div class="batch-card">' +
    '<div class="batch-card-top"><strong>' +
    portalEscape(b.id) +
    "</strong>" +
    portalStatusBadge(b.status) +
    "</div>" +
    "<p><strong>" +
    portalEscape(b.verifiedJenis || b.jenisDeclared) +
    ", " +
    portalFormatKg(b.verifiedWeight) +
    "</strong> (deklarasi " +
    portalFormatKg(b.beratDeclared) +
    ", selisih " +
    (Number(b.selisihPersen) || 0).toFixed(0) +
    "%)</p>" +
    "<small>Dari " +
    portalEscape(b.userNama || "Tamu") +
    " &middot; Diverifikasi " +
    portalFormatDate(b.tanggalVerifikasi) +
    "</small>" +
    buildPortalTraceHtml(b, products) +
    "</div>"
  );
}

/* ---------- 3. Modal konfirmasi penerimaan ---------- */

function getPortalConfirmBatch() {
  const idEl = document.getElementById("portalConfirmBatchId");
  if (!idEl || !idEl.value) return null;

  return (
    getStoredBatches().find(function (b) {
      return b.id === idEl.value;
    }) || null
  );
}

function openPortalConfirmModal(batchId) {
  const ctx = resolvePortalState();
  if (ctx.state !== "ok") return;

  const batch = getStoredBatches().find(function (b) {
    return b.id === batchId;
  });

  // Batch sudah berubah (mis. diverifikasi di tab lain) -> segarkan daftar
  if (
    !batch ||
    batch.status !== "diajukan" ||
    batch.pengelolaTujuan !== ctx.place.namaTempat
  ) {
    refreshPortalData();
    return;
  }

  document.getElementById("portalConfirmBatchId").value = batch.id;

  document.getElementById("portalConfirmSummary").innerHTML =
    "<div><span>Kode batch</span><strong>" +
    portalEscape(batch.id) +
    "</strong></div>" +
    "<div><span>Pengaju</span><strong>" +
    portalEscape(batch.userNama || "Tamu") +
    "</strong></div>" +
    "<div><span>Deklarasi pengguna</span><strong>" +
    portalEscape(batch.jenisDeclared) +
    ", " +
    portalFormatKg(batch.beratDeclared) +
    "</strong></div>" +
    (batch.catatan
      ? "<div><span>Catatan</span><strong>" +
        portalEscape(batch.catatan) +
        "</strong></div>"
      : "");

  // Pilihan jenis: default sama dengan deklarasi (boleh dikoreksi pengelola)
  const jenisList = WASTE_CATEGORIES.slice();
  if (jenisList.indexOf(batch.jenisDeclared) === -1) {
    jenisList.unshift(batch.jenisDeclared);
  }

  const jenisSelect = document.getElementById("portalConfirmJenis");
  jenisSelect.innerHTML = jenisList
    .map(function (j) {
      return (
        '<option value="' +
        portalEscape(j) +
        '"' +
        (j === batch.jenisDeclared ? " selected" : "") +
        ">" +
        portalEscape(j) +
        "</option>"
      );
    })
    .join("");

  const beratInput = document.getElementById("portalConfirmBerat");
  beratInput.value = batch.beratDeclared;

  document.getElementById("portalConfirmError").hidden = true;

  updatePortalConfirmPreview();

  document.getElementById("portalConfirmModal").classList.add("open");

  setTimeout(function () {
    beratInput.focus();
    beratInput.select();
  }, 50);
}

function closePortalConfirmModal() {
  const modal = document.getElementById("portalConfirmModal");
  if (modal) modal.classList.remove("open");
}

// Pratinjau langsung: selisih %, status yang akan diberikan, dan efeknya
// ke sisa kapasitas hari ini (sebelum pengelola menyimpan).
function updatePortalConfirmPreview() {
  const preview = document.getElementById("portalConfirmPreview");
  if (!preview) return;

  const batch = getPortalConfirmBatch();
  const actual = parseFloat(
    document.getElementById("portalConfirmBerat").value,
  );

  if (!batch || isNaN(actual) || actual < 0) {
    preview.innerHTML =
      '<span class="portal-preview-muted">Masukkan berat yang diterima untuk melihat selisih dan status.</span>';
    return;
  }

  const declared = Number(batch.beratDeclared) || 0;
  const selisih =
    declared > 0 ? (Math.abs(actual - declared) / declared) * 100 : 0;
  const needsReview = selisih > PORTAL_REVIEW_THRESHOLD;

  let html =
    '<div class="portal-preview-row"><span>Selisih dari deklarasi</span><strong>' +
    selisih.toFixed(0) +
    "%</strong></div>" +
    '<div class="portal-preview-row"><span>Status setelah disimpan</span>' +
    portalStatusBadge(needsReview ? "ditinjau" : "terverifikasi") +
    "</div>";

  if (needsReview) {
    html +=
      '<p class="portal-preview-note portal-preview-note--warn">Selisih di atas ' +
      PORTAL_REVIEW_THRESHOLD +
      "%, batch akan ditandai untuk ditinjau.</p>";
  }

  const ctx = resolvePortalState();

  if (ctx.state === "ok") {
    const kapasitas = Number(ctx.place.kapasitas) || 0;
    const terpakai = getVerifiedWeightTodayFor(ctx.place.namaTempat);
    const sisaSetelah = kapasitas - (terpakai + actual);

    html +=
      sisaSetelah < 0
        ? '<p class="portal-preview-note portal-preview-note--warn">Berat ini melebihi sisa kapasitas hari ini sebesar ' +
          portalFormatKg(-sisaSetelah) +
          ". Tetap bisa disimpan, tetapi tempat Anda akan melampaui kapasitas harian.</p>"
        : '<p class="portal-preview-note portal-preview-note--ok">Sisa kapasitas hari ini setelah verifikasi: ' +
          portalFormatKg(sisaSetelah) +
          ".</p>";
  }

  preview.innerHTML = html;
}

// Menulis hasil verifikasi ke reloop_batches. Field yang diisi sama persis
// dengan confirmBatchReceipt(): verifiedWeight, verifiedJenis, selisihPersen,
// tanggalVerifikasi, status.
function applyPortalVerification(batchId, actual, jenis) {
  const ctx = resolvePortalState();

  if (ctx.state !== "ok") {
    return { ok: false, message: "Sesi tidak valid. Silakan masuk kembali." };
  }

  const batches = getStoredBatches();
  const batch = batches.find(function (b) {
    return b.id === batchId;
  });

  if (!batch) {
    return { ok: false, message: "Batch tidak ditemukan." };
  }

  if (batch.pengelolaTujuan !== ctx.place.namaTempat) {
    return { ok: false, message: "Batch ini bukan untuk tempat Anda." };
  }

  if (batch.status !== "diajukan") {
    return { ok: false, message: "Batch ini sudah pernah diverifikasi." };
  }

  const declared = Number(batch.beratDeclared) || 0;
  const selisihPersen =
    declared > 0 ? (Math.abs(actual - declared) / declared) * 100 : 0;

  batch.verifiedWeight = actual;
  batch.verifiedJenis = jenis || batch.jenisDeclared;
  batch.selisihPersen = selisihPersen;
  batch.tanggalVerifikasi = new Date().toISOString();
  batch.status =
    selisihPersen > PORTAL_REVIEW_THRESHOLD ? "ditinjau" : "terverifikasi";

  saveStoredBatches(batches);

  return { ok: true, batch: batch, place: ctx.place };
}

function handlePortalConfirmSubmit(event) {
  event.preventDefault();

  const errorEl = document.getElementById("portalConfirmError");
  errorEl.hidden = true;

  const batchId = document.getElementById("portalConfirmBatchId").value;
  const actual = parseFloat(
    document.getElementById("portalConfirmBerat").value,
  );
  const jenis = document.getElementById("portalConfirmJenis").value;

  if (isNaN(actual) || actual < 0) {
    errorEl.textContent = "Berat tidak valid. Masukkan angka 0 atau lebih.";
    errorEl.hidden = false;
    return;
  }

  const result = applyPortalVerification(batchId, actual, jenis);

  if (!result.ok) {
    errorEl.textContent = result.message;
    errorEl.hidden = false;
    return;
  }

  closePortalConfirmModal();

  // Sinkronkan bagian lain yang membaca data yang sama
  renderRiwayatBatches(); // riwayat di halaman Jemput Sampah
  renderPanelPengelola(); // panel kecil lama di halaman Jemput Sampah
  refreshPortalManagerCard(result.place); // bar kapasitas di halaman Pengelola
  refreshPortalData();

  showPortalFlash(
    "Batch " +
      result.batch.id +
      " ditandai " +
      (result.batch.status === "ditinjau" ? "Ditinjau" : "Terverifikasi") +
      ". Selisih dari deklarasi: " +
      result.batch.selisihPersen.toFixed(0) +
      "%.",
    result.batch.status === "ditinjau" ? "warn" : "ok",
  );
}

/* ---------- 6. Profil tempat ---------- */

function fillPortalProfilForm(place) {
  const nama = document.getElementById("portalProfilNama");
  const kapasitas = document.getElementById("portalProfilKapasitas");
  const jam = document.getElementById("portalProfilJam");
  const grid = document.getElementById("portalProfilKategori");
  if (!nama || !kapasitas || !jam || !grid) return;

  nama.value = place.namaTempat;
  kapasitas.value = place.kapasitas || "";
  jam.value = place.jamOperasional || "";

  const selected = place.categories || [];

  // Kategori yang sudah tersimpan tapi tidak ada di daftar baku tetap ditampilkan
  const options = WASTE_CATEGORIES.slice();
  selected.forEach(function (c) {
    if (options.indexOf(c) === -1) options.push(c);
  });

  grid.innerHTML = options
    .map(function (c) {
      return (
        '<label><input type="checkbox" value="' +
        portalEscape(c) +
        '"' +
        (selected.indexOf(c) !== -1 ? " checked" : "") +
        " /> " +
        portalEscape(c) +
        "</label>"
      );
    })
    .join("");

  const kelasHint = document.getElementById("portalProfilKelasHint");
  if (kelasHint) {
    kelasHint.style.display = place.kelas === "mandiri" ? "block" : "none";
  }

  const status = document.getElementById("portalProfilStatus");
  if (status) status.hidden = true;
}

function handlePortalProfilSubmit(event) {
  event.preventDefault();

  const status = document.getElementById("portalProfilStatus");

  const showError = function (message) {
    status.textContent = message;
    status.hidden = false;
  };

  status.hidden = true;

  const ctx = resolvePortalState();

  if (ctx.state !== "ok") {
    showError("Sesi tidak valid. Silakan masuk kembali.");
    return;
  }

  const kapasitas = parseFloat(
    document.getElementById("portalProfilKapasitas").value,
  );
  const jam = document.getElementById("portalProfilJam").value.trim();
  const categories = Array.from(
    document.querySelectorAll("#portalProfilKategori input:checked"),
  ).map(function (input) {
    return input.value;
  });

  if (isNaN(kapasitas) || kapasitas <= 0) {
    showError("Kapasitas harian harus lebih dari 0 kg.");
    return;
  }

  if (categories.length === 0) {
    showError("Pilih minimal satu jenis sampah yang diterima.");
    return;
  }

  const stored = getStoredManagers();
  const idx = stored.findIndex(function (m) {
    return (
      m.ownerEmail === ctx.user.email && m.namaTempat === ctx.place.namaTempat
    );
  });

  if (idx === -1) {
    showError("Data tempat tidak ditemukan.");
    return;
  }

  stored[idx].kapasitas = kapasitas;
  stored[idx].jamOperasional = jam;
  stored[idx].categories = categories;
  saveStoredManagers(stored);

  refreshPortalManagerCard(stored[idx]);
  refreshPortalData();

  showPortalFlash("Profil tempat berhasil diperbarui.", "ok");
  renderProfilPengelola();
  showProfilFlash("Profil tempat berhasil diperbarui.");
}

// Ganti kartu satu tempat di halaman Pengelola (pencocokan nama persis),
// dengan mempertahankan jarak & status filter kartu yang lama.
function refreshPortalManagerCard(placeData) {
  const list = document.getElementById("managerList");
  if (!list || !placeData) return;

  const existing = Array.from(list.querySelectorAll(".manager-result")).find(
    function (el) {
      const h3 = el.querySelector("h3");
      if (!h3) return false;

      const clone = h3.cloneNode(true);
      clone.querySelectorAll(".new-badge").forEach(function (badge) {
        badge.remove();
      });

      return clone.textContent.trim() === placeData.namaTempat;
    },
  );

  if (!existing) return;

  const replacement = buildManagerCard(placeData);

  const oldDistance = existing.querySelector(".distance");
  const newDistance = replacement.querySelector(".distance");
  if (oldDistance && newDistance) {
    newDistance.textContent = oldDistance.textContent;
  }
  if (existing.dataset.distanceValue) {
    replacement.dataset.distanceValue = existing.dataset.distanceValue;
  }
  replacement.style.display = existing.style.display;

  existing.replaceWith(replacement);
}

/* ---------- Penutup modal & sinkron antar tab ---------- */

// Tutup modal konfirmasi jika klik area gelap di luar kotak modal
document.addEventListener("click", function (event) {
  const modal = document.getElementById("portalConfirmModal");

  if (modal && event.target === modal) {
    closePortalConfirmModal();
  }
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") closePortalConfirmModal();
});

// Jika data reloop_* berubah dari tab browser lain (mis. pengguna baru
// mengajukan penjemputan), segarkan Portal supaya angka tetap terkini.
window.addEventListener("storage", function (event) {
  if (!event.key || event.key.indexOf("reloop_") !== 0) return;

  if (event.key === "reloop_current_user") updateAuthUI();

  const page = document.getElementById("portal-pengelola");
  if (!page || !page.classList.contains("active-page")) return;

  if (event.key === "reloop_current_user") {
    renderPortalPengelola();
  } else {
    refreshPortalData();
  }
});

/* =========================================
   INISIALISASI SAAT HALAMAN DIMUAT
========================================= */

document.addEventListener("DOMContentLoaded", function () {
  renderCategoryUI();
  loadStoredManagersOnStart();
  loadStoredProductsOnStart();
  updateAuthUI();

  // Peta home aktif secara default karena halaman "home" adalah halaman awal
  initHomeMap();

  // Coba ambil lokasi pengguna secara diam-diam untuk memusatkan peta &
  // menghitung jarak sungguhan. Browser tetap akan meminta izin lokasi.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (position) {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        const locationText = document.getElementById("locationText");

        if (locationText) {
          locationText.textContent =
            "Lokasi ditemukan: " +
            userLocation.lat.toFixed(4) +
            ", " +
            userLocation.lng.toFixed(4);
        }

        updateDistancesFromUserLocation();

        // Kalau halaman Pengelola (yang kini juga memuat Jemput Sampah)
        // sudah aktif, ikut segarkan rekomendasi pengelola terdekat &
        // urutan <select> dengan lokasi sungguhan.
        const jemputPage = document.getElementById("pengelola");
        if (jemputPage && jemputPage.classList.contains("active-page")) {
          populateJemputPengelolaSelect();
          renderJemputRekomendasi();
        }
      },
      function () {
        // Pengguna menolak izin lokasi; tetap gunakan pusat Kota Malang
        // sebagai default agar peta tidak kosong.
      },
    );
  }
});

/* =========================================
   PROFIL RELOOP (KLIK LOGO DI NAVBAR)
========================================= */

function openReloopProfile() {
  document.getElementById("reloopProfileModal").classList.add("open");
}

function closeReloopProfile() {
  document.getElementById("reloopProfileModal").classList.remove("open");
}

// Logo juga bisa dibuka lewat keyboard (Enter atau Spasi)
const logoAreaEl = document.getElementById("logoArea");

if (logoAreaEl) {
  logoAreaEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openReloopProfile();
    }
  });
}

// Tombol Esc menutup jendela profil dan detail produk
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeReloopProfile();
    closeProductDetail();
  }
});


/* =========================================
   AKUN BAWAAN PENGELOLA (SEED)
   -----------------------------------------
   Satu akun untuk tiap tempat pengelolaan di halaman Pengelola.
   Nama tempat harus SAMA PERSIS dengan judul kartu di index.html
   (dipakai sebagai penghubung ke kode batch).
   Kapasitas harian di bawah adalah angka contoh: ubah lewat
   menu Profil Pengelola.
   PERINGATAN: kata sandi di file ini terlihat oleh siapa pun yang
   membuka kode. Hanya untuk prototipe; hapus sebelum dipublikasikan.
========================================= */

const PENGELOLA_SEED = [
  { nama: "Bank Sampah Malang", email: "banksampahmalang@reloop.id", password: "BSM@Reloop26",
    categories: ["Plastik"], lat: -7.995456, lng: 112.619461, kapasitas: 300,
    alamat: "Jl. S. Supriadi No.38 A, Sukun, Kota Malang, Jawa Timur 65147",
    jamOperasional: "Senin-Kamis & Sabtu 08.00-16.00, Jumat 08.00-11.00 & 13.00-16.00 WIB",
    telepon: "+62 341 341618", foto: "bank sampah malang.webp" },
  { nama: "TPS3R BASAMA Bandungrejosari", email: "tps3rbasama@reloop.id", password: "BASAMA@Reloop26",
    categories: ["Organik", "Plastik"], lat: -7.9986344, lng: 112.6053124, kapasitas: 500,
    alamat: "Gg. Dr. Soetomo, Bandungrejosari, Sukun, Kota Malang, Jawa Timur 65148",
    jamOperasional: "Senin-Sabtu 07.00-15.00 WIB", telepon: "", foto: "tps3r basama.webp" },
  { nama: "TPS3R Kelurahan Buring", email: "tps3rburing@reloop.id", password: "BURING@Reloop26",
    categories: ["Organik", "Plastik"], lat: -8.0161654, lng: 112.6448084, kapasitas: 500,
    alamat: "Buring, Kedungkandang, Kota Malang, Jawa Timur 65135",
    jamOperasional: "24 Jam", telepon: "", foto: "tps3r buring.webp" },
  { nama: "TPST 3R Mulyoagung Bersatu", email: "tpst3rmulyoagung@reloop.id", password: "MULYO@Reloop26",
    categories: ["Organik", "Plastik"], lat: -7.9213785, lng: 112.5834081, kapasitas: 800,
    alamat: "Jl. TPST No.01, Jetak Lor, Mulyoagung, Kec. Dau, Kabupaten Malang, Jawa Timur 65151",
    jamOperasional: "Senin-Sabtu 06.30-17.00 WIB", telepon: "+62 813-3555-5131", foto: "tpst 3r mulyoangung.jpg" },
  { nama: "TPA Supit Urang", email: "tpasupiturang@reloop.id", password: "SUPIT@Reloop26",
    categories: ["Organik"], lat: -7.9827377, lng: 112.5779182, kapasitas: 2000,
    alamat: "Pandan Selatan, Pandanlandung, Kec. Wagir, Kabupaten Malang, Jawa Timur 65158",
    jamOperasional: "24 Jam", telepon: "", foto: "tpa.webp" },
  { nama: 'Unit Bank Sampah Malang "Melati"', email: "banksampahmelati@reloop.id", password: "MELATI@Reloop26",
    categories: ["Plastik"], lat: -7.9864553, lng: 112.6437425, kapasitas: 200,
    alamat: "Jl. Krisno No.36 02, Polehan, Kec. Blimbing, Kota Malang, Jawa Timur 65126",
    jamOperasional: "Setiap Hari 07.00-17.00 WIB", telepon: "+62 341 7729786", foto: "bank sampah melati.webp" },
  { nama: "Smart Waste Center", email: "smartwastecenter@reloop.id", password: "SMART@Reloop26",
    categories: ["Plastik"], lat: -8.0097524, lng: 112.6482826, kapasitas: 400,
    alamat: "Jl. KH. Malik Dalam No.II, Buring, Kec. Kedungkandang, Kota Malang, Jawa Timur 65135",
    jamOperasional: "Senin-Jumat 09.00-16.00 WIB", telepon: "+62 811-3566-665", foto: "smart.jpg" },
];

// Tambahkan akun & tempat bawaan bila belum ada (aman dijalankan berulang).
function seedPengelolaAccounts() {
  const users = getStoredUsers();
  const places = getStoredManagers();

  PENGELOLA_SEED.forEach(function (p) {
    const u = users.find(function (x) { return x.email === p.email; });
    if (u) {
      u.role = "pengelola";
    } else {
      users.push({ nama: p.nama, email: p.email, password: p.password, role: "pengelola" });
    }

    const exists = places.some(function (m) { return m.ownerEmail === p.email; });
    if (!exists) {
      places.push({
        namaTempat: p.nama, ketua: "", jumlahKaryawan: "", telepon: p.telepon,
        alamat: p.alamat, jamOperasional: p.jamOperasional, categories: p.categories,
        lat: p.lat, lng: p.lng, isApprox: false, kelas: "institusional",
        kapasitas: p.kapasitas, ownerEmail: p.email, foto: p.foto, seed: true,
      });
    }
  });

  saveStoredUsers(users);
  saveStoredManagers(places);
}

function managerCardExists(name) {
  return Array.from(document.querySelectorAll("#managerList .manager-result h3")).some(function (h3) {
    const c = h3.cloneNode(true);
    c.querySelectorAll(".new-badge").forEach(function (b) { b.remove(); });
    return c.textContent.trim() === name;
  });
}

seedPengelolaAccounts();

/* =========================================
   PROFIL PENGELOLA (halaman khusus akun Pengelola)
========================================= */

let profilFlashTimer = null;

function showProfilFlash(message) {
  const el = document.getElementById("profilFlash");
  if (!el) return;
  el.textContent = message;
  el.className = "portal-flash portal-flash--ok";
  el.hidden = false;
  clearTimeout(profilFlashTimer);
  profilFlashTimer = setTimeout(function () { el.hidden = true; }, 6000);
}

function renderProfilPengelola() {
  const locked = document.getElementById("profilLocked");
  const content = document.getElementById("profilContent");
  if (!locked || !content) return;

  const ctx = resolvePortalState();

  if (ctx.state !== "ok") {
    locked.innerHTML =
      '<div class="locked-feature-note portal-locked">Halaman ini khusus <strong>akun Pengelola</strong> yang sudah memiliki tempat pengelolaan.</div>';
    locked.style.display = "block";
    content.style.display = "none";
    return;
  }

  locked.style.display = "none";
  content.style.display = "block";

  const p = ctx.place;
  portalSetText("profilNama", p.namaTempat);

  document.getElementById("profilKelas").innerHTML =
    p.kelas === "institusional"
      ? '<span class="kelas-badge kelas-badge--institusional">🏛 Institusional</span>'
      : '<span class="kelas-badge kelas-badge--mandiri">👤 Mandiri</span>';

  const rows = [
    ["📍", p.alamat || "-"],
    ["🕒", p.jamOperasional || "Jam operasional belum diisi"],
    ["📞", p.telepon || "-"],
    ["⚖️", "Kapasitas olah harian: " + portalFormatKg(p.kapasitas)],
  ];
  if (p.ketua) rows.push(["👤", "Ketua: " + p.ketua]);
  if (p.jumlahKaryawan) rows.push(["👥", p.jumlahKaryawan + " karyawan"]);

  document.getElementById("profilSummary").innerHTML =
    rows.map(function (r) { return "<p>" + r[0] + " " + portalEscape(r[1]) + "</p>"; }).join("") +
    '<div class="tags">' +
    (p.categories || []).map(function (c) { return "<span>" + portalEscape(c) + "</span>"; }).join("") +
    "</div>";

  fillPortalProfilForm(p);
}

/* =========================================
   PIHAK PRODUKSI (halaman khusus akun Pengelola)
   Data contoh: ganti dengan mitra Produksi sebenarnya.
========================================= */

const PIHAK_PRODUKSI = [
  { nama: "Pelet Plastik Nusantara", jenis: ["Plastik"], kode: ["1 PET", "2 HDPE", "5 PP"],
    produk: "Bijih/pelet plastik daur ulang", alamat: "Kawasan industri Singosari, Kab. Malang",
    lat: -7.8967, lng: 112.665, kapasitas: 3000, syarat: "Plastik bersih, sudah dipilah per kode daur ulang" },
  { nama: "Paving & Ecobrick Sukun", jenis: ["Plastik"], kode: ["4 LDPE", "5 PP"],
    produk: "Paving block dan ecobrick dari plastik lentur", alamat: "Sukun, Kota Malang",
    lat: -8.0, lng: 112.61, kapasitas: 800, syarat: "Plastik kering, boleh berlabel" },
  { nama: "Serat Daur Pakis", jenis: ["Plastik"], kode: ["1 PET"],
    produk: "Serat polyester dari botol PET", alamat: "Pakis, Kab. Malang",
    lat: -7.97, lng: 112.71, kapasitas: 2000, syarat: "Botol tanpa tutup & label, sudah dibilas" },
  { nama: "Kompos Sentra Kepanjen", jenis: ["Organik"], kode: [],
    produk: "Kompos dan pupuk organik", alamat: "Kepanjen, Kab. Malang",
    lat: -8.13, lng: 112.57, kapasitas: 5000, syarat: "Bebas plastik, bukan daging/tulang besar" },
  { nama: "Biogas & Maggot Lawang", jenis: ["Organik"], kode: [],
    produk: "Biogas dan pakan maggot BSF", alamat: "Lawang, Kab. Malang",
    lat: -7.835, lng: 112.696, kapasitas: 2500, syarat: "Sisa makanan/sayur, dipisah dari sampah lain" },
  { nama: "Kompos Industri PLA Blimbing", jenis: ["Plastik"], kode: ["7 PLA"],
    produk: "Pengomposan industri bioplastik PLA", alamat: "Blimbing, Kota Malang",
    lat: -7.94, lng: 112.655, kapasitas: 600, syarat: "Hanya kode 7 PLA, jangan dicampur kode 1-6" },
];

let produksiMapObj = null;
let produksiLayer = null;
let produksiFilter = "Semua";

function renderPihakProduksi() {
  const ctx = resolvePortalState();
  const origin = ctx.state === "ok" ? { lat: ctx.place.lat, lng: ctx.place.lng } : MALANG_CENTER;
  const myCats = ctx.state === "ok" ? ctx.place.categories || [] : [];

  const list = PIHAK_PRODUKSI.map(function (p) {
    return Object.assign({}, p, { jarak: haversineDistanceKm(origin.lat, origin.lng, p.lat, p.lng) });
  }).sort(function (a, b) { return a.jarak - b.jarak; });

  const shown = list.filter(function (p) {
    return produksiFilter === "Semua" || p.jenis.indexOf(produksiFilter) !== -1;
  });

  document.getElementById("produksiFilters").innerHTML = ["Semua", "Plastik", "Organik"]
    .map(function (f) {
      return '<button type="button" class="portal-chip' + (f === produksiFilter ? " active" : "") +
        '" data-jenis="' + f + '">' + f + "</button>";
    }).join("");

  document.getElementById("produksiList").innerHTML = shown.length
    ? shown.map(function (p) {
        const cocok = p.jenis.some(function (j) { return myCats.indexOf(j) !== -1; });
        return (
          '<div class="batch-card"><div class="batch-card-top"><strong>' + portalEscape(p.nama) + "</strong>" +
          (cocok ? '<span class="produksi-match">Cocok dengan tempat Anda</span>' : "") + "</div>" +
          "<p>📍 " + portalEscape(p.alamat) + " · " + p.jarak.toFixed(1).replace(".", ",") + " km</p>" +
          "<p>🏭 " + portalEscape(p.produk) + "</p>" +
          "<p>⚖️ Menerima hingga " + portalFormatKg(p.kapasitas) + " per hari</p>" +
          "<p>📋 " + portalEscape(p.syarat) + "</p>" +
          '<div class="tags">' +
          p.jenis.map(function (j) { return "<span>" + j + "</span>"; }).join("") +
          p.kode.map(function (k) { return "<span>" + k + "</span>"; }).join("") + "</div>" +
          '<div class="produksi-actions">' +
          '<button type="button" class="primary-button" data-rute="' + p.lat + "," + p.lng + '">Lihat Rute</button>' +
          '<button type="button" class="secondary-button" data-fokus="' + p.lat + "," + p.lng + '">Lihat di Peta</button>' +
          "</div></div>"
        );
      }).join("")
    : '<p class="empty-note">Belum ada tempat produksi untuk jenis ini.</p>';

  if (!produksiMapObj) {
    produksiMapObj = L.map("produksiMap").setView([origin.lat, origin.lng], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(produksiMapObj);
    produksiLayer = L.layerGroup().addTo(produksiMapObj);
  }

  produksiLayer.clearLayers();
  L.circleMarker([origin.lat, origin.lng], { radius: 9, color: "#1e6b34", fillOpacity: 0.9 })
    .addTo(produksiLayer).bindPopup("Tempat Anda");
  shown.forEach(function (p) {
    L.marker([p.lat, p.lng]).addTo(produksiLayer).bindPopup("<strong>" + portalEscape(p.nama) + "</strong><br>" + portalEscape(p.produk));
  });

  setTimeout(function () { produksiMapObj.invalidateSize(); }, 80);
}

const produksiPageEl = document.getElementById("pihak-produksi");
if (produksiPageEl) {
  produksiPageEl.addEventListener("click", function (event) {
    const chip = event.target.closest("[data-jenis]");
    if (chip) {
      produksiFilter = chip.dataset.jenis;
      renderPihakProduksi();
      return;
    }
    const rute = event.target.closest("[data-rute]");
    if (rute) {
      window.open("https://www.google.com/maps/dir/?api=1&destination=" + rute.dataset.rute, "_blank");
      return;
    }
    const fokus = event.target.closest("[data-fokus]");
    if (fokus && produksiMapObj) {
      const c = fokus.dataset.fokus.split(",").map(Number);
      produksiMapObj.setView(c, 13);
      document.getElementById("produksiMap").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}
