// Brugerflade: læser lydfilen, sender den til baggrundsprogrammet og viser resultatet.
const $ = (id) => document.getElementById(id);
const SR = 16000;
// Røst Referat: Claude-siden, der laver referatet som Word-fil
const REFERAT_URL = 'https://claude.ai/artifact/8e3cXgRnJkhBSjsKHSRmdF';
const FILTYPER = ['m4a', 'mp3', 'wav', 'aac', 'mp4', 'flac', 'ogg', 'oga', 'opus', 'webm'];
const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
let resultatTekst = '';
let koerer = false;
let koerselsAntal = null;   // det antal, transskriptionen blev lavet med

// ---------- formular ----------
function valgtAntal() {
  const v = document.querySelector('input[name=antal]:checked');
  if (!v) return null;
  if (v.value === '6') return Math.min(20, Math.max(6, parseInt($('flereAntal').value, 10) || 6));
  return parseInt(v.value, 10);
}

function tegnNavne() {
  const n = valgtAntal(), boks = $('navne');
  const gamle = [...boks.querySelectorAll('input')].map(i => i.value);
  if (n === null) { boks.innerHTML = '<p class="lille">Vælg antal personer for at skrive deres navne.</p>'; return; }
  if (n === 0) {
    boks.innerHTML = '<label for="navn-0">Deltagere (hvis kendt)</label><input type="text" id="navn-0" placeholder="Fx Mette Hansen (projektleder), Jens Berg">';
  } else {
    boks.innerHTML = '<div class="felter">' + Array.from({ length: n }, (_, i) =>
      `<div><label for="navn-${i}">Person ${i + 1}</label><input type="text" id="navn-${i}" placeholder="Navn og evt. rolle"></div>`).join('') + '</div>';
  }
  boks.querySelectorAll('input').forEach((inp, i) => { if (gamle[i]) inp.value = gamle[i]; });
}
const deltagere = () => [...$('navne').querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);

function filEndelse() {
  const f = $('fil').files[0];
  return f ? (f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '') : null;
}

function opdaterStart() {
  const ext = filEndelse(), filOk = ext !== null && FILTYPER.includes(ext);
  $('start').disabled = koerer || !filOk || valgtAntal() === null;
  let hjaelp = '';
  if (!koerer) {
    if (ext !== null && !filOk) hjaelp = `Filtypen ${ext ? '.' + ext : 'uden endelse'} kan ikke bruges. Gem optagelsen som mp3 eller wav.`;
    else if (ext === null || valgtAntal() === null) hjaelp = 'Vælg en lydfil og antal personer.';
  }
  $('hjaelp').textContent = hjaelp;
}
$('fil').addEventListener('change', opdaterStart);
document.querySelectorAll('input[name=antal]').forEach(r => r.addEventListener('change', () => {
  $('flere').classList.toggle('skjult', valgtAntal() < 6);
  tegnNavne(); opdaterStart();
}));
$('flereAntal').addEventListener('input', () => { tegnNavne(); opdaterStart(); });

function datoTekst() {
  const v = $('dato').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  return `${d}. ${MAANEDER[m - 1]} ${y}`;
}

function minutter(sek) {
  if (sek == null || !isFinite(sek)) return '';
  if (sek < 60) return ' · under 1 min. tilbage';
  return ` · ca. ${Math.round(sek / 60)} min. tilbage`;
}

// ---------- lyd ----------
async function laesLyd(fil) {
  const buf = await fil.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, SR);  // afkoder og omsætter til 16 kHz
  const lyd = await ctx.decodeAudioData(buf);
  const n = lyd.length, mono = new Float32Array(n);
  for (let c = 0; c < lyd.numberOfChannels; c++) {
    const d = lyd.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / lyd.numberOfChannels;
  }
  return mono;
}

const resultatKnapper = (aktiv) => ['referat', 'kopierTekst', 'gem'].forEach(id => { $(id).disabled = !aktiv; });

$('start').addEventListener('click', async () => {
  const antal = valgtAntal();
  koerselsAntal = antal;
  koerer = true; opdaterStart();
  $('fejl').textContent = ''; $('fremdrift').classList.remove('skjult');
  $('resultatKort').classList.add('skjult'); $('resultat').value = ''; resultatTekst = '';
  $('kopieret').textContent = ''; $('manuel').classList.add('skjult'); resultatKnapper(false);
  $('status').textContent = 'Læser lydfilen ...'; $('bar').removeAttribute('value');
  $('system').textContent = self.crossOriginIsolated ? ''
    : 'Browseren tillader kun én processorkerne her, så det går langsommere end normalt.';
  let lyd;
  try {
    lyd = await laesLyd($('fil').files[0]);
  } catch (e) {
    $('fejl').textContent = 'Lydfilen kunne ikke læses. Tjek filtypen, eller gem optagelsen som mp3 eller wav.';
    $('fremdrift').classList.add('skjult'); koerer = false; opdaterStart(); return;
  }
  if (lyd.length < SR / 2) {
    $('fejl').textContent = 'Optagelsen er for kort (under et halvt sekund).';
    $('fremdrift').classList.add('skjult'); koerer = false; opdaterStart(); return;
  }
  const varighed = lyd.length / SR / 60;
  const w = new Worker('worker.js', { type: 'module' });
  const start = performance.now();
  const slut = () => { w.terminate(); koerer = false; opdaterStart(); };
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'status') {
      if (m.procent == null) $('bar').removeAttribute('value'); else $('bar').value = m.procent;
      $('status').textContent = `${m.tekst}${minutter(m.eta)}`;
    } else if (m.type === 'linje') {
      $('resultatKort').classList.remove('skjult');
      $('resultat').value += ($('resultat').value ? '\n' : '') + m.tekst;
    } else if (m.type === 'faerdig') {
      resultatTekst = m.tekst;
      $('resultat').value = m.tekst || '(Der blev ikke fundet tale i optagelsen.)';
      $('resultatKort').classList.remove('skjult');
      const brugt = (performance.now() - start) / 60000;
      $('bar').value = 1;
      $('status').innerHTML = `<span class="ok">Færdig.</span> ${varighed < 1 ? 'Under 1' : Math.round(varighed)} min. lyd på ${brugt < 1 ? 'under 1' : Math.round(brugt)} min.`;
      resultatKnapper(!!resultatTekst);
      slut();
    } else if (m.type === 'fejl') {
      $('fejl').textContent = 'Der opstod en fejl: ' + m.tekst;
      $('fremdrift').classList.add('skjult'); slut();
    }
  };
  w.onerror = (e) => {
    $('fejl').textContent = 'Der opstod en fejl: ' + (e.message || 'ukendt');
    $('fremdrift').classList.add('skjult'); slut();
  };
  w.postMessage({ type: 'start', lyd, antal }, [lyd.buffer]);
});

// ---------- referat: overføres til Røst Referat i Claude ----------
function referatPakke() {
  const navne = deltagere();
  const antal = koerselsAntal === 0 ? 'ved ikke (antallet af talere er gættet og kan være for højt)' : String(koerselsAntal);
  return ['RØST-REFERAT v1',
    `Titel: ${$('titel').value.trim()}`,
    `Dato: ${datoTekst() || ''}`,
    `Antal talere: ${antal}`,
    'Deltagere:', ...navne.map(n => `- ${n.replace(/\s+/g, ' ')}`),
    '---',
    resultatTekst].join('\n');
}

async function tilUdklip(tekst) {
  try { await navigator.clipboard.writeText(tekst); return true; } catch { return false; }
}

$('referat').addEventListener('click', async () => {
  if (!resultatTekst) return;
  const pakke = referatPakke();
  const ok = await tilUdklip(pakke);
  window.open(REFERAT_URL, '_blank', 'noopener');
  if (ok) {
    $('manuel').classList.add('skjult');
    $('kopieret').textContent = 'Røst Referat er åbnet i en ny fane. Tryk Ctrl+V dér for at lave referatet.';
  } else {
    $('manuel').value = pakke; $('manuel').classList.remove('skjult'); $('manuel').focus(); $('manuel').select();
    $('kopieret').textContent = 'Teksten kunne ikke kopieres automatisk. Den er markeret i feltet herunder: tryk Ctrl+C, gå til den nye fane, og tryk Ctrl+V.';
  }
});

const medMaerke = () => 'Transskription (maskingenereret med Røst v3, ikke rettet af et menneske)\n\n' + resultatTekst;
$('kopierTekst').addEventListener('click', async () => {
  $('kopieret').textContent = await tilUdklip(medMaerke()) ? 'Transskriptionen er kopieret.' : 'Kunne ikke kopiere. Markér teksten i feltet, og tryk Ctrl+C.';
});
$('gem').addEventListener('click', () => {
  const navn = ($('titel').value.trim() || $('fil').files[0]?.name.replace(/\.[^.]+$/, '') || 'optagelse').replace(/[\\/:*?"<>|]+/g, ' ');
  const blob = new Blob([medMaerke()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${navn} - transskription.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('ryd').addEventListener('click', async (e) => {
  e.preventDefault();
  try { for (const k of await caches.keys()) await caches.delete(k); $('ryd').textContent = 'Modellerne er slettet'; }
  catch { $('ryd').textContent = 'Modellerne kunne ikke slettes'; }
});
