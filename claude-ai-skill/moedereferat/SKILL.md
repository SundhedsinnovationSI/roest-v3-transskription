---
name: moedereferat
description: Transskriberer danske lydoptagelser med talegenkendelsesmodellen Røst v3 og laver mødereferater med talere. Brug den, når brugeren uploader en lydfil (m4a, mp3, wav m.fl.), også uden yderligere besked, eller beder om transskription eller referat. Spørg altid først, hvor mange personer der taler.
---

# Transskription og mødereferat med Røst v3

Når brugeren uploader en lydfil, leverer du ét af to resultater:
- **Referat**, hvis brugeren beder om det, eller hvis optagelsen er et møde
  (flere talere, drøftelser, beslutninger eller opgaver).
- **Transskription**, hvis brugeren beder om det, eller hvis optagelsen ikke er et møde
  (fx én person, der dikterer eller taler).

## Fremgangsmåde

1. **Spørg altid først**, hver gang der uploades en lydfil, og før lydfilen bearbejdes:
   "Hvor mange personer taler i optagelsen?" Vis valgmulighederne (brug platformens
   værktøj til valgmuligheder, hvis det findes, ellers en nummereret liste):
   1. 1 person
   2. 2 personer
   3. 3 personer
   4. 4 personer
   5. 5 personer
   6. 6 eller flere (skriv antallet)
   7. Ved ikke
   Vent på svaret, før du går videre. Har brugeren allerede skrevet et antal i beskeden,
   så spørg alligevel, og nævn antallet: "Du skrev 3 personer. Er det korrekt?"
   med de samme valgmuligheder.
2. Installer værktøjer: `pip install -q numpy sherpa-onnx av`
3. Kør scriptet `scripts/roest.py` fra denne skills mappe **i forgrunden** (ikke i baggrunden):
   `python3 <skillmappe>/scripts/roest.py "<lydfil>" --talere <antal>`
   Brug det antal, brugeren har valgt. Ved "Ved ikke" bruges `--talere 0`
   (scriptet gætter selv).
   Scriptet stopper selv efter ca. 7 minutter og gemmer sit fremskridt. Skriver det
   "IKKE FÆRDIG", så kør **præcis samme kommando** igen. Det fortsætter, hvor det slap.
   Gentag, indtil teksten kommer. Ved lange optagelser må du skrive én kort linje om,
   hvor langt den er (fx "40 af 120 bidder, ca. 25 min. tilbage").
4. Læs resultatet direkte fra kommandoens output. Midlertidigt fremskridt slettes
   automatisk, når teksten er færdig.
5. Vælg referat eller transskription (se øverst), og vis **kun** resultatet i chatten.

## Sådan ser resultatet ud

**Transskription:**
- Overskrift: **Transskription** *(maskingenereret med Røst v3, ikke rettet af et menneske)*
- Modellens tekst uændret. Er der flere talere, så behold tidspunkter og "Taler 1",
  "Taler 2" osv. Er der kun én taler, så udelad taleretiketterne.
- Overskrift: **Læsevenlig udgave**, med tegnsætning og rettede åbenlyse stave- og
  høre-fejl.
- Til sidst evt. **Bør tjekkes**: korte punkter med de steder, der er uklare.

**Referat:** Udfyld `skabelon.md` fra denne skills mappe.
- Find ud af, hvem "Taler 1", "Taler 2" osv. er, ud fra tydelige spor i teksten
  (fx når nogen bliver tiltalt ved navn, præsenterer sig eller nævner sin rolle).
  Har brugeren oplyst deltagernes navne, så brug dem, når det er tydeligt, hvem der er hvem.
- Er titel, dato eller deltagere ukendte, så skriv [ikke oplyst].
- Har brugeren svaret "Ved ikke", så er antallet af talere gættet og ofte for højt
  (samme person kan blive delt i flere talere). Slå talere sammen, når teksten tydeligt
  viser, at det er samme person, og skriv under "Bør tjekkes":
  "Antallet af talere er gættet."

## Regler
- Vis kun resultatet. Ingen indledning, ingen vurdering af optagelsen eller af skillen,
  ingen forklaring af fremgangsmåden og intet forslag til næste skridt.
- Opret ingen filer til brugeren. Resultatet vises kun i chatten.
- Medtag kun det, der faktisk blev sagt. Opfind aldrig beslutninger, opgaver, navne eller datoer.
- Modellen sætter ikke tegn, og taleradskillelsen kan tage fejl. Brug kun navne, når du
  er sikker. Ellers "Taler 2".
- Uforståelige passager: [uklart]. Gæt aldrig. Steder, du er i tvivl om, samles under
  "Bør tjekkes" med tidspunkt.
- Skriv kort og konkret på dansk.
- Mærk altid resultatet som maskingenereret (krav i modellens licens, OpenRAIL-M).

## Fejl
- Fejler download, så kør kommandoen igen (download fortsætter). Hjælper det ikke, så
  vis fejlen kort. Modellerne hentes fra github.com (SundhedsinnovationSI/roest-v3-transskription
  og k2-fsa/sherpa-onnx).
- Fejler lydindlæsning, så prøv at konvertere filen med ffmpeg, hvis det findes.
