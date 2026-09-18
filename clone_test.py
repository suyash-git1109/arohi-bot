import os
import torch
from TTS.api import TTS

def test_voice_clone():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    # Coqui XTTS v2 मॉडेल लोड करणे
    print("Loading TTS model...")
    tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    # व्हॉईस सॅम्पल फाईल
    speaker_wav = "my_girl_voice.wav"
    if not os.path.exists(speaker_wav):
        speaker_wav = "final_girl_voice.wav"

    text = "Hii babu, kuth ahes re tu? Me tuji vat baghtiye... jevlas ka?"

    output_path = "cloned_arohi_output.wav"
    print(f"Generating cloned voice using {speaker_wav}...")

    tts.tts_to_file(
        text=text,
        speaker_wav=speaker_wav,
        language="mr",
        file_path=output_path
    )

    print(f"Voice cloned successfully! Saved at: {output_path}")

if __name__ == "__main__":
    test_voice_clone()