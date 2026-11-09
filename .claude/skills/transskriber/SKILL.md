---
name: transskriber
description: Transskriberer danske lydoptagelser (m4a, mp3, wav m.fl.) med Røst v3-modellen i dette repo. Brug den, når brugeren uploader en lydfil og beder om transskription.
---

# Transskription med Røst v3

1. Installer værktøjer, hvis de mangler: `pip install -q torch transformers`
2. Kør fra repoets rod: `python3 .claude/skills/transskriber/transskriber.py "<sti til lydfil>"`
   Modelfilen hentes automatisk fra Releases første gang.
3. Vis resultatet sådan:
   - **Modellens tekst** uændret, mærket: *(maskingenereret med Røst v3, ikke rettet af et menneske)*
   - **Læsevenlig udgave** med tegnsætning. Ret kun åbenlyse fejl, og sig hvilke.
     Ord, der ikke kan forstås, skrives som [uklart]. Gæt aldrig.
4. Svar på dansk.
5. Commit aldrig `model.safetensors` (631 MB). Den ligger under Releases.
