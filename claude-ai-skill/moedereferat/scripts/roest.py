"""Røst v3 (wav2vec2, CoRal-projektet) kørt med ren numpy – uden PyTorch.
Kræver: pip install numpy sherpa-onnx av
Brug:  python roest.py <lydfil>                  -> ren transskription
       python roest.py <lydfil> --talere <antal> -> transskription med talere
       --maks-sek <n>  stop efter ca. n sekunder (standard 420) og gem fremskridt.
Er arbejdet ikke færdigt, skrives "IKKE FÆRDIG" og exit-kode 3; kør så samme
kommando igen, så fortsætter den, hvor den slap. Download fortsætter også.
Modeller og midlertidigt fremskridt ligger i /tmp/roest (ROEST_CACHE). Fremskridtet
slettes automatisk, når transskriptionen er færdig.
Modellen er omfattet af licensen i github.com/SundhedsinnovationSI/roest-v3-transskription
(OpenRAIL-M): maskingenereret tekst skal mærkes som maskingenereret."""
import hashlib, json, os, struct, subprocess, sys, tarfile, time, urllib.request
from pathlib import Path

START = time.time()
# Én tråd pr. proces; ved flere kerner regnes flere lydbidder parallelt
for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[_v] = "1"
import multiprocessing as mp
import numpy as np

CACHE = Path(os.environ.get("ROEST_CACHE", "/tmp/roest"))
ROEST = ("https://github.com/SundhedsinnovationSI/roest-v3-transskription"
         "/releases/download/v1/model.safetensors", 631024476)
GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
SEG_URL = GH + "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL = GH + "speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"
SR = 16000
# Ordforråd fra modellens vocab.json (indeks 0-41); 36 = ordskifte, 42-45 = specialtegn
VOCAB = list("0123456789abcdefghijklmnopqrstuvwxyz") + ["|", "å", "æ", "é", "ø", "ü"]
KERNER = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)


def log(tekst):
    print(tekst, file=sys.stderr, flush=True)


def hent(url, sti, stoerrelse=None):
    """Henter en fil; en afbrudt download fortsætter, hvor den slap."""
    if sti.exists():
        return sti
    tmp = sti.with_name(sti.name + ".del")
    for forsoeg in range(5):
        har = tmp.stat().st_size if tmp.exists() else 0
        req = urllib.request.Request(url, headers={"Range": f"bytes={har}-"} if har else {})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if har and r.status != 206:      # serveren kan ikke fortsætte: start forfra
                    har = 0
                total = stoerrelse or (har + int(r.headers.get("Content-Length", 0)))
                naeste = 0
                with open(tmp, "ab" if har else "wb") as f:
                    while blok := r.read(1 << 20):
                        f.write(blok); har += len(blok)
                        if total and har * 100 // total >= naeste:
                            log(f"Henter {sti.name}: {har * 100 // total} %"); naeste += 20
            break
        except OSError as e:
            log(f"Download afbrudt ({e}), prøver igen ...")
            time.sleep(2 * (forsoeg + 1))
    if stoerrelse and tmp.stat().st_size != stoerrelse:
        sys.exit(f"FEJL: {sti.name} er ikke hentet helt. Kør kommandoen igen.")
    tmp.rename(sti)
    return sti


# ---------- lyd ----------
def laes_lyd(fil):
    try:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", fil, "-ac", "1",
                              "-ar", str(SR), "-f", "f32le", "-"],
                             check=True, capture_output=True).stdout
        return np.frombuffer(raw, dtype=np.float32).copy()
    except FileNotFoundError:  # intet ffmpeg: brug PyAV
        import av
        c = av.open(fil)
        rs = av.AudioResampler(format="flt", layout="mono", rate=SR)
        dele = [f.to_ndarray().ravel() for fr in c.decode(audio=0) for f in rs.resample(fr)]
        dele += [f.to_ndarray().ravel() for f in rs.resample(None)]
        return np.concatenate(dele).astype(np.float32)


# ---------- model ----------
def laes_vaegte(sti):
    """Læser bf16-vægte tensor for tensor (lavt hukommelsesforbrug)."""
    mm = np.memmap(sti, dtype=np.uint8, mode="r")
    n = struct.unpack("<Q", bytes(mm[:8]))[0]
    hoved = json.loads(bytes(mm[8:8 + n]))
    W = {}
    for k, v in hoved.items():
        if k == "__metadata__":
            continue
        a, b = v["data_offsets"]
        bf16 = mm[8 + n + a:8 + n + b].view(np.uint16)
        W[k] = (bf16.astype(np.uint32) << 16).view(np.float32).reshape(v["shape"])
    del mm
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


def bidder(stykker, bid=10.0, overlap=2.0):
    """Deler hvert stykke i bidder på 10 sek. med 2 sek. overlap (giver bedst resultat)."""
    L, O = int(bid * SR), int(overlap * SR)
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
    return opg


_MODEL = _LYD = None


def _bid_ids(o):
    _, start, n_lyd, venstre, hoejre = o
    lg = _MODEL.logits(_LYD[start:start + n_lyd])
    n = lg.shape[0]
    a = int(round(venstre / n_lyd * n))
    b = n - int(round(hoejre / n_lyd * n))
    return lg[a:b].argmax(-1).tolist()


def tekst(ids):
    ud, forrige = [], None
    for t in ids:
        if t != forrige and t < 42:
            ud.append(" " if t == 36 else VOCAB[t])
        forrige = t
    return " ".join("".join(ud).split())


# ---------- talere ----------
def talere(lyd, antal):
    import sherpa_onnx
    seg_dir = CACHE / "sherpa-onnx-pyannote-segmentation-3-0"
    if not (seg_dir / "model.onnx").exists():
        arkiv = hent(SEG_URL, CACHE / "seg.tar.bz2")
        with tarfile.open(arkiv) as t:
            t.extractall(CACHE, filter="data")
        arkiv.unlink()
    emb = hent(EMB_URL, CACHE / "campplus.onnx")   # CAM++: hurtig stemmegenkendelse
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(seg_dir / "model.onnx")), num_threads=KERNER),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb), num_threads=KERNER),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=antal if antal > 0 else -1, threshold=0.9),
        min_duration_on=0.3, min_duration_off=0.5)
    blokke = []
    for s in sherpa_onnx.OfflineSpeakerDiarization(cfg).process(lyd).sort_by_start_time():
        if blokke and blokke[-1][2] == s.speaker and s.start - blokke[-1][1] < 3.0:
            blokke[-1][1] = s.end
        else:
            blokke.append([s.start, s.end, s.speaker])
    return [b for b in blokke if (b[1] - b[0]) * SR >= SR // 2]


def tid(sek):
    t, s = divmod(int(sek), 60)
    return f"{t // 60:02d}:{t % 60:02d}:{s:02d}"


def main():
    global _MODEL, _LYD
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    antal, maks = None, 420.0
    if "--talere" in args:
        i = args.index("--talere"); antal = int(args[i + 1]); del args[i:i + 2]
    if "--maks-sek" in args:
        i = args.index("--maks-sek"); maks = float(args[i + 1]); del args[i:i + 2]
    CACHE.mkdir(parents=True, exist_ok=True)
    lydfil = args[0]

    # Fremskridt gemmes midlertidigt, så en afbrudt kørsel kan fortsætte
    noegle = hashlib.sha1(f"{Path(lydfil).resolve()}|{os.path.getsize(lydfil)}|{antal}".encode()).hexdigest()[:12]
    job_fil = CACHE / f"job-{noegle}.json"
    job = json.loads(job_fil.read_text()) if job_fil.exists() else {"faerdige": {}}

    def gem():
        job_fil.write_text(json.dumps(job))

    lyd = laes_lyd(lydfil)
    log(f"Lyd: {len(lyd) / SR / 60:.1f} min. Processorkerner: {KERNER}.")
    model_sti = hent(ROEST[0], CACHE / "model.safetensors", ROEST[1])

    if antal is not None and "blokke" not in job:
        log("Finder talere ...")
        job["blokke"] = talere(lyd, antal)
        gem()
    blokke = job.get("blokke")
    stykker = [(int(a * SR), int(b * SR)) for a, b, _ in blokke] if blokke else [(0, len(lyd))]
    opg = bidder(stykker)
    mangler = [i for i in range(len(opg)) if str(i) not in job["faerdige"]]
    log(f"Transskriberer: {len(opg) - len(mangler)} af {len(opg)} bidder er klar.")

    if mangler:
        _MODEL, _LYD = Roest(model_sti), lyd
        pr_bid = None
        pool = mp.get_context("fork").Pool(KERNER) if KERNER > 1 and len(mangler) > 1 else None
        try:
            for start in range(0, len(mangler), KERNER):
                if pr_bid and time.time() - START + pr_bid > maks:
                    break
                t0 = time.time()
                del_ = mangler[start:start + KERNER]
                res = pool.map(_bid_ids, [opg[i] for i in del_]) if pool else [_bid_ids(opg[i]) for i in del_]
                for i, r in zip(del_, res):
                    job["faerdige"][str(i)] = r
                gem()
                pr_bid = time.time() - t0
        finally:
            if pool:
                pool.close()
        klar = len(job["faerdige"])
        if klar < len(opg):
            rest = (len(opg) - klar) / KERNER * (pr_bid or 6) / 60
            print(f"IKKE FÆRDIG: {klar} af {len(opg)} bidder er klar (ca. {rest:.0f} min. tilbage). "
                  f"Kør samme kommando igen for at fortsætte.", flush=True)
            sys.exit(3)

    ids = [[] for _ in stykker]
    for i, o in enumerate(opg):
        ids[o[0]].extend(job["faerdige"][str(i)])
    if blokke is None:
        print(tekst(ids[0]), flush=True)
    else:
        numre = {}
        for (start, _, taler), liste in zip(blokke, ids):
            t = tekst(liste)
            if t:
                nr = numre.setdefault(taler, len(numre) + 1)
                print(f"[{tid(start)}] Taler {nr}: {t}", flush=True)
    job_fil.unlink(missing_ok=True)   # slet midlertidigt fremskridt


if __name__ == "__main__":
    main()
