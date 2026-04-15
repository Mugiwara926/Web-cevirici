let currentOverlays = []; // Ekrandaki eski çevirileri silmek için tutuyoruz

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "show_loading") {
        console.log("Manga Translator: Ekran yakalandı, çeviri başlatıldı...");
        // İstersen buraya ekranın köşesinde belirecek bir "Çevriliyor..." UI'ı ekleyebilirsin.
    }

    if (msg.action === "draw_translations") {
        const result = msg.data;
        
        // Önceki çeviri kutularını temizle
        currentOverlays.forEach(overlay => overlay.remove());
        currentOverlays = [];

        if (result.status === "success" && result.ocr_results) {
            result.ocr_results.forEach(item => {
                const overlay = placeViewportOverlay(item.bbox, item.translated_text);
                currentOverlays.push(overlay);
            });
            console.log(`Manga Translator: ${result.detected_balloons} balon başarıyla çevrildi.`);
        }
    }
});

function placeViewportOverlay(bbox, text) {
    const boxWidth = bbox.x1 - bbox.x0;
    const boxHeight = bbox.y1 - bbox.y0;

    // Viewport Matematiği: Koordinatlara sayfanın scroll miktarını ekliyoruz
    const absoluteLeft = bbox.x0 + window.scrollX;
    const absoluteTop = bbox.y0 + window.scrollY;

    const div = document.createElement('div');
    div.className = 'manga-translator-overlay';
    div.style = `
        position: absolute;
        left: ${absoluteLeft}px;
        top: ${absoluteTop}px;
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
        padding: 4px;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow: hidden;
        border-radius: 6px;
        box-shadow: 0px 2px 5px rgba(0,0,0,0.3);
    `;
    
    const span = document.createElement('span');
    span.innerText = text;
    div.appendChild(span);
    document.body.appendChild(div);

    // Fontu kutuya otomatik sığdırma
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