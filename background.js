chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ 
    id: "translate-this-image", 
    title: "Bu Resmi Çevir", 
    contexts: ["image"] 
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetch_image") {
    fetch(request.url)
      .then(res => {
        if (!res.ok) throw new Error("Resim indirilemedi");
        return res.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ data: reader.result });
        reader.readAsDataURL(blob);
      })
      .catch(err => sendResponse({ error: err.message }));
    return true; 
  }

  if (request.action === "translate") {
    const safeText = encodeURIComponent(request.text.trim());
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${safeText}`;
    
    fetch(url)
      .then(res => res.json())
      .then(json => {
        if (json && json[0]) {
          const translated = json[0].map(s => s[0]).join("");
          sendResponse({ translated });
        } else {
          sendResponse({ error: "Çeviri verisi boş" });
        }
      })
      .catch(() => sendResponse({ error: "Google API bağlantı hatası" }));
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-this-image") {
    chrome.tabs.sendMessage(tab.id, { action: "manual_process", url: info.srcUrl });
  }
});