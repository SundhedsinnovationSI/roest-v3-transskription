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
3. Kør scriptet `scripts/roest.py` fra denne skills mappe **i forgrunden** (ikke i baggrunden):
   - Transskription: `python3 <skillmappe>/scripts/roest.py "<lydfil>"`
   - Referat: `python3 <skillmappe>/scripts/roest.py "<lydfil>" --talere <antal deltagere>`
   Scriptet stopper selv efter ca. 7 minutter og gemmer sit fremskridt. Skriver det
   "IKKE FÆRDIG", så kør **præcis samme kommando** igen. Det fortsætter, hvor det slap.
   Gentag, indtil teksten kommer. Fortæl brugeren kort, hvor langt den er
   (fx "40 af 120 bidder, ca. 25 min. tilbage").
   Forventet tid i Claudes miljø (1 processorkerne): ca. 1-2 minutter for de første
   modeller og derefter ca. 70 sekunder pr. minut lyd. Et møde på en time tager altså
   omkring en time, fordelt på mange kørsler.
4. Læs resultatet direkte fra kommandoens output. Midlertidigt fremskridt slettes
   automatisk, når teksten er færdig.
5. Vis resultatet i chatten:
   - **Transskription:** modellens tekst uændret, mærket
     *(maskingenereret med Røst v3, ikke rettet af et menneske)*, og derefter en
     læsevenlig udgave med tegnsætning. Ret kun åbenlyse fejl, og sig hvilke.
   - **Referat:** udfyld `skabelon.md` fra denne skills mappe.
     Find ud af, hvem "Taler 1", "Taler 2" osv. er, ud fra tydelige spor i teksten
     (fx når nogen bliver tiltalt ved navn, præsenterer sig eller nævner sin rolle).
     Er du ikke sikker, så vis brugeren et kort uddrag for hver taler, og spørg.

## Regler
- Transskription og referat vises kun i chatten. Opret ingen filer til brugeren.
- Medtag kun det, der faktisk blev sagt. Opfind aldrig beslutninger, opgaver, navne eller datoer.
- Modellen sætter ikke tegn, og taleradskillelsen kan tage fejl. Brug kun navne, når du
  er sikker. Ellers "Taler 2".
- Uforståelige passager: [uklart]. Gæt aldrig. Steder, du er i tvivl om: [usikkert: …]
  med tidspunkt, samlet i afsnittet "Bør tjekkes".
- Skriv kort og konkret på dansk. Beslutninger og opgaver skal kunne forstås uden resten.
- Mærk altid resultatet som maskingenereret (krav i modellens licens, OpenRAIL-M).

## Fejl
- Fejler download, så kør kommandoen igen (download fortsætter). Hjælper det ikke, så
  vis fejlen. Modellerne hentes fra github.com (SundhedsinnovationSI/roest-v3-transskription
  og k2-fsa/sherpa-onnx).
- Fejler lydindlæsning, så prøv at konvertere filen med ffmpeg, hvis det findes.
