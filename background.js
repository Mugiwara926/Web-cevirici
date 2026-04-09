// Sağ tık menüsünü oluştur
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ 
    id: "manga-original", 
    title: "Orijinali Göster (Çeviriyi Gizle)", 
    contexts: ["image"] 
  });
  chrome.contextMenus.create({ 
    id: "manga-retranslate", 
    title: "Bu Resmi Tekrar Çevir", 
    contexts: ["image"] 
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Resim İndirme (CORS Aşma)
  if (request.action === "fetch_image") {
    fetch(request.url)
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ data: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch(() => sendResponse({ error: "Fetch Failed" }));
    return true; // Asenkron cevap için şart
  }

  // 2. Metin Çevirme
  if (request.action === "translate") {
    // Özel karakterlerin API'yi bozmaması için güvenli şifreleme
    const safeText = encodeURIComponent(request.text.trim());
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${safeText}`;
    
    fetch(url)
      .then(res => res.json())
      .then(json => {
        if (json && json[0]) {
            // Parçalı çevirileri tek bir metinde birleştir
            const translated = json[0].map(s => s[0]).join(" ");
            sendResponse({ translated });
        } else {
            sendResponse({ error: "Empty Data" });
        }
      })
      .catch(() => sendResponse({ error: "API Error" }));
    return true;
  }
});

// Sağ Tık Tıklamalarını content.js'e ilet
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "manga-original") {
    chrome.tabs.sendMessage(tab.id, { action: "show_original", url: info.srcUrl });
  } else if (info.menuItemId === "manga-retranslate") {
    chrome.tabs.sendMessage(tab.id, { action: "re_translate", url: info.srcUrl });
  }
});