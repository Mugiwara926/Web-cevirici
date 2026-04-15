document.getElementById('start-ocr').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.innerText = "Sayfaya emir gönderiliyor...";

    // Aktif sekmeyi bul
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
        // Sayfadaki content.js'e emir gönder
        chrome.tabs.sendMessage(tab.id, { action: "process_main_image" }, (response) => {
            if (chrome.runtime.lastError) {
                status.innerText = "Bağlantı kurulamadı. Sayfayı yenileyin.";
            } else if (response && response.status === "started") {
                status.innerText = "Çeviri işlemi sayfada başladı!";
            } else if (response && response.status === "no_image") {
                status.innerText = "Sayfada uygun resim bulunamadı.";
            }
        });
    }
});