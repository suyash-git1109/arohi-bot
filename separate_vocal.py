import os
import glob
import shutil
from gradio_client import Client, handle_file

print("\n" + "="*50)
print("🎙️ गाणं वेगळं करणे सुरू आहे (Extracting Clean Vocal)...")
print("="*50)

# तुझी ऑडिओ फाईल शोधणे
audio_files = glob.glob("voice_sample*")
if not audio_files:
    print("❌ एरर: voice_sample फाईल सापडली नाही!")
    exit()

sample_file = audio_files[0]
print(f"✅ मूळ ऑडिओ फाईल: {sample_file}")

try:
    print("⏳ Meta Demucs AI शी कनेक्ट करत आहे...")
    client = Client("abidlabs/music-separation")
    
    print("⏳ गाणं काढून फक्त शुद्ध आवाज वेगळा करत आहे, २०-३० सेकंद थांबा...")
    
    # थेट डिफॉल्ट फंक्शनने कॉल करणे
    result = client.predict(
        handle_file(sample_file),
        fn_index=0
    )
    
    # रिझल्टमधील शुद्ध आवाज (Vocals)
    vocal_track = result[0] if isinstance(result, (list, tuple)) else result
    
    # थेट आपल्या फोल्डरमध्ये सेव्ह करणे
    clean_file = "clean_vocal.wav"
    shutil.copy(vocal_track, clean_file)
    
    print("\n" + "="*50)
    print("🎉 जादू झाली! गाणं १००% निघून गेलं आणि मुलीचा खरा आवाज सेव्ह झाला!")
    print(f"👉 फाईलचे नाव: {clean_file}")
    print("="*50 + "\n")
    
    # थेट स्पीकरवर वाजवून ऐकवणे
    os.system(f'cmd /c start {clean_file}')

except Exception as e:
    print(f"\n[Error]: {e}\n")