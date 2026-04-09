let worker = null;
const processedImages = new Map();

async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
    });
    
    // PSM 12: Sparse text with OSD (Dağınık metinleri ve yönleri en iyi anlayan moddur)
    await worker.setParameters({
        tessedit_pageseg_mode: '12',
        user_defined_dpi: '300'
    });
    return worker;
}

// 🧠 KUSURSUZ GRUPLAMA (Göreceli Uzaklık Hesaplama)
function getSmartBalloons(lines) {
    if (!lines || lines.length === 0) return [];
    
    // Çok düşük kaliteli çöpleri ele
    const validLines = lines.filter(l => l.confidence > 25 && l.text.trim().length > 1);
    const groups = [];

    validLines.forEach(line => {
        let merged = false;
        // O an okunan satırın yüksekliği (Bu bizim referansımız olacak)
        const lineHeight = line.bbox.y1 - line.bbox.y0;

        for (let g of groups) {
            const verticalDist = Math.abs(line.bbox.y0 - g.bbox.y1);
            const horizontalDist = Math.max(0, Math.max(line.bbox.x0 - g.bbox.x1, g.bbox.x0 - line.bbox.x1));
            
            // Satırın kendi yüksekliğinin 2 katından daha yakınlarsa kesin aynı balondalardır!
            if (verticalDist <= lineHeight * 2.5 && horizontalDist <= lineHeight * 2) {
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

async function processImage(img) {
    if (img.dataset.status === "done" || img.dataset.status === "loading" || img.naturalWidth < 250) return;

    img.dataset.status = "loading";
    
    chrome.runtime.sendMessage({ action: "fetch_image", url: img.src }, async (res) => {
        if (!res || res.error) { img.dataset.status = "ready"; return; }

        try {
            const w = await getWorker();
            const { data } = await w.recognize(res.data);
            const balloons = getSmartBalloons(data.lines || []);
            const overlays = [];

            for (const b of balloons) {
                // Sadece harf, rakam ve temel noktalama kalsın
                const cleanText = b.text.replace(/[^a-zA-Z0-9\s.,!?'"()-]/g, '').replace(/\s+/g, ' ').trim();
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
            img.dataset.status = "ready";
        }
    });
}

// 🎨 KUSURSUZ UI (Taşma Korumalı ve Yumuşak Tasarım)
function placeOverlay(img, bbox, text, lineCount) {
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    // Orijinal yazıyı kapatması için kutuyu her yönden %5 büyütüyoruz (Padding efekti)
    const paddingX = 8 * scaleX; 
    const paddingY = 8 * scaleY;

    const boxWidth = ((bbox.x1 - bbox.x0) * scaleX) + paddingX;
    const boxHeight = ((bbox.y1 - bbox.y0) * scaleY) + paddingY;

    // Dinamik Font: Kutu yüksekliğine ve satır sayısına göre optimum boyutu bulur
    let rawFontSize = (boxHeight / Math.max(1, lineCount)) * 0.70;
    // Maksimum 18px (göz yormaması için), Minimum 11px (okunabilirlik için)
    let finalFontSize = Math.min(Math.max(rawFontSize, 11), 18);

    const div = document.createElement('div');
    div.style = `
        position: absolute;
        top: ${window.scrollY + rect.top + (bbox.y0 * scaleY) - (paddingY/2)}px;
        left: ${window.scrollX + rect.left + (bbox.x0 * scaleX) - (paddingX/2)}px;
        width: ${boxWidth}px;
        min-height: ${boxHeight}px;
        height: max-content; /* Eğer çeviri çok uzunsa kutu aşağı doğru esner */
        background: rgba(255, 255, 255, 0.97); /* Tam beyaz değil, göz yormayan %97 opaklık */
        color: #111111;
        font-family: 'Comic Sans MS', 'Segoe UI', sans-serif; /* Manga hissiyatı */
        font-size: ${finalFontSize}px;
        font-weight: 700;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 4px;
        border-radius: 8px;
        pointer-events: none;
        line-height: 1.25;
        box-shadow: 0 2px 6px rgba(0,0,0,0.15); /* Hafif derinlik */
        box-sizing: border-box;
        word-wrap: break-word; /* Uzun kelimeleri böler, taşmayı engeller */
        overflow: hidden;
    `;
    div.innerText = text;
    document.body.appendChild(div);
    return div;
}

// 👁️ KUSURSUZ GÖZLEMCİ
const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting) processImage(e.target); });
}, { threshold: 0.1 });

function scan() {
    document.querySelectorAll('img').forEach(img => {
        if(!img.dataset.observed && img.naturalWidth > 300) {
            img.dataset.observed = "true";
            observer.observe(img);
        }
    });
}
setInterval(scan, 2000);

// Sağ tık temizliği
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "show_original") {
        const overlays = processedImages.get(msg.url);
        if (overlays) { overlays.forEach(o => o.remove()); processedImages.delete(msg.url); }
        const img = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (img) img.dataset.status = "ready";
    }
});