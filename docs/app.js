// Brugerflade: læser lydfilen, sender den til baggrundsprogrammet og viser resultatet.
const $ = (id) => document.getElementById(id);
const SR = 16000;
let resultatTekst = '';
let koerer = false;

const SKABELON = `# [Mødets titel]

**Dato:** [dato]
**Deltagere:** [navne]
**Referent:** Maskingenereret med Røst v3 og Claude. Gennemlæst af: [navn]

## Beslutninger
| # | Beslutning |
|---|------------|
| 1 | … |

## Opgaver
| Opgave | Ansvarlig | Frist |
|--------|-----------|-------|
| … | … | … |

## Drøftelser
### 1. [Dagsordenspunkt]
- …

## Åbne spørgsmål
- …

## Næste møde
[dato eller "ikke aftalt"]

## Bør tjekkes
- [usikkert: …]`;

function valgtAntal() {
  const v = document.querySelector('input[name=antal]:checked');
  if (!v) return null;
  if (v.value === '6') return Math.max(6, parseInt($('flereAntal').value, 10) || 6);
  return parseInt(v.value, 10);
}

function opdaterStart() {
  const klar = $('fil').files.length > 0 && valgtAntal() !== null && !koerer;
  $('start').disabled = !klar;
  $('hjaelp').textContent = klar || koerer ? '' : 'Vælg en lydfil og antal personer.';
}
$('fil').addEventListener('change', opdaterStart);
document.querySelectorAll('input[name=antal]').forEach(r => r.addEventListener('change', () => {
  $('flere').classList.toggle('skjult', valgtAntal() < 6);
  opdaterStart();
}));

function minutter(sek) {
  if (sek == null || !isFinite(sek)) return '';
  if (sek < 60) return ' · under 1 min. tilbage';
  return ` · ca. ${Math.round(sek / 60)} min. tilbage`;
}

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

$('start').addEventListener('click', async () => {
  const antal = valgtAntal();
  koerer = true; opdaterStart();
  $('fejl').textContent = ''; $('fremdrift').classList.remove('skjult');
  $('resultatKort').classList.add('skjult'); $('resultat').value = ''; resultatTekst = '';
  $('status').textContent = 'Læser lydfilen ...'; $('bar').removeAttribute('value');
  let lyd;
  try {
    lyd = await laesLyd($('fil').files[0]);
  } catch (e) {
    $('fejl').textContent = 'Lydfilen kunne ikke læses. Prøv et andet format (fx mp3 eller wav).';
    koerer = false; opdaterStart(); return;
  }
  const varighed = Math.round(lyd.length / SR / 60);
  const w = new Worker('worker.js', { type: 'module' });
  const start = performance.now();
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
      const brugt = Math.round((performance.now() - start) / 60000);
      $('bar').value = 1;
      $('status').innerHTML = `<span class="ok">Færdig.</span> ${varighed} min. lyd på ${brugt < 1 ? 'under 1' : brugt} min.`;
      w.terminate(); koerer = false; opdaterStart();
    } else if (m.type === 'fejl') {
      $('fejl').textContent = 'Der opstod en fejl: ' + m.tekst;
      w.terminate(); koerer = false; opdaterStart();
    }
  };
  w.onerror = (e) => {
    $('fejl').textContent = 'Der opstod en fejl: ' + (e.message || 'ukendt');
    koerer = false; opdaterStart();
  };
  w.postMessage({ type: 'start', lyd, antal }, [lyd.buffer]);
});

function referatTekst() {
  const antal = valgtAntal();
  const titel = $('titel').value.trim() || '[ikke oplyst]';
  const dato = $('dato').value ? new Date($('dato').value).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' }) : '[ikke oplyst]';
  const navne = $('navne').value.trim() || '[ikke oplyst]';
  const antalTekst = antal === 0 ? 'ukendt (antallet af talere er gættet og kan være for højt)' : String(antal);
  return `Lav et mødereferat ud fra transskriptionen nedenfor.

Møde: ${titel}
Dato: ${dato}
Deltagere: ${navne}
Antal personer, der taler: ${antalTekst}

Regler:
- Transskriptionen er maskingenereret med Røst v3. Den har ingen tegnsætning, og taleradskillelsen kan tage fejl.
- Find ud af, hvem "Taler 1", "Taler 2" osv. er, ud fra tydelige spor i teksten (fx når nogen tiltales ved navn, præsenterer sig eller nævner sin rolle). Brug kun navne, når du er sikker. Ellers "Taler 2".
- Er antallet af talere gættet, så slå talere sammen, når teksten tydeligt viser, at det er samme person, og nævn det under "Bør tjekkes".
- Medtag kun det, der faktisk blev sagt. Opfind aldrig beslutninger, opgaver, navne eller datoer.
- Uforståelige passager: [uklart]. Steder, du er i tvivl om, samles under "Bør tjekkes" med tidspunkt.
- Vis kun referatet: ingen indledning, ingen kommentarer og intet forslag til næste skridt.
- Skriv kort og konkret på dansk. Mærk referatet som maskingenereret.

Brug denne skabelon:

${SKABELON}

Transskription (maskingenereret med Røst v3, ikke rettet af et menneske):

${resultatTekst}`;
}

async function kopier(tekst, besked) {
  try {
    await navigator.clipboard.writeText(tekst);
  } catch {
    const t = document.createElement('textarea'); t.value = tekst; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  $('kopieret').textContent = besked;
}
$('kopierReferat').addEventListener('click', () => kopier(referatTekst(), 'Kopieret. Åbn Claude, og indsæt med Ctrl+V.'));
$('kopierTekst').addEventListener('click', () => kopier('Transskription (maskingenereret med Røst v3, ikke rettet af et menneske)\n\n' + resultatTekst, 'Transskriptionen er kopieret.'));
$('gem').addEventListener('click', () => {
  const navn = ($('fil').files[0]?.name || 'optagelse').replace(/\.[^.]+$/, '');
  const blob = new Blob(['Transskription (maskingenereret med Røst v3, ikke rettet af et menneske)\n\n' + resultatTekst], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${navn} - transskription.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('ryd').addEventListener('click', async (e) => {
  e.preventDefault();
  for (const k of await caches.keys()) await caches.delete(k);
  alert('De hentede modeller er slettet fra browseren.');
});
