// Baggrundsprogram: henter modeller, finder talere og transskriberer med Røst v3.
// Alt kører lokalt i browseren. Lyden sendes ingen steder hen.
import * as ort from './ort/ort.wasm.min.mjs';

const SR = 16000;
const BASE = new URL('./', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'ort/';
ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 1;

const VERSION = 'roest-modeller-v1';
const MODELLER = {
  roest: { dele: [0, 1, 2, 3].map(i => `modeller/roest-int8-del${i}.bin`), stoerrelse: 356244130 },
  seg: { dele: ['modeller/segmentering.onnx'], stoerrelse: 5992913 },
  emb: { dele: ['modeller/campplus.onnx'], stoerrelse: 28281138 },
};
// Ordforråd fra modellens vocab.json (0-41); 36 = ordskifte, 42-45 = specialtegn
const VOCAB = [...'0123456789abcdefghijklmnopqrstuvwxyz', '|', 'å', 'æ', 'é', 'ø', 'ü'];

const post = (m) => self.postMessage(m);
const status = (fase, tekst, procent, eta) => post({ type: 'status', fase, tekst, procent, eta });

// ---------- modeller (gemmes i browserens cache efter første download) ----------
async function hentModeller() {
  let cache = null;   // privat vindue m.m.: hent uden at gemme
  try { cache = await caches.open(VERSION); } catch { cache = null; }
  const total = Object.values(MODELLER).reduce((s, m) => s + m.stoerrelse, 0);
  let hentet = 0;
  const ud = {};
  for (const [navn, m] of Object.entries(MODELLER)) {
    const buf = new Uint8Array(m.stoerrelse);
    let pos = 0;
    for (const del of m.dele) {
      const url = BASE + del;
      const res = cache ? await cache.match(url) : null;
      if (!res) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Kunne ikke hente ${del} (${r.status})`);
        const reader = r.body.getReader();
        const stykker = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stykker.push(value); n += value.length; hentet += value.length;
          status('hent', `Henter modeller første gang: ${Math.round(hentet / 2 ** 20)} af ${Math.round(total / 2 ** 20)} MB`, hentet / total);
        }
        const data = new Uint8Array(n);
        let o = 0;
        for (const s of stykker) { data.set(s, o); o += s.length; }
        if (cache) { try { await cache.put(url, new Response(data)); } catch { /* ingen plads: hentes igen næste gang */ } }
        buf.set(data, pos); pos += n;
      } else {
        const data = new Uint8Array(await res.arrayBuffer());
        buf.set(data, pos); pos += data.length; hentet += data.length;
        status('hent', 'Indlæser modeller ...', hentet / total);
      }
    }
    if (pos !== m.stoerrelse) {
      try { await caches.delete(VERSION); } catch { /* ignorér */ }
      throw new Error(`Modelfilen ${navn} er ufuldstændig. Prøv igen.`);
    }
    ud[navn] = buf;
  }
  return ud;
}

async function session(data) {
  return ort.InferenceSession.create(data, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

// ---------- Kaldi-fbank til stemmemodellen (80 mel, 20-7600 Hz, povey, snip_edges=false) ----------
const MEL = (() => {
  const mel = f => 1127 * Math.log(1 + f / 700);
  const nb = 80, nfft = 512, lo = mel(20), hi = mel(SR / 2 - 400), d = (hi - lo) / (nb + 1);
  const W = [];
  for (let b = 0; b < nb; b++) {
    const l = lo + b * d, c = l + d, r = c + d, w = new Float64Array(nfft / 2 + 1);
    for (let i = 0; i < nfft / 2; i++) {
      const m = mel(i * SR / nfft);
      if (m > l && m <= c) w[i] = (m - l) / (c - l);
      else if (m > c && m < r) w[i] = (r - m) / (r - c);
    }
    let a = 0; while (a < nfft / 2 && !w[a]) a++;
    let z = nfft / 2; while (z > a && !w[z - 1]) z--;
    W.push({ a, z, w });          // kun ikke-nul vægte (hurtigere)
  }
  return W;
})();
const POVEY = Float64Array.from({ length: 400 }, (_, i) => Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / 399), 0.85));
const FFT_N = 512;
const FFT_COS = Float64Array.from({ length: FFT_N / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / FFT_N));
const FFT_SIN = Float64Array.from({ length: FFT_N / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / FFT_N));
const FFT_REV = (() => {
  const r = new Uint16Array(FFT_N), bits = Math.log2(FFT_N);
  for (let i = 0; i < FFT_N; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; }
  return r;
})();
function fft(re, im) {
  for (let i = 0; i < FFT_N; i++) { const j = FFT_REV[i]; if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let size = 2; size <= FFT_N; size <<= 1) {
    const half = size >> 1, step = FFT_N / size;
    for (let s = 0; s < FFT_N; s += size) {
      for (let k = 0; k < half; k++) {
        const c = FFT_COS[k * step], sn = FFT_SIN[k * step], a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
function fbank(x) {
  const n = x.length, nf = Math.floor((n + 80) / 160);
  const ud = new Float32Array(Math.max(nf, 0) * 80);
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N), fr = new Float64Array(400), pw = new Float64Array(256);
  for (let f = 0; f < nf; f++) {
    let sum = 0;
    for (let i = 0; i < 400; i++) {
      let s = f * 160 - 120 + i;
      if (s < 0) s = -s - 1; else if (s >= n) s = 2 * n - 1 - s;
      fr[i] = x[s]; sum += fr[i];
    }
    const mean = sum / 400;
    for (let i = 0; i < 400; i++) fr[i] -= mean;
    for (let i = 399; i > 0; i--) fr[i] -= 0.97 * fr[i - 1];
    fr[0] -= 0.97 * fr[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < 400; i++) re[i] = fr[i] * POVEY[i];
    fft(re, im);
    for (let i = 0; i < 256; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
    for (let b = 0; b < 80; b++) {
      const { a, z, w } = MEL[b]; let e = 0;
      for (let i = a; i < z; i++) e += w[i] * pw[i];
      ud[f * 80 + b] = Math.log(Math.max(e, 1.19209e-07));
    }
  }
  return { data: ud, frames: nf };
}

// ---------- taleradskillelse (port af sherpa-onnx: pyannote-seg 3.0 + CAM++) ----------
const WIN = 160000, SHIFT = 16000, RF_SIZE = 991, RF_SHIFT = 270;
const PM = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1]];

async function segmenter(seg, chunk) {
  const out = await seg.run({ [seg.inputNames[0]]: new ort.Tensor('float32', chunk, [1, 1, WIN]) });
  const t = out[seg.outputNames[0]]; const F = t.dims[1], C = t.dims[2], d = t.data;
  const lab = new Uint8Array(F * 3);
  for (let f = 0; f < F; f++) {
    let best = 0;
    for (let c = 1; c < C; c++) if (d[f * C + c] > d[f * C + best]) best = c;
    lab[f * 3] = PM[best][0]; lab[f * 3 + 1] = PM[best][1]; lab[f * 3 + 2] = PM[best][2];
  }
  return { lab, F };
}

async function embedding(emb, x) {
  const { data, frames } = fbank(x);
  for (let b = 0; b < 80; b++) {
    let m = 0; for (let f = 0; f < frames; f++) m += data[f * 80 + b];
    m /= frames; for (let f = 0; f < frames; f++) data[f * 80 + b] -= m;
  }
  const out = await emb.run({ x: new ort.Tensor('float32', data, [1, frames, 80]) });
  return out[emb.outputNames[0]].data;
}

// Agglomerativ klyngedannelse med complete linkage (nearest-neighbour chain, O(n²))
function klynger(E, n, antal, taerskel) {
  if (n === 1) return [0];
  const idx = (i, j) => (i < j ? i * n - (i * (i + 1)) / 2 + j - i - 1 : j * n - (j * (j + 1)) / 2 + i - j - 1);
  const D = new Float32Array((n * (n - 1)) / 2);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let s = 0; for (let k = 0; k < 192; k++) s += E[i][k] * E[j][k];
    D[idx(i, j)] = Math.max(1 - s, 0);
  }
  const aktiv = new Uint8Array(n).fill(1), fletninger = [];
  const kaede = [];
  let tilbage = n;
  while (tilbage > 1) {
    if (!kaede.length) { for (let i = 0; i < n; i++) if (aktiv[i]) { kaede.push(i); break; } }
    for (;;) {
      const a = kaede[kaede.length - 1], forrige = kaede.length > 1 ? kaede[kaede.length - 2] : -1;
      let b = -1, bd = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === a || !aktiv[j]) continue;
        const dj = D[idx(a, j)];
        if (dj < bd || (dj === bd && j === forrige)) { bd = dj; b = j; }
      }
      if (b === forrige) {
        kaede.pop(); kaede.pop();
        const [p, q] = a < b ? [a, b] : [b, a];
        fletninger.push([p, q, bd]);
        for (let j = 0; j < n; j++) if (aktiv[j] && j !== p && j !== q) D[idx(p, j)] = Math.max(D[idx(p, j)], D[idx(q, j)]);
        aktiv[q] = 0; tilbage--;
        break;
      }
      kaede.push(b);
    }
  }
  fletninger.sort((x, y) => x[2] - y[2]);
  const far = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (far[i] !== i) { far[i] = far[far[i]]; i = far[i]; } return i; };
  fletninger.forEach(([a, b, h], k) => {
    if (antal > 0 ? k < n - antal : h <= taerskel) far[find(b)] = find(a);
  });
  const roedder = new Map();
  return Array.from({ length: n }, (_, i) => { const r = find(i); if (!roedder.has(r)) roedder.set(r, roedder.size); return roedder.get(r); });
}

async function findTalere(lyd, antal, seg, emb) {
  const n = lyd.length;
  // vinduer på 10 sek., der flyttes 1 sek. ad gangen (laves ét ad gangen for at spare hukommelse)
  const nc = n <= WIN ? 0 : Math.floor((n - WIN) / SHIFT) + 1;
  const antalBidder = n <= WIN ? 1 : nc + ((n - WIN) % SHIFT > 0 ? 1 : 0);
  const bid = (i) => {
    if (i < nc) return lyd.slice(i * SHIFT, i * SHIFT + WIN);
    const b = new Float32Array(WIN); b.set(lyd.subarray(i * SHIFT, Math.min(n, i * SHIFT + WIN))); return b;
  };
  const t0 = performance.now();
  const labels = [];
  let F = 0;
  for (let i = 0; i < antalBidder; i++) {
    const r = await segmenter(seg, bid(i)); labels.push(r.lab); F = r.F;
    if (i % 20 === 0) { const el = (performance.now() - t0) / 1000; status('talere', `Finder talere: lytter optagelsen igennem`, 0.4 * (i + 1) / antalBidder, el / (i + 1) * (antalBidder - i) * 2.2); }
  }
  const sidst = n > WIN && (n - WIN) % SHIFT > 0;
  const resultat = (final, T, K) => {
    const scale = RF_SHIFT / SR, offs = 0.5 * RF_SIZE / SR, ud = [];
    for (let sp = 0; sp < K; sp++) {
      const segs = [];
      let aktiv = final[sp] > 0, st = 0;
      for (let f = 1; f < T; f++) {
        if (aktiv && !final[f * K + sp]) { segs.push([st * scale + offs, f * scale + offs]); aktiv = false; }
        else if (!aktiv && final[f * K + sp]) { aktiv = true; st = f; }
      }
      if (aktiv) segs.push([st * scale + offs, (T - 1) * scale + offs]);
      for (let ændret = true; ændret;) {
        ændret = false;
        for (let i = 0; i < segs.length - 1; i++) {
          const a = segs[i], b = segs[i + 1];
          if (a[1] < b[0] && a[1] + 0.5 >= b[0]) { segs[i] = [a[0], b[1]]; segs.splice(i + 1, 1); ændret = true; break; }
        }
      }
      for (const [s, e] of segs) if (e - s > 0.3) ud.push([s, e, sp]);
    }
    return ud.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  if (labels.length === 1) {
    let T = F;
    if (n > WIN || (n - WIN) % SHIFT > 0) T = Math.min(Math.floor(n / RF_SHIFT), F);
    return resultat(labels[0], T, 3);
  }
  const nfr = Math.floor((WIN + (labels.length - 1) * SHIFT) / RF_SHIFT) + 1;
  const cnt = new Float64Array(nfr), w = new Float64Array(nfr);
  labels.forEach((l, i) => {
    const s = Math.round(i * SHIFT / RF_SHIFT);
    for (let f = 0; f < F; f++) { cnt[s + f] += l[f * 3] + l[f * 3 + 1] + l[f * 3 + 2]; w[s + f] += 1; }
  });
  const spf = Int32Array.from(cnt, (c, i) => Math.floor(c / (w[i] + 1e-12) + 0.5));
  if (!spf.some(v => v > 0)) return [];
  // (bid, taler) -> sample-intervaller uden overlap
  const par = [], intervaller = [];
  labels.forEach((l, ci) => {
    const off = ci * SHIFT;
    for (let sp = 0; sp < 3; sp++) {
      let sum = 0; const d = new Uint8Array(F);
      for (let f = 0; f < F; f++) { const ov = l[f * 3] + l[f * 3 + 1] + l[f * 3 + 2] >= 2; d[f] = ov ? 0 : l[f * 3 + sp]; sum += d[f]; }
      if (sum < 10) continue;
      const iv = []; let aktiv = false, st = 0;
      for (let k = 0; k < F; k++) {
        if (d[k]) { if (!aktiv) { aktiv = true; st = k; } } else if (aktiv) { aktiv = false; iv.push([Math.trunc(st / F * WIN + off), Math.trunc(k / F * WIN + off)]); }
      }
      if (aktiv) iv.push([Math.trunc(st / F * WIN + off), Math.trunc((F - 1) / F * WIN + off)]);
      par.push([ci, sp]); intervaller.push(iv);
    }
  });
  const E = [], ok = [];
  const t1 = performance.now();
  for (let i = 0; i < intervaller.length; i++) {
    const dele = intervaller[i].map(([a, b]) => lyd.subarray(a, Math.min(b, n))).filter(d => d.length > 0);
    const len = dele.reduce((s, d) => s + d.length, 0), x = new Float32Array(len);
    let o = 0; for (const d of dele) { x.set(d, o); o += d.length; }
    const e = await embedding(emb, x);
    if (!e.some(Number.isNaN)) {
      let nn = 0; for (const v of e) nn += v * v; nn = Math.sqrt(nn);
      E.push(Float64Array.from(e, v => v / nn)); ok.push(i);
    }
    if (i % 10 === 0) { const el = (performance.now() - t1) / 1000; status('talere', 'Finder talere: genkender stemmer', 0.4 + 0.6 * (i + 1) / intervaller.length, el / (i + 1) * (intervaller.length - i)); }
  }
  status('talere', 'Finder talere: grupperer stemmer', 1, null);
  const cl = klynger(E, E.length, antal, 0.9);
  const K = cl.reduce((m, v) => Math.max(m, v), -1) + 1;
  const c2 = new Map(ok.map((i, k) => [par[i][0] * 3 + par[i][1], cl[k]]));
  let count = new Int32Array(nfr * K);
  labels.forEach((l, ci) => {
    const s = Math.round(ci * SHIFT / RF_SHIFT);
    for (let sp = 0; sp < 3; sp++) {
      const c = c2.get(ci * 3 + sp); if (c === undefined) continue;
      for (let f = 0; f < F; f++) if (l[f * 3 + sp]) count[(s + f) * K + c] += 1;
    }
  });
  let T = nfr;
  if (sidst) T = Math.min(Math.floor(n / RF_SHIFT), nfr - 1) + 1;
  const final = new Uint8Array(T * K);
  for (let i = 0; i < T; i++) {
    const k = spf[i] || 0; if (!k) continue;
    const orden = Array.from({ length: K }, (_, j) => j).sort((a, b) => count[i * K + b] - count[i * K + a] || a - b);
    for (let j = 0; j < Math.min(k, K); j++) final[i * K + orden[j]] = 1;
  }
  return resultat(final, T, K);
}

// ---------- transskription med Røst v3 ----------
function tekst(ids) {
  let ud = '', forrige = -1;
  for (const t of ids) { if (t !== forrige && t < 42) ud += t === 36 ? ' ' : VOCAB[t]; forrige = t; }
  return ud.split(/\s+/).filter(Boolean).join(' ');
}

async function bidIds(roest, x, venstre, hoejre) {
  let m = 0; for (const v of x) m += v; m /= x.length;
  let v2 = 0; for (const v of x) v2 += (v - m) * (v - m); v2 /= x.length;
  const s = Math.sqrt(v2 + 1e-7), xn = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) xn[i] = (x[i] - m) / s;
  const out = await roest.run({ lyd: new ort.Tensor('float32', xn, [1, xn.length]) });
  const lg = out.logits, T = lg.dims[1], V = lg.dims[2], d = lg.data;
  const a = Math.round(venstre / x.length * T), b = T - Math.round(hoejre / x.length * T);
  const ids = [];
  for (let f = a; f < b; f++) { let best = 0; for (let c = 1; c < V; c++) if (d[f * V + c] > d[f * V + best]) best = c; ids.push(best); }
  return ids;
}

function tid(sek) {
  const t = Math.floor(sek), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

async function koer(lyd, antal) {
  const data = await hentModeller();
  status('hent', 'Starter modeller ...', 1, null);
  const roest = await session(data.roest);
  data.roest = null;
  let blokke;
  if (antal === 1) {
    blokke = [[0, lyd.length / SR, 0]];
  } else {
    const seg = await session(data.seg), emb = await session(data.emb);
    const segs = await findTalere(lyd, antal, seg, emb);
    await seg.release(); await emb.release();
    blokke = [];
    for (const [s, e, sp] of segs) {
      const b = blokke[blokke.length - 1];
      if (b && b[2] === sp && s - b[1] < 3.0) b[1] = e; else blokke.push([s, e, sp]);
    }
    blokke = blokke.filter(([s, e]) => (e - s) * SR >= SR / 2);
  }
  // bidder på 10 sek. med 2 sek. overlap (giver bedst resultat)
  const L = 10 * SR, O = 2 * SR, opg = [];
  blokke.forEach(([s, e], nr) => {
    const s0 = Math.floor(s * SR), N = Math.floor(e * SR) - s0;
    for (let st = 0; st < N; st += L - 2 * O) {
      const nl = Math.min(L, N - st), v = st === 0 ? 0 : O, sidst = st + L >= N;
      if (nl > v && nl >= 400) opg.push([nr, s0 + st, nl, v, sidst ? 0 : O]);
      if (sidst) break;
    }
  });
  const t0 = performance.now(), ids = blokke.map(() => []), numre = new Map();
  let udskrevet = 0;
  const linjer = [];
  for (let i = 0; i < opg.length; i++) {
    const [nr, start, nl, v, h] = opg[i];
    ids[nr].push(...await bidIds(roest, lyd.subarray(start, start + nl), v, h));
    // udskriv blokke, efterhånden som de bliver færdige
    while (udskrevet < blokke.length && (i === opg.length - 1 || opg[i + 1][0] > udskrevet)) {
      const t = tekst(ids[udskrevet]);
      if (t) {
        let linje = t;
        if (antal !== 1) {
          const sp = blokke[udskrevet][2];
          if (!numre.has(sp)) numre.set(sp, numre.size + 1);
          linje = `[${tid(blokke[udskrevet][0])}] Taler ${numre.get(sp)}: ${t}`;
        }
        linjer.push(linje); post({ type: 'linje', tekst: linje });
      }
      udskrevet++;
    }
    const el = (performance.now() - t0) / 1000;
    status('tekst', `Transskriberer: ${i + 1} af ${opg.length} bidder`, (i + 1) / opg.length, el / (i + 1) * (opg.length - i - 1));
  }
  await roest.release();
  post({ type: 'faerdig', tekst: linjer.join('\n'), talere: numre.size });
}

self.onmessage = async (e) => {
  if (e.data.type !== 'start') return;
  try {
    await koer(e.data.lyd, e.data.antal);
  } catch (err) {
    post({ type: 'fejl', tekst: String(err && err.message || err) });
  }
};
