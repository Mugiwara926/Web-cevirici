let worker = null;
const processedImages = new Map();

// 1. Tesseract Worker Başlatıcı (Hata Denetimli)
async function getWorker() {
    if (worker) return worker;
    try {
        worker = await Tesseract.createWorker(['eng', 'tur'], 1, {
            workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
            corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
            langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
            gzip: false 
        });
        
        await worker.setParameters({
            tessedit_pageseg_mode: '12', 
            user_defined_dpi: '300'
        });
        return worker;
    } catch (e) {
        console.error("OCR Motoru başlatılamadı:", e);
        return null;
    }
}

// 2. Görüntü Ön İşleme (CORS ve Netlik Çözümü) - EKSİK OLAN KISIM BURASIYDI
function preprocessImage(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            // Kontrast artırımı ve gri tonlama OCR başarısını artırır
            ctx.filter = 'contrast(1.3) grayscale(100%)'; 
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

// 3. Akıllı Gruplama Mantığı
function getSmartBalloons(lines) {
    if (!lines || lines.length === 0) return [];
    const validLines = lines.filter(l => l.confidence > 35 && l.text.trim().length > 1);
    const groups = [];

    validLines.forEach(line => {
        let merged = false;
        const lineHeight = line.bbox.y1 - line.bbox.y0;
        for (let g of groups) {
            const verticalDist = Math.abs(line.bbox.y0 - g.bbox.y1);
            const horizontalDist = Math.max(0, Math.max(line.bbox.x0 - g.bbox.x1, g.bbox.x0 - line.bbox.x1));
            if (verticalDist <= lineHeight * 2.0 && horizontalDist <= lineHeight * 1.5) {
                g.text += " " + line.text;
                g.bbox.x0 = Math.min(g.bbox.x0, line.bbox.x0);
                g.bbox.y0 = Math.min(g.bbox.y0, line.bbox.y0);
                g.bbox.x1 = Math.max(g.bbox.x1, line.bbox.x1);
                g.bbox.y1 = Math.max(g.bbox.y1, line.bbox.y1);
                g.lineCount++;
                merged = true;
                break;
            }
        }
        if (!merged) groups.push({ text: line.text, bbox: { ...line.bbox }, lineCount: 1 });
    });
    return groups;
}

// 4. Manuel İşleme Tetikleyicisi
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "manual_process") {
        const targetImg = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (targetImg) {
            processImage(targetImg);
        }
    }
});

async function processImage(img) {
    if (img.dataset.status === "loading") return;

    img.dataset.status = "loading";
    img.style.filter = "blur(2px)"; // Kullanıcıya "işleniyor" efekti

    chrome.runtime.sendMessage({ action: "fetch_image", url: img.src }, async (res) => {
        if (!res || res.error) {
            img.dataset.status = "ready";
            img.style.filter = "none";
            return;
        }

        try {
            const w = await getWorker();
            if (!w) throw new Error("Worker yok");

            const processedSrc = await preprocessImage(res.data);
            const { data } = await w.recognize(processedSrc);
            const balloons = getSmartBalloons(data.lines || []);
            const overlays = [];

            for (const b of balloons) {
                const cleanText = b.text.replace(/[^a-zA-Z0-9\s.,!?'"()-]/g, '').trim();
                if (cleanText.length < 2) continue;

                const transRes = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: "translate", text: cleanText }, resolve);
                });
                
                if (transRes && transRes.translated) {
                    overlays.push(placeOverlay(img, b.bbox, transRes.translated, b.lineCount));
                }
            }
            processedImages.set(img.src, overlays);
            img.dataset.status = "done";
        } catch (e) {
            console.error("İşlem hatası:", e);
            img.dataset.status = "ready";
        } finally {
            img.style.filter = "none";
        }
    });
}

function placeOverlay(img, bbox, text, lineCount) {
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    // 1. Kutunun Temel Boyutlarını ve Konumunu Hesapla
    const boxLeft = rect.left + window.pageXOffset + (bbox.x0 * scaleX);
    const boxTop = rect.top + window.pageYOffset + (bbox.y0 * scaleY);
    const boxWidth = (bbox.x1 - bbox.x0) * scaleX;
    const boxHeight = (bbox.y1 - bbox.y0) * scaleY;

    // 2. Overlay Div'ini Oluştur
    const div = document.createElement('div');
    div.style = `
        position: absolute;
        left: ${boxLeft}px;
        top: ${boxTop}px;
        width: ${boxWidth}px;
        height: ${boxHeight}px;
        
        /* GÖRSEL İYİLEŞTİRMELER */
        background: rgba(255, 255, 255, 0.9); /* Saf beyaz yerine hafif şeffaf */
        color: #000; /* Tam siyah */
        font-family: 'CC Wild Words', 'Anime Ace', 'Segoe UI', sans-serif; /* Manga fontları */
        font-weight: bold;
        line-height: 1.1;
        
        /* HİZALAMA */
        display: flex;
        align-items: center; /* Dikeyde ortala */
        justify-content: center; /* Yatayda ortala */
        text-align: center;
        
        /* DÜZEN VE TAŞMA DENETİMİ */
        z-index: 2147483647;
        padding: 4px; /* Metin kenarlara yapışmasın */
        box-sizing: border-box; /* Padding'i genişliğe dahil et */
        word-wrap: break-word; /* Uzun kelimeleri böl */
        overflow: hidden; /* Taşmayı gizle (amaç aşağıda sığdırmak) */
        
        /* ESTETİK */
        border-radius: 6px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    `;
    
    // 3. İçerik Span'ını Oluştur (Boyut ölçümü için gerekli)
    const span = document.createElement('span');
    span.innerText = text;
    div.appendChild(span);
    document.body.appendChild(div);

    // 4. KRİTİK ÇÖZÜM: Dinamik Yazı Boyutu Sığdırma (Auto-Shrink)
    // Maksimum ve minimum yazı boyutlarını belirle
    let maxFontSize = 20; 
    let minFontSize = 9;
    let currentFontSize = maxFontSize;

    // Metin kutuya sığana veya minimum boyuta ulaşana kadar döngüyü çalıştır
    while (currentFontSize > minFontSize) {
        span.style.fontSize = currentFontSize + 'px';
        
        // Span'ın (metnin) boyutları, div'in (kutunun) boyutlarını aşıyor mu?
        if (span.offsetWidth <= div.clientWidth - 8 && span.offsetHeight <= div.clientHeight - 8) {
            // Sığdı! Döngüden çık.
            break; 
        }
        
        // Sığmadı, yazı boyutunu küçült ve tekrar dene.
        currentFontSize -= 0.5; // Daha hassas ayar için 0.5 azaltıyoruz.
    }
    
    // Eğer minimum boyutta bile sığmıyorsa, kelime bölmeyi (hyphens) açabiliriz.
    if (currentFontSize <= minFontSize) {
        div.style.hyphens = 'auto';
        div.style.webkitHyphens = 'auto';
    }

    return div;
}