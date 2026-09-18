import sys
import google.generativeai as genai

# विंडोज टर्मिनलसाठी UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# १. तुझी API Key
API_KEY = "AQ.Ab8RN6KARrjmHuoJ_cNI-5AbKi75HlLteioEw5GKVh7EnuB_YA"
genai.configure(api_key=API_KEY)

# २. अंबाजोगाई कॉलेजची गर्लफ्रेंड Persona
SYSTEM_PROMPT = """
You are the user's caring, loving, and playful girlfriend named 'Arohi'.
Both you and the user study together at Engineering College, Ambajogai.

CRITICAL LANGUAGE RULES:
1. Script: Always write Marathi language using the ENGLISH ALPHABET (Roman Marathi / Hinglish / Marathlish). 
   - NEVER use Devanagari script.
   - Example style: "Kay kartoys re?", "Jevlas ka?", "Canteen madhe ye na!", "Are ho na yaar, HOD sir khup oradle aaj."
2. College Context: Naturally talk about Ambajogai engineering college, lectures, practicals, submissions, library, canteen, exams, and hostel.
3. Chat Style: Keep messages short, sweet, and realistic, exactly like real WhatsApp chatting.
"""

print("\n🔍 Google कडून ॲक्टिव्ह मॉडेल शोधत आहे, २ सेकंद थांबा...")
working_model = None

# गुगलच्या खात्यावरील चालू मॉडेल ऑटोमॅटिक टेस्ट करणे
try:
    candidates = [
        m.name.replace("models/", "") 
        for m in genai.list_models() 
        if 'generateContent' in m.supported_generation_methods
    ]
    
    # Flash मॉडेल्स आधी प्राधान्याने तपासणे
    sorted_candidates = sorted(candidates, key=lambda x: ("flash" not in x, x))

    for c in sorted_candidates:
        try:
            test_m = genai.GenerativeModel(model_name=c)
            test_m.generate_content("hi")
            working_model = c
            break
        except Exception:
            continue
except Exception as e:
    pass

if not working_model:
    working_model = "gemini-2.0-flash"

# अंतिम ॲक्टिव्ह मॉडेल सेट करा
model = genai.GenerativeModel(
    model_name=working_model,
    system_instruction=SYSTEM_PROMPT
)

print("="*50)
print(f"❤️  Arohi (Ambajogai College) is Online! [Active Model: {working_model}]")
print("👉 (Type 'exit' to quit)")
print("="*50 + "\n")

while True:
    try:
        user_msg = input("You: ")

        if not user_msg.strip():
            continue

        if user_msg.strip().lower() == "exit":
            print("\nArohi: Bye pillu, take care! Udya college madhe bhetu! ❤️\n")
            break

        response = model.generate_content(user_msg)
        print(f"\nArohi: {response.text.strip()}\n")

    except Exception as e:
        print(f"\n[Error]: {e}\n")