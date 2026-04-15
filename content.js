const processedImages = new Map();

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "manual_process") {
        const targetImg = Array.from(document.querySelectorAll('img')).find(i => i.src === msg.url);
        if (targetImg) {
            processImage(targetImg);
        }
    }
});

// RESMİ YENİDEN İNDİRMEDEN BASE64'E ÇEVİREN FONKSİYON (Cloudflare Atlatıcı)
function getBase64Image(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
}

async function processImage(img) {
    if (img.dataset.status === "loading") return;

    img.dataset.status = "loading";
    img.style.filter = "blur(2px)"; 

    try {
        // 1. Resmi ekrandan sessizce kopyala (Ağ isteği yok!)
        const base64Data = getBase64Image(img);

        // 2. Base64 verisini güvenli background.js'e yolla
        const result = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
                action: "process_with_api", 
                base64_data: base64Data 
            }, resolve);
        });

        if (result.error) throw new Error(result.error);

        // 3. Gelen veriyi çiz
        const overlays = [];
        if (result.status === "success" && result.ocr_results) {
            for (const item of result.ocr_results) {
                const overlay = placeOverlay(img, item.bbox, item.translated_text);
                overlays.push(overlay);
            }
        }
        
        processedImages.set(img.src, overlays);
        img.dataset.status = "done";

    } catch (e) {
        console.error("Çeviri hatası:", e);
        img.dataset.status = "ready";
    } finally {
        img.style.filter = "none";
    }
}

// ... BURANIN ALTINA KENDİ placeOverlay FONKSİYONUNU EKLE ...

// Orijinal Overlay (Kutu Çizme) Fonksiyonun (Hiç dokunmadık, harika çalışıyordu)
function placeOverlay(img, bbox, text) {
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

    const boxLeft = rect.left + window.pageXOffset + (bbox.x0 * scaleX);
    const boxTop = rect.top + window.pageYOffset + (bbox.y0 * scaleY);
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
        color: #000;
        font-family: 'Arial Black', sans-serif;
        font-weight: bold;
        line-height: 1.1;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        z-index: 2147483647;
        padding: 2px;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow: hidden;
        border-radius: 4px;
        pointer-events: none;
    `;
    
    const span = document.createElement('span');
    span.innerText = text;
    div.appendChild(span);
    document.body.appendChild(div);

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