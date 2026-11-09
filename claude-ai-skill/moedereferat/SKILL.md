---
name: moedereferat
description: Transskriberer danske lydoptagelser med talegenkendelsesmodellen Røst v3 og laver mødereferater med talere. Brug den, når brugeren uploader en lydfil (m4a, mp3, wav m.fl.) og beder om transskription eller referat.
---

# Transskription og mødereferat med Røst v3

Skillen har to funktioner:
- **Transskription**: brugeren beder om at få en lydfil skrevet ud.
- **Referat**: brugeren beder om et referat af et møde.

## Fremgangsmåde

1. **Referat:** Har brugeren ikke oplyst mødets titel, dato, deltagere og dagsorden,
   så spørg om det i én kort besked. Antallet af deltagere, der siger noget,
   er nødvendigt for at skelne stemmerne.
2. Installer værktøjer: `pip install -q numpy sherpa-onnx av`
3. Kør scriptet `scripts/roest.py` fra denne skills mappe i baggrunden, fordi lange
   optagelser tager tid (ca. 20-25 min for en times møde). Første kørsel henter
   modeller (ca. 680 MB).
   - Transskription: `nohup python3 <skillmappe>/scripts/roest.py "<lydfil>" > /tmp/roest_ud.txt 2> /tmp/roest_log.txt &`
   - Referat: tilføj `--talere <antal deltagere>` efter lydfilen.
   Tjek jævnligt, om processen er færdig. Fortæl brugeren kort, at der arbejdes.
4. Læs `/tmp/roest_ud.txt`, og slet derefter begge filer: `rm -f /tmp/roest_ud.txt /tmp/roest_log.txt`
5. Vis resultatet i chatten:
   - **Transskription:** modellens tekst uændret, mærket
     *(maskingenereret med Røst v3, ikke rettet af et menneske)*, og derefter en
     læsevenlig udgave med tegnsætning. Ret kun åbenlyse fejl, og sig hvilke.
   - **Referat:** udfyld `skabelon.md` fra denne skills mappe.
     Find ud af, hvem "Taler 1", "Taler 2" osv. er, ud fra tydelige spor i teksten
     (fx når nogen bliver tiltalt ved navn, præsenterer sig eller nævner sin rolle).
     Er du ikke sikker, så vis brugeren et kort uddrag for hver taler, og spørg.

## Regler
- Transskription og referat vises kun i chatten. Opret ingen filer til brugeren, og
  slet de midlertidige filer, når teksten er læst.
- Medtag kun det, der faktisk blev sagt. Opfind aldrig beslutninger, opgaver, navne eller datoer.
- Modellen sætter ikke tegn, og taleradskillelsen kan tage fejl. Brug kun navne, når du
  er sikker. Ellers "Taler 2".
- Uforståelige passager: [uklart]. Gæt aldrig. Steder, du er i tvivl om: [usikkert: …]
  med tidspunkt, samlet i afsnittet "Bør tjekkes".
- Skriv kort og konkret på dansk. Beslutninger og opgaver skal kunne forstås uden resten.
- Mærk altid resultatet som maskingenereret (krav i modellens licens, OpenRAIL-M).

## Fejl
- Fejler download, så vis fejlen fra `/tmp/roest_log.txt`. Modellerne hentes fra
  github.com (SundhedsinnovationSI/roest-v3-transskription og k2-fsa/sherpa-onnx).
- Fejler lydindlæsning, så prøv at konvertere filen med ffmpeg, hvis det findes.
