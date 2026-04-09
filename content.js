// content.js

// 1. Gözlemci (Observer) Ayarları
const observerOptions = {
    root: null, // Viewport'u baz al
    threshold: 0.5 // Resmin %50'si göründüğünde tetikle
};

// 2. Resim göründüğünde ne yapılacağını belirleyen fonksiyon
const handleIntersection = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            
            // Eğer resim zaten çevrildiyse tekrar uğraşma
            if (img.dataset.translated === "true") return;

            console.log("Çeviri için resim yakalandı:", img.src);
            
            // Burada OCR ve Çeviri aşamasına geçilecek
            startTranslationProcess(img);
            
            // İşlem tamamlanınca işaretle
            img.dataset.translated = "true";
        }
    });
};

// 3. Gözlemciyi başlat
const observer = new IntersectionObserver(handleIntersection, observerOptions);

// 4. Sayfadaki tüm resimleri (img etiketlerini) takip et
function scanImages() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        // Çok küçük ikonları veya reklamları filtrelemek için boyut kontrolü
        if (img.width > 200 && img.height > 200) {
            observer.observe(img);
        }
    });
}

// Sayfa yüklendiğinde ve scroll yapıldığında tara
scanImages();

// Dinamik yüklenen resimler için (Sonsuz kaydırma olan siteler)
const domObserver = new MutationObserver(() => scanImages());
domObserver.observe(document.body, { childList: true, subtree: true });

function startTranslationProcess(img) {
    // Gelecek aşamada buraya OCR kodlarını ekleyeceğiz
    console.log("OCR Modülü bekleniyor...");
}