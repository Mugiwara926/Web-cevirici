chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ 
    id: "translate-this-image", 
    title: "Bu Resmi Çevir", 
    contexts: ["image"] 
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-this-image") {
    chrome.tabs.sendMessage(tab.id, { action: "manual_process", url: info.srcUrl });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Python sunucusuna güvenli arka plan bağlantısı
  if (request.action === "process_with_api") {
    fetch("http://127.0.0.1:8000/process-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: request.base64_data })
    })
    .then(res => {
        if (!res.ok) throw new Error("API Hatası: " + res.status);
        return res.json();
    })
    .then(data => sendResponse(data))
    .catch(err => sendResponse({ error: err.message }));
    
    return true; // Asenkron yanıt için kritik
  }
});