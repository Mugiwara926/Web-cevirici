chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "manga-original", title: "Orijinali Göster", contexts: ["image"] });
  chrome.contextMenus.create({ id: "manga-re_translate", title: "Tekrar Çevir", contexts: ["image"] });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetch_image") {
    fetch(request.url).then(res => res.blob()).then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ data: reader.result });
        reader.readAsDataURL(blob);
    }).catch(() => sendResponse({ error: "Fetch Failed" }));
    return true; 
  }

  if (request.action === "translate") {
    const safeText = encodeURIComponent(request.text.trim());
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${safeText}`;
    
    fetch(url).then(res => res.json()).then(json => {
        if (json && json[0]) {
            // join("") kullanıyoruz çünkü Google boşlukları genelde kendi ayarlar. Çift boşlukları önler.
            const translated = json[0].map(s => s[0]).join("");
            sendResponse({ translated });
        } else {
            sendResponse({ error: "Empty Data" });
        }
    }).catch(() => sendResponse({ error: "API Error" }));
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "manga-original") {
    chrome.tabs.sendMessage(tab.id, { action: "show_original", url: info.srcUrl });
  } else if (info.menuItemId === "manga-re_translate") {
    chrome.tabs.sendMessage(tab.id, { action: "re_translate", url: info.srcUrl });
  }
});