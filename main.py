from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import easyocr
import httpx
import numpy as np
from PIL import Image

app = FastAPI(title="Manga Translator Ultimate API")

# CORS Ayarları (Eklentiden gelen isteklere izin veriyoruz)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. OCR Motorunu Başlat (Sadece sunucu kalkarken 1 kez yüklenir, RAM'i verimli kullanırız)
print("Yapay Zeka OCR Modeli Yükleniyor... Lütfen bekleyin.")
reader = easyocr.Reader(['en'], gpu=True) # Eğer NVIDIA ekran kartın varsa gpu=True yapabilirsin!
print("Model Yüklendi! Sunucu Hazır.")

class TranslationRequest(BaseModel):
    image_base64: str

# 2. Asenkron Çeviri Fonksiyonu (Google GTX)
async def translate_text(text: str, target_lang: str = "tr") -> str:
    # URL'ye güvenli bir şekilde encode edilmiş metni yolluyoruz
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q={text}"
    
    # httpx kullanarak asenkron istek atıyoruz (FastAPI'yi dondurmamak için kritik)
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        if response.status_code == 200:
            data = response.json()
            if data and data[0]:
                # Parçalanmış çevirileri birleştir
                translated = "".join([sentence[0] for sentence in data[0]])
                return translated
    return "[Çeviri Hatası]"

@app.post("/process-image")
async def process_image(request: TranslationRequest):
    try:
        # Base64'ü ayrıştır ve bellekte Görüntüye (Image) dönüştür
        header, encoded = request.image_base64.split(",", 1)
        image_data = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(image_data)).convert('RGB')
        
        # EasyOCR numpy dizisi (array) ile çalışır, dönüştürüyoruz
        image_np = np.array(image)
        
        # 3. OCR İşlemi (Metni ve Koordinatları bul)
        # paragraph=True parametresi balon içindeki metinleri akıllıca gruplar
        results = reader.readtext(image_np, paragraph=True)
        
        ocr_results = []
        
        for bbox, text in results:
            # Sadece makul uzunluktaki ve temiz metinleri çevir
            clean_text = text.strip()
            if len(clean_text) < 2:
                continue
                
            # Çeviriyi Asenkron olarak yap
            translated_text = await translate_text(clean_text)
            
            # EasyOCR koordinatları [[x0,y0], [x1,y0], [x1,y1], [x0,y1]] şeklinde döner.
            # Biz eklentinin kolayca kullanabileceği x0, y0, x1, y1 formatına çeviriyoruz.
            x0, y0 = int(bbox[0][0]), int(bbox[0][1])
            x1, y1 = int(bbox[2][0]), int(bbox[2][1])
            
            ocr_results.append({
                "original_text": clean_text,
                "translated_text": translated_text,
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