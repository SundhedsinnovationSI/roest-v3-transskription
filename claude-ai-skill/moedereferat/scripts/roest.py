"""Røst v3 (wav2vec2, CoRal-projektet) kørt med ren numpy – uden PyTorch.
Kræver: pip install numpy sherpa-onnx av
Brug:  python roest.py <lydfil>                  -> ren transskription
       python roest.py <lydfil> --talere <antal> -> transskription med talere
Modeller hentes første gang til /tmp/roest (kan ændres med ROEST_CACHE).
Modellen er omfattet af licensen i github.com/SundhedsinnovationSI/roest-v3-transskription
(OpenRAIL-M): maskingenereret tekst skal mærkes som maskingenereret."""
import json, os, struct, subprocess, sys, tarfile, urllib.request
from pathlib import Path
# Én tråd pr. proces; i stedet regnes flere lydbidder parallelt (hurtigere)
for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[_v] = "1"
import multiprocessing as mp
import numpy as np

CACHE = Path(os.environ.get("ROEST_CACHE", "/tmp/roest"))
ROEST = ("https://github.com/SundhedsinnovationSI/roest-v3-transskription"
         "/releases/download/v1/model.safetensors")
GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
SEG_URL = GH + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL = GH + "speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
SR = 16000
# Ordforråd fra modellens vocab.json (indeks 0-41); 36 = ordskifte, 42-45 = specialtegn
VOCAB = list("0123456789abcdefghijklmnopqrstuvwxyz") + ["|", "å", "æ", "é", "ø", "ü"]
PAD = 45

def hent(url, sti):
    if not sti.exists():
        print(f"Henter {sti.name} ...", file=sys.stderr, flush=True)
        tmp = sti.with_suffix(".del")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(sti)
    return sti

# ---------- indlæsning af lyd ----------
def laes_lyd(fil):
    try:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", fil, "-ac", "1",
                              "-ar", str(SR), "-f", "f32le", "-"],
                             check=True, capture_output=True).stdout
        return np.frombuffer(raw, dtype=np.float32).copy()
    except FileNotFoundError:  # intet ffmpeg: brug PyAV (pip install av)
        import av
        c = av.open(fil)
        rs = av.AudioResampler(format="flt", layout="mono", rate=SR)
        dele = [f.to_ndarray().ravel() for fr in c.decode(audio=0) for f in rs.resample(fr)]
        dele += [f.to_ndarray().ravel() for f in rs.resample(None)]
        return np.concatenate(dele).astype(np.float32)

# ---------- model ----------
def laes_vaegte(sti):
    with open(sti, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        hoved = json.loads(f.read(n))
        data = f.read()
    W = {}
    for k, v in hoved.items():
        if k == "__metadata__":
            continue
        a, b = v["data_offsets"]
        bf16 = np.frombuffer(data[a:b], dtype=np.uint16)
        W[k] = (bf16.astype(np.uint32) << 16).view(np.float32).reshape(v["shape"])
    return W

def gelu(x):
    """Eksakt GELU, x * Phi(x). Phi via Abramowitz & Stegun 7.1.26 (fejl < 1.5e-7)."""
    f32 = np.float32
    z = np.abs(x) * f32(0.70710678)
    t = f32(0.3275911) * z; t += 1; np.reciprocal(t, out=t)
    p = f32(1.061405429) * t; p += f32(-1.453152027); p *= t; p += f32(1.421413741); p *= t
    p += f32(-0.284496736); p *= t; p += f32(0.254829592); p *= t
    np.square(z, out=z); np.negative(z, out=z); np.exp(z, out=z); p *= z
    p *= f32(0.5)                      # p = 1 - Phi(|x|)
    return x * np.where(x >= 0, 1 - p, p)

def ln(x, w, b, eps=1e-5):
    m = x.mean(-1, keepdims=True)
    v = ((x - m) ** 2).mean(-1, keepdims=True)
    return (x - m) / np.sqrt(v + eps) * w + b

class Roest:
    def __init__(self, sti):
        self.W = laes_vaegte(sti)
        g = self.W.pop("wav2vec2.encoder.pos_conv_embed.conv.parametrizations.weight.original0")
        v = self.W.pop("wav2vec2.encoder.pos_conv_embed.conv.parametrizations.weight.original1")
        self.pos_w = (g * v / np.sqrt((v ** 2).sum(axis=(0, 1), keepdims=True))).astype(np.float32)

    def logits(self, x):
        W = self.W; p = "wav2vec2."
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        h = x[:, None]                                   # [T, C=1]
        for i, (k, s) in enumerate(zip([10, 3, 3, 3, 3, 2, 2], [5, 2, 2, 2, 2, 2, 2])):
            q = f"{p}feature_extractor.conv_layers.{i}."
            w = W[q + "conv.weight"]                       # [out, in, k]
            fr = np.lib.stride_tricks.sliding_window_view(h, k, axis=0)[::s]   # [T', in, k]
            h = fr.reshape(fr.shape[0], -1) @ w.reshape(w.shape[0], -1).T + W[q + "conv.bias"]
            h = gelu(ln(h, W[q + "layer_norm.weight"], W[q + "layer_norm.bias"]))
        h = ln(h, W[p + "feature_projection.layer_norm.weight"], W[p + "feature_projection.layer_norm.bias"])
        h = h @ W[p + "feature_projection.projection.weight"].T + W[p + "feature_projection.projection.bias"]
        # positionel konvolution (128 bred, 16 grupper)
        T = h.shape[0]
        hp = np.pad(h, ((64, 64), (0, 0)))
        pos = np.empty((T, 1024), np.float32)
        for gi in range(16):
            sl = slice(gi * 64, (gi + 1) * 64)
            fr = np.lib.stride_tricks.sliding_window_view(hp[:, sl], 128, axis=0)[:T]  # [T,64,128]
            pos[:, sl] = fr.reshape(T, -1) @ self.pos_w[sl].reshape(64, -1).T
        h = h + gelu(pos + W[p + "encoder.pos_conv_embed.conv.bias"])
        for i in range(24):
            q = f"{p}encoder.layers.{i}."
            r = h
            a = ln(h, W[q + "layer_norm.weight"], W[q + "layer_norm.bias"])
            Q = (a @ W[q + "attention.q_proj.weight"].T + W[q + "attention.q_proj.bias"]) * 0.125
            K = a @ W[q + "attention.k_proj.weight"].T + W[q + "attention.k_proj.bias"]
            V = a @ W[q + "attention.v_proj.weight"].T + W[q + "attention.v_proj.bias"]
            Q, K, V = (m.reshape(T, 16, 64).transpose(1, 0, 2) for m in (Q, K, V))
            s = Q @ K.transpose(0, 2, 1)
            s -= s.max(-1, keepdims=True); np.exp(s, out=s); s *= 1 / s.sum(-1, keepdims=True)
            o = (s @ V).transpose(1, 0, 2).reshape(T, 1024)
            h = r + o @ W[q + "attention.out_proj.weight"].T + W[q + "attention.out_proj.bias"]
            f = ln(h, W[q + "final_layer_norm.weight"], W[q + "final_layer_norm.bias"])
            f = gelu(f @ W[q + "feed_forward.intermediate_dense.weight"].T + W[q + "feed_forward.intermediate_dense.bias"])
            h = h + f @ W[q + "feed_forward.output_dense.weight"].T + W[q + "feed_forward.output_dense.bias"]
        h = ln(h, W[p + "encoder.layer_norm.weight"], W[p + "encoder.layer_norm.bias"])
        return h @ W["lm_head.weight"].T + W["lm_head.bias"]

    def transskriber(self, lyd, stykker=None, bid=10.0, overlap=2.0):
        """Transskriberer lyd (eller en liste af (start, slut) i samples) og returnerer
        én tekst pr. stykke. Lyden deles i bidder på 10 sek. med 2 sek. overlap,
        som giver bedst resultat, og bidderne regnes parallelt."""
        L, O = int(bid * SR), int(overlap * SR)
        stykker = stykker or [(0, len(lyd))]
        opg = []
        for nr, (s0, s1) in enumerate(stykker):
            N = s1 - s0
            for start in range(0, N, L - 2 * O):
                n_lyd = min(L, N - start)
                venstre = 0 if start == 0 else O
                sidst = start + L >= N
                if n_lyd > venstre and n_lyd >= 400:
                    opg.append((nr, s0 + start, n_lyd, venstre, 0 if sidst else O))
                if sidst:
                    break
        global _MODEL, _LYD
        _MODEL, _LYD = self, lyd
        if len(opg) > 1:
            with mp.get_context("fork").Pool(os.cpu_count() or 1) as pool:
                dele = pool.map(_bid_ids, opg, chunksize=1)
        else:
            dele = [_bid_ids(o) for o in opg]
        ids = [[] for _ in stykker]
        for o, d in zip(opg, dele):
            ids[o[0]].extend(d)
        tekster = []
        for liste in ids:
            ud, forrige = [], None
            for t in liste:
                if t != forrige and t < 42:
                    ud.append(" " if t == 36 else VOCAB[t])
                forrige = t
            tekster.append(" ".join("".join(ud).split()))
        return tekster

_MODEL = _LYD = None

def _bid_ids(o):
    _, start, n_lyd, venstre, hoejre = o
    lg = _MODEL.logits(_LYD[start:start + n_lyd])
    n = lg.shape[0]
    a = int(round(venstre / n_lyd * n))
    b = n - int(round(hoejre / n_lyd * n))
    return lg[a:b].argmax(-1).tolist()

# ---------- talere ----------
def talere(lyd, antal):
    import sherpa_onnx
    seg_dir = CACHE / "sherpa-onnx-pyannote-segmentation-3-0"
    if not (seg_dir / "model.onnx").exists():
        arkiv = hent(SEG_URL, CACHE / "seg.tar.bz2")
        with tarfile.open(arkiv) as t:
            t.extractall(CACHE, filter="data")
        arkiv.unlink()
    emb = hent(EMB_URL, CACHE / "3dspeaker.onnx")
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(seg_dir / "model.onnx")), num_threads=os.cpu_count() or 1),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(emb), num_threads=os.cpu_count() or 1),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=antal if antal > 0 else -1, threshold=0.9),
        min_duration_on=0.3, min_duration_off=0.5)
    blokke = []
    for s in sherpa_onnx.OfflineSpeakerDiarization(cfg).process(lyd).sort_by_start_time():
        if blokke and blokke[-1][2] == s.speaker and s.start - blokke[-1][1] < 3.0:
            blokke[-1][1] = s.end
        else:
            blokke.append([s.start, s.end, s.speaker])
    return blokke

def tid(sek):
    t, s = divmod(int(sek), 60)
    return f"{t // 60:02d}:{t % 60:02d}:{s:02d}"

def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    antal = None
    if "--talere" in args:
        i = args.index("--talere"); antal = int(args[i + 1]); del args[i:i + 2]
    CACHE.mkdir(parents=True, exist_ok=True)
    lyd = laes_lyd(args[0])
    model = Roest(hent(ROEST, CACHE / "model.safetensors"))
    if antal is None:
        print(model.transskriber(lyd)[0], flush=True)
        return
    blokke = [b for b in talere(lyd, antal) if (b[1] - b[0]) * SR >= SR // 2]
    tekster = model.transskriber(lyd, [(int(a * SR), int(b * SR)) for a, b, _ in blokke])
    numre = {}
    for (start, _, taler), tekst in zip(blokke, tekster):
        if tekst:
            nr = numre.setdefault(taler, len(numre) + 1)
            print(f"[{tid(start)}] Taler {nr}: {tekst}", flush=True)

if __name__ == "__main__":
    main()
