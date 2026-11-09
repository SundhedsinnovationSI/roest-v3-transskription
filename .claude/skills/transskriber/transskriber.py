"""Transskriberer en lydfil med Røst v3 (wav2vec2). Brug: python transskriber.py <lydfil>"""
import subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MODEL = REPO / "model.safetensors"
MODEL_URL = ("https://github.com/SundhedsinnovationSI/roest-v3-transskription"
             "/releases/download/v1/model.safetensors")

def main(lydfil: str) -> None:
    if not MODEL.exists():
        print("Henter modelfil (631 MB) ...", file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, MODEL)

    # Konverter til 16 kHz mono, som modellen kræver
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", lydfil, "-ac", "1", "-ar", "16000",
         "-f", "f32le", "-"], check=True, capture_output=True).stdout

    import numpy as np, torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor, pipeline

    proc = Wav2Vec2Processor.from_pretrained(REPO)
    model = Wav2Vec2ForCTC.from_pretrained(REPO, dtype=torch.float32).eval()
    asr = pipeline("automatic-speech-recognition", model=model,
                   tokenizer=proc.tokenizer, feature_extractor=proc.feature_extractor,
                   device=-1)
    lyd = np.frombuffer(raw, dtype=np.float32)
    # Optagelsen deles i bidder på 10 sek. med 2 sek. overlap (giver bedst resultat)
    tekst = asr({"raw": lyd, "sampling_rate": 16000},
                chunk_length_s=10, stride_length_s=2)["text"]
    print(tekst)

if __name__ == "__main__":
    main(sys.argv[1])
