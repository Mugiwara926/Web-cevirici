let worker = null;
const processedImages = new Map();

async function getWorker() {
    if (worker) return worker;
    
    // Tesseract'ı Türkçe ('tur') ve İngilizce ('eng') karışık okuyabilecek şekilde ayarlıyoruz
    // Bazen Tesseract İngilizce moddayken bazı harfleri tanıyamaz, 'tur' eklemek bunu azaltır.
    worker = await Tesseract.createWorker(['eng', 'tur'], 1, {
        workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
    });
    
    await worker.setParameters({
        tessedit_pageseg_mode: '12', // Dağınık metin modu
        user_defined_dpi: '300',
        tessedit_do_invert: '0' // Manga okurken invert kapalı olmalı, bazen Tesseract kafayı yer
    });
    return worker;
}

// 🧠 KATI KÜMELEME (Strict Clustering)
// Hata: "Büyük kutu" sorunu.
// Çözüm: Satırları birleştirirken aralarındaki mesafenin ÇOK kısa olmasını şart koşuyoruz.
function getStrictBalloons(lines) {
    if (!lines || lines.length === 0) return [];
    
    // KATI GÜVEN EŞİĞİ: Tesseract'ın "emin" olmadığı (35 altı) her şeyi çöpe at!
    // Bu, çizimlerin veya gölgelerin yazı sanılıp kutuyu büyütmesini engeller.
    const validLines = lines.filter(l => l.confidence > 35 && l.text.trim().length > 1);
    const groups = [];

    validLines.forEach(line => {
        let merged = false;
        const lineHeight = line.bbox.y1 - line.bbox.y0;

        for (let g of groups) {
            const verticalDist = Math.abs(line.bbox.y0 - g.bbox.y1);
            const horizontalDist = Math.max(0, Math.max(line.bbox.x0 - g.bbox.x1, g.bbox.x0 - line.bbox.x1));
            
            // KATI SINIR: Dikeyde 1.5, Yatayda 1 satır boyu kadar yakın değilse ASLA birleştirme.
            // Bu ayar devasa beyaz kutuların oluşmasını tamamen engeller.
            if (verticalDist <= lineHeight * 1.5 && horizontalDist <= lineHeight * 1.0) {
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

// Görseli daha okunaklı hale getiren ön-işleme (Siyah zemin üstü beyaz yazılar için)
function preprocessImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    
    // Görüntüyü biraz netleştir ve kontrastı artır (Tesseract'ın "ayırt edemiyorum" dememesi için)
    ctx.filter = 'contrast(1.2) grayscale(100%)'; 
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
}

async function processImage(img) {
    if (img.dataset.status === "done" || img.dataset.status === "loading" || img.naturalWidth < 300) return;

    img.dataset.status = "loading";
    
    // İşlem başladığını belli eden ince bir belirteç (sayfayı bozmaz)
    img.style.boxShadow = "inset 0 0 10px rgba(0, 150, 255, 0.5)";

    try {
        const w = await getWorker();
        
        // HATA ÇÖZÜMÜ: Tesseract'a doğrudan img.src vermek yerine kontrastı artırılmış halini veriyoruz.
        const processedSrc = preprocessImage(img);
        const { data } = await w.recognize(processedSrc);
        
        const balloons = getStrictBalloons(data.lines || []);
        const overlays = [];

        for (const b of balloons) {
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
        img.style.boxShadow = "none"; // İşlem bitince belirteci kaldır
    } catch (e) {
        console.error("OCR Hatası:", e);
        img.dataset.status = "ready";
        img.style.boxShadow = "none";
    }
}

function placeOverlay(img, bbox, text, lineCount) {
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    const padding = 10; 
    const boxWidth = ((bbox.x1 - bbox.x0) * scaleX) + padding;
    const boxHeight = ((bbox.y1 - bbox.y0) * scaleY) + padding;

    let rawFontSize = (boxHeight / Math.max(1, lineCount)) * 0.75;
    let finalFontSize = Math.min(Math.max(rawFontSize, 11), 18);

    const div = document.createElement('div');
    div.style = `
        position: absolute;
        top: ${window.scrollY + rect.top + (bbox.y0 * scaleY) - (padding/2)}px;
        left: ${window.scrollX + rect.left + (bbox.x0 * scaleX) - (padding/2)}px;
        width: ${boxWidth}px;
        min-height: ${boxHeight}px;
        height: max-content; 
        background: rgba(255, 255, 255, 0.98); 
        color: #000;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-size: ${finalFontSize}px;
        font-weight: 700;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 4px 6px;
        border-radius: 6px;
        pointer-events: none; 
        line-height: 1.25;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        box-sizing: border-box;
        word-wrap: break-word; 
        overflow: hidden;
    `;
    div.innerText = text;
    document.body.appendChild(div);
    return div;
}

const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting) processImage(e.target); });
}, { threshold: 0.15 });

function scan() {
    document.querySelectorAll('img').forEach(img => {
        if(!img.dataset.observed && img.naturalWidth > 350) {
            img.dataset.observed = "true";
            observer.observe(img);
        }
    });
}
setInterval(scan, 2000);

chrome.runtime.onMessage.addListener((msg) => {
    const img = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
    if (!img) return;

    if (msg.action === "show_original") {
        const overlays = processedImages.get(msg.url);
        if (overlays) {
            overlays.forEach(o => o.remove());
            processedImages.delete(msg.url);
        }
        img.dataset.status = "ready";
    } else if (msg.action === "re_translate") {
        const overlays = processedImages.get(msg.url);
        if (overlays) overlays.forEach(o => o.remove());
        img.dataset.status = "ready";
        processImage(img);
    }
});