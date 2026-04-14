const processedImages = new Map();

// Manuel İşleme Tetikleyicisi
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

    // 1. Resmi Base64 olarak background.js üzerinden al
    chrome.runtime.sendMessage({ action: "fetch_image", url: img.src }, async (res) => {
        if (!res || res.error || !res.data) {
            console.error("Resim alınamadı:", res?.error);
            img.dataset.status = "ready";
            img.style.filter = "none";
            return;
        }

        try {
            // 2. Base64 verisini DOĞRUDAN FastAPI sunucumuza yolla!
            const response = await fetch("http://127.0.0.1:8000/process-image", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ image_base64: res.data })
            });

            if (!response.ok) throw new Error("Sunucu hatası: " + response.status);
            
            const result = await response.json();
            const overlays = [];

            // 3. Sunucudan gelen temiz koordinatları ve çeviriyi ekrana bas
            if (result.status === "success" && result.ocr_results) {
                for (const item of result.ocr_results) {
                    // placeOverlay senin eski yazdığın kusursuz kutu çizme fonksiyonu
                    const overlay = placeOverlay(img, item.bbox, item.translated_text);
                    overlays.push(overlay);
                }
            }
            
            processedImages.set(img.src, overlays);
            img.dataset.status = "done";
        } catch (e) {
            console.error("Backend bağlantı hatası:", e);
            img.dataset.status = "ready";
        } finally {
            img.style.filter = "none";
        }
    });
}

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