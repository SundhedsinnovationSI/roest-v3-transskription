"""Transskription med angivelse af talere (Røst v3 + sherpa-onnx).
Brug: python talere.py <lydfil> <antal talere>   (antal 0 = gæt selv)"""
import subprocess, sys, tarfile, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MAPPE = REPO / "talermodeller"
GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
SEG_URL = GH + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL = GH + "speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
ROEST_URL = ("https://github.com/SundhedsinnovationSI/roest-v3-transskription"
             "/releases/download/v1/model.safetensors")
SEG = MAPPE / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
EMB = MAPPE / "3dspeaker.onnx"
SR = 16000

def hent_modeller() -> None:
    MAPPE.mkdir(exist_ok=True)
    if not (REPO / "model.safetensors").exists():
        print("Henter Røst-model (631 MB) ...", file=sys.stderr)
        urllib.request.urlretrieve(ROEST_URL, REPO / "model.safetensors")
    if not SEG.exists():
        arkiv = MAPPE / "seg.tar.bz2"
        urllib.request.urlretrieve(SEG_URL, arkiv)
        with tarfile.open(arkiv) as t:
            t.extractall(MAPPE, filter="data")
        arkiv.unlink()
    if not EMB.exists():
        urllib.request.urlretrieve(EMB_URL, EMB)

def tid(sek: float) -> str:
    t, s = divmod(int(sek), 60)
    return f"{t // 60:02d}:{t % 60:02d}:{s:02d}"

def main(lydfil: str, antal: int) -> None:
    hent_modeller()
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", lydfil, "-ac", "1",
                          "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    import numpy as np, sherpa_onnx, torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor, pipeline
    lyd = np.frombuffer(raw, dtype=np.float32)

    # 1. Hvem taler hvornår
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(SEG))),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(EMB)),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=antal if antal > 0 else -1, threshold=0.9),
        min_duration_on=0.3, min_duration_off=0.5)
    segmenter = sherpa_onnx.OfflineSpeakerDiarization(cfg).process(lyd).sort_by_start_time()

    # Slå på hinanden følgende stykker fra samme taler sammen
    blokke = []
    for s in segmenter:
        if blokke and blokke[-1][2] == s.speaker and s.start - blokke[-1][1] < 3.0:
            blokke[-1][1] = s.end
        else:
            blokke.append([s.start, s.end, s.speaker])

    # 2. Transskriber hver blok med Røst v3
    proc = Wav2Vec2Processor.from_pretrained(REPO)
    model = Wav2Vec2ForCTC.from_pretrained(REPO, dtype=torch.float32).eval()
    asr = pipeline("automatic-speech-recognition", model=model, tokenizer=proc.tokenizer,
                   feature_extractor=proc.feature_extractor, device=-1)
    numre = {}
    for start, slut, taler in blokke:
        bid = lyd[int(start * SR):int(slut * SR)]
        if len(bid) < SR // 2:
            continue
        tekst = asr({"raw": bid, "sampling_rate": SR},
                    chunk_length_s=10, stride_length_s=2)["text"].strip()
        if tekst:
            nr = numre.setdefault(taler, len(numre) + 1)
            print(f"[{tid(start)}] Taler {nr}: {tekst}", flush=True)

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0)
