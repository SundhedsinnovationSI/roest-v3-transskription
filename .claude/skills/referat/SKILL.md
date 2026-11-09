---
name: referat
description: Laver et mødereferat med talere ud fra en lydoptagelse af et møde. Brug den, når brugeren uploader en mødeoptagelse og beder om et referat.
---

# Mødereferat fra lydoptagelse

1. Har brugeren ikke oplyst mødets titel, dato, deltagere og dagsorden, så spørg om det i én kort besked.
   Antallet af deltagere, der siger noget, er nødvendigt for at skelne stemmerne.
2. Installer værktøjer, hvis de mangler: `pip install -q torch transformers sherpa-onnx`
3. Transskriber (en times møde tager ca. 30 min, så kør kommandoen i baggrunden):
   `python3 .claude/skills/referat/talere.py "<lydfil>" <antal deltagere>`
   Læs resultatet direkte fra kommandoens output.
4. Find ud af, hvem "Taler 1", "Taler 2" osv. er, ud fra tydelige spor i teksten
   (fx når nogen bliver tiltalt ved navn, præsenterer sig eller nævner sin rolle).
   Er du ikke sikker, så vis brugeren et kort uddrag for hver taler, og spørg.
5. Skriv referatet efter `skabelon.md` i denne mappe, og vis det kun i chatten.

## Regler
- Gem aldrig transskription eller referat i en fil. Begge dele vises kun i chatten.
- Medtag kun det, der faktisk blev sagt. Opfind aldrig beslutninger, opgaver, navne eller datoer.
- Transskriptionen har ingen tegnsætning, og taleradskillelsen kan tage fejl.
  Brug kun navne, når du er sikker. Ellers "Taler 2".
- Uforståelige passager: [uklart]. Steder, du er i tvivl om: [usikkert: …] med tidspunkt,
  samlet i afsnittet "Bør tjekkes".
- Skriv kort og konkret på dansk. Beslutninger og opgaver skal kunne forstås uden resten af referatet.
- Mærk referatet som maskingenereret (krav i LICENSE).
- Commit aldrig `talermodeller/`. Repoet er offentligt.
