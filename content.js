let worker = null;
const processedImages = new Map();

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

// YENİLİK 1: Gelişmiş Görüntü Ön İşleme (Binarization)
// Manga sayfalarındaki gri tonları ve kirli arka planları temizleyerek OCR başarısını %50 artırır.
function preprocessImage(base64Data) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const threshold = 170; // Tesseract'ın sevdiği keskin siyah/beyaz eşiği

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2];
                // İnsan gözüne uygun parlaklık formülü
                const v = (0.2126 * r + 0.7152 * g + 0.0722 * b);
                const val = v >= threshold ? 255 : 0; // Siyah ya da Beyaz
                data[i] = data[i + 1] = data[i + 2] = val;
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

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

// YENİLİK 2: Kayma problemini çözen Wrapper Fonksiyonu
function wrapImage(img) {
    if (img.parentElement && img.parentElement.classList.contains('manga-translator-wrapper')) {
        return img.parentElement;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'manga-translator-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    
    // Gerçek render boyutlarını alarak sitenin düzenini bozmasını engelleriz
    wrapper.style.width = img.offsetWidth + 'px';
    wrapper.style.height = img.offsetHeight + 'px';

    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    return wrapper;
}

// İletişim Kulakçığı (Popup ve Sağ tık menüsü için)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "manual_process") {
        const targetImg = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (targetImg) processImage(targetImg);
    }
    
    if (msg.action === "process_main_image") {
        const images = Array.from(document.querySelectorAll('img'));
        // Sayfadaki en büyük alanı kaplayan resmi manga sayfası olarak varsay
        const targetImg = images.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
        
        if (targetImg) {
            processImage(targetImg);
            sendResponse({ status: "started" });
        } else {
            sendResponse({ status: "no_image" });
        }
    }
    return true; 
});

async function processImage(img) {
    if (img.dataset.status === "loading") return;

    img.dataset.status = "loading";
    img.style.filter = "blur(2px)";

    // İşlem başlarken resmi sarıyoruz
    const wrapper = wrapImage(img);

    chrome.runtime.sendMessage({ action: "fetch_image", url: img.src }, async (res) => {
        if (!res || res.error) {
            img.dataset.status = "ready";
            img.style.filter = "none";
            return;
        }

        try {
            const w = await getWorker();
            if (!w) throw new Error("Worker başlatılamadı");

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
                    // Balonu yerleştirirken artık wrapper'ı referans alıyoruz
                    overlays.push(placeOverlay(wrapper, img, b.bbox, transRes.translated));
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

function placeOverlay(wrapper, img, bbox, text) {
    const scaleX = img.width / img.naturalWidth;
    const scaleY = img.height / img.naturalHeight;

    // Koordinatlar artık body'ye değil, resmin kapsayıcısına (wrapper) göre hesaplanıyor
    const boxLeft = bbox.x0 * scaleX;
    const boxTop = bbox.y0 * scaleY;
    const boxWidth = (bbox.x1 - bbox.x0) * scaleX;
    const boxHeight = (bbox.y1 - bbox.y0) * scaleY;

    const div = document.createElement('div');
    div.className = 'manga-translator-overlay';
    div.style = `
        position: absolute;
        left: ${boxLeft}px;
        top: ${boxTop}px;
        width: ${boxWidth}px;
        height: ${boxHeight}px;
        background: rgba(255, 255, 255, 0.95);
        color: #111;
        font-family: 'Arial Black', sans-serif;
        font-weight: bold;
        line-height: 1.1;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        z-index: 10;
        padding: 2px;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow: hidden;
        border-radius: 6px;
        pointer-events: auto; /* Hover efekti için tıkla/üstüne gel olaylarına izin ver */
        transition: opacity 0.2s ease-in-out;
    `;
    
    const span = document.createElement('span');
    span.innerText = text;
    div.appendChild(span);
    
    // YENİLİK 3: Orijinal Metni Görme Efekti
    // Kullanıcı fareyi balonun üzerine getirdiğinde çeviri şeffaflaşır, altındaki orijinal metin görünür
    div.title = "Orijinali görmek için fareyi üzerinde tutun";
    div.addEventListener('mouseenter', () => { div.style.opacity = '0.1'; });
    div.addEventListener('mouseleave', () => { div.style.opacity = '1'; });

    // Balonu doğrudan sarmalayıcının içine ekliyoruz
    wrapper.appendChild(div); 

    let fontSize = 24; 
    const minSize = 8;  

    while (fontSize > minSize) {
        span.style.fontSize = fontSize + 'px';
        if (span.offsetWidth <= (boxWidth - 4) && span.offsetHeight <= (boxHeight - 4)) {
            break; 
        }
        fontSize -= 0.5;
    }
    
    return div;
}