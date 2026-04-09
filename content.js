let worker = null;
const processedImages = new Map();

async function getWorker() {
    if (worker) return worker;
    
    worker = await Tesseract.createWorker(['eng', 'tur'], 1, {
        workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
        // KRİTİK ÇÖZÜM 1: Senin dosyalarında .gz uzantısı olmadığı için bu ayar şart. 
        // "Failed to fetch" hatasını tamamen bitirir.
        gzip: false 
    });
    
    await worker.setParameters({
        tessedit_pageseg_mode: '12', 
        user_defined_dpi: '300'
    });
    return worker;
}

// KRİTİK ÇÖZÜM 2: CORS (Tainted Canvas) hatasını engellemek için, 
// sayfadaki resim etiketini değil, arka plandan indirdiğimiz base64 verisini kullanıyoruz.
function preprocessImage(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // Kontrast artırımı: Yazıların arka plandan net ayrılmasını sağlar
            ctx.filter = 'contrast(1.3) grayscale(100%)'; 
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

// Akıllı ve Stabil Gruplama
function getSmartBalloons(lines) {
    if (!lines || lines.length === 0) return [];
    
    // Gürültüyü engelle (Güven eşiği 35)
    const validLines = lines.filter(l => l.confidence > 35 && l.text.trim().length > 1);
    const groups = [];

    validLines.forEach(line => {
        let merged = false;
        const lineHeight = line.bbox.y1 - line.bbox.y0;

        for (let g of groups) {
            const verticalDist = Math.abs(line.bbox.y0 - g.bbox.y1);
            const horizontalDist = Math.max(0, Math.max(line.bbox.x0 - g.bbox.x1, g.bbox.x0 - line.bbox.x1));
            
            // Devasa kutuları engellemek için mesafeler ideal seviyede tutuldu
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

async function processImage(img) {
    // 300px'den küçük ikonları veya işlenmiş resimleri atla
    if (img.dataset.status === "done" || img.dataset.status === "loading" || img.naturalWidth < 300) return;

    img.dataset.status = "loading";

    chrome.runtime.sendMessage({ action: "fetch_image", url: img.src }, async (res) => {
        if (!res || res.error) { img.dataset.status = "ready"; return; }

        try {
            const w = await getWorker();
            
            // İşlemi sorunsuz base64 verisi üzerinden yap
            const processedSrc = await preprocessImage(res.data);
            const { data } = await w.recognize(processedSrc);
            
            const balloons = getSmartBalloons(data.lines || []);
            const overlays = [];

            for (const b of balloons) {
                // Sadece okunabilir karakterleri bırak
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
            console.error("Çeviri Hatası:", e);
            img.dataset.status = "ready";
        }
    });
}

function placeOverlay(img, bbox, text, lineCount) {
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    const padding = 12; 
    const boxWidth = ((bbox.x1 - bbox.x0) * scaleX) + padding;
    const boxHeight = ((bbox.y1 - bbox.y0) * scaleY) + padding;

    // Font boyutunu ideal oranlara sabitledik
    let rawFontSize = (boxHeight / Math.max(1, lineCount)) * 0.70;
    let finalFontSize = Math.min(Math.max(rawFontSize, 12), 18);

    const div = document.createElement('div');
    div.style = `
        position: absolute;
        top: ${window.scrollY + rect.top + (bbox.y0 * scaleY) - (padding/2)}px;
        left: ${window.scrollX + rect.left + (bbox.x0 * scaleX) - (padding/2)}px;
        width: ${boxWidth}px;
        min-height: ${boxHeight}px;
        height: max-content; 
        background: rgba(255, 255, 255, 0.98); 
        color: #111;
        font-family: 'Segoe UI', Tahoma, sans-serif;
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
        box-shadow: 0 4px 8px rgba(0,0,0,0.25);
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

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "show_original") {
        const overlays = processedImages.get(msg.url);
        if (overlays) {
            overlays.forEach(o => o.remove());
            processedImages.delete(msg.url);
        }
        const img = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (img) img.dataset.status = "ready";
    } else if (msg.action === "re_translate") {
        const overlays = processedImages.get(msg.url);
        if (overlays) overlays.forEach(o => o.remove());
        const img = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (img) {
            img.dataset.status = "ready";
            processImage(img);
        }
    }
});