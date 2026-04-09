console.log("🚀 Web Çevirici: Sistem başlatıldı.");

let worker = null;

async function initOCR() {
    try {
        worker = await Tesseract.createWorker('eng');
        console.log("✅ OCR Motoru Hazır!");
    } catch (e) {
        console.error("❌ OCR Başlatma Hatası:", e);
    }
}
initOCR();

async function recognizeText(img) {
    if (!worker) return;

    try {
        // --- GÜNCELLEME: CORS ENGELİNİ AŞMAK İÇİN CANVAS KULLANIMI ---
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Resmi 'data url' formatına çeviriyoruz (Tesseract bunu daha kolay okur)
        const dataUrl = canvas.toDataURL('image/png');
        
        console.log("🔍 Resim okunuyor...");
        const { data: { text } } = await worker.recognize(dataUrl);

        if (text.trim().length > 0) {
            img.style.border = "5px solid green"; // Başarılı!
            console.log("%c [OKUNAN METİN]: ", "background: green; color: white; padding: 2px;", text);
        } else {
            img.style.border = "5px solid gray"; // Yazı yok
            console.log("⚪ Bu resimde yazı bulunamadı.");
        }
    } catch (err) {
        img.style.border = "5px solid yellow"; // Güvenlik engeli
        console.warn("⚠️ Resim okuma başarısız (Güvenlik/CORS):", img.src);
    }
}

// Görsel gözlemleme ve tarama kodların aynı kalsın...
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.processed) {
            entry.target.dataset.processed = "true";
            recognizeText(entry.target);
        }
    });
}, { threshold: 0.1 });

function scan() {
    document.querySelectorAll('img').forEach(img => {
        if (img.width > 200 && img.height > 200) observer.observe(img);
    });
}
setInterval(scan, 2000); // 2 saniyede bir yeni resimleri tara