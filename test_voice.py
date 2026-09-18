import asyncio
import edge_tts
import os

# १. आरोहीचा संवाद
text = "Hii re, me aataach canteen madhe aale... tu kuthe ahes? Lavkar ye na, sobat chaha piu!"

# २. सर्वात नॅचरल मराठी आवाज (Aarohi)
VOICE = "mr-IN-AarohiNeural"
OUTPUT_FILE = "arohi_voice.mp3"

async def generate():
    print("🎙️ आरोहीचा आवाज तयार होत आहे...")
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(OUTPUT_FILE)
    print(f"✅ आवाज तयार झाला! फाईल: {OUTPUT_FILE}")
    
    # विंडोजवर आपोआप ऑडिओ प्ले करा
    os.system(f"start {OUTPUT_FILE}")

asyncio.run(generate())