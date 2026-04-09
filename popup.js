document.getElementById('start-ocr').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.innerText = "Yükleniyor...";

    // Tesseract işçisini (worker) oluşturuyoruz
    const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
        logger: m => console.log(m)
    });

    status.innerText = "Resim taranıyor...";

    // Örnek: Sayfadaki ilk resmi yakalayıp tarama simülasyonu
    // Gerçek projede burada content.js'den gelen resim verisi kullanılacak
    const imageUrl = "ornek_resim_yolu.jpg"; 

    try {
        const { data: { text } } = await worker.recognize(imageUrl);
        status.innerText = "Bulunan Metin: " + text;
        console.log("OCR Sonucu:", text);
    } catch (err) {
        status.innerText = "Hata oluştu!";
        console.error(err);
    }

    await worker.terminate();
});