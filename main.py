from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import easyocr
import httpx
import numpy as np
from PIL import Image
import asyncio # YENİ EKLENDİ: Eşzamanlı işlemler için

app = FastAPI(title="Manga Translator Ultimate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Yapay Zeka OCR Modeli Yükleniyor... (GPU Destekli)")
reader = easyocr.Reader(['en'], gpu=True) 
print("Model Yüklendi! Sunucu Hazır.")

class TranslationRequest(BaseModel):
    image_base64: str

# Manga Metni Temizleyici: Google Çeviri'nin kafasının karışmasını önler
def clean_manga_text(text: str) -> str:
    # 1. Satır atlamalarını tek boşluğa çevir
    text = text.replace('\n', ' ').strip()
    # 2. Fazla boşlukları temizle
    text = ' '.join(text.split())
    # 3. SADECE BÜYÜK HARFLE YAZILMIŞSA normal cümle düzenine (İlk harf büyük, gerisi küçük) çevir
    if text.isupper():
         text = text.capitalize()
    return text

async def translate_text(client: httpx.AsyncClient, text: str, target_lang: str = "tr") -> str:
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q={text}"
    response = await client.get(url)
    if response.status_code == 200:
        data = response.json()
        if data and data[0]:
            return "".join([sentence[0] for sentence in data[0]])
    return "[Hata]"

@app.post("/process-image")
async def process_image(request: TranslationRequest):
    try:
        header, encoded = request.image_base64.split(",", 1)
        image_data = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(image_data)).convert('RGB')
        image_np = np.array(image)
        
        # PARAMETRE AYARI: paragraph=True kalıyor ama x_ths (yatay birleştirme) ve y_ths (dikey birleştirme)
        # değerlerini düşürerek yan taraftaki efektleri balona dahil etmesini engelliyoruz.
        results = reader.readtext(image_np, paragraph=True, x_ths=0.3, y_ths=0.6)
        
        valid_boxes = []
        translation_tasks = []
        
        # 1. Aşama: Olası balonları topla ve metinleri temizle
        async with httpx.AsyncClient() as client:
            for bbox, text in results:
                clean_text = clean_manga_text(text)
                # İki harften kısa olan veya sadece noktalama işareti olan (efektler) kısımları ele
                if len(clean_text) > 2 and any(c.isalpha() for c in clean_text):
                    valid_boxes.append((bbox, clean_text))
                    # Görev listesine ekle (Henüz çalıştırmıyor, sadece listeliyor)
                    translation_tasks.append(translate_text(client, clean_text))
            
            # 2. Aşama: BÜTÜN ÇEVİRİLERİ AYNI ANDA YAP (İşte hızı uçuracak olan büyü bu!)
            translated_texts = await asyncio.gather(*translation_tasks)
        
        ocr_results = []
        for i, (bbox, original_text) in enumerate(valid_boxes):
            x0, y0 = int(bbox[0][0]), int(bbox[0][1])
            x1, y1 = int(bbox[2][0]), int(bbox[2][1])
            
            ocr_results.append({
                "original_text": original_text,
                "translated_text": translated_texts[i],
                "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
            })
            
        return {
            "status": "success",
            "detected_balloons": len(ocr_results),
            "ocr_results": ocr_results
        }
        
    except Exception as e:
        print(f"Hata detayı: {str(e)}")
        raise HTTPException(status_code=500, detail="Görsel işlenirken sunucu hatası oluştu.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)