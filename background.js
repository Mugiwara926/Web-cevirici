// Klavye kısayolu dinleyicisi (Alt+Q)
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "translate-screen") {
        // Aktif sekmeyi bul
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        // Sayfaya yükleniyor bilgisini gönder
        chrome.tabs.sendMessage(tab.id, { action: "show_loading" });

        try {
            // Tarayıcı API'si ile sitenin ruhu duymadan ekranın fotoğrafını (Base64) çek
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

            // Resmi Python sunucumuza gönder
            const response = await fetch("http://127.0.0.1:8000/process-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_base64: dataUrl })
            });

            if (!response.ok) throw new Error("API Hatası: " + response.status);
            const result = await response.json();

            // Gelen çevirileri ve koordinatları ekrana çizmesi için content.js'e yolla
            chrome.tabs.sendMessage(tab.id, { action: "draw_translations", data: result });

        } catch (error) {
            console.error("Çeviri Hatası:", error);
            chrome.tabs.sendMessage(tab.id, { action: "hide_loading", error: error.message });
        }
    }
});