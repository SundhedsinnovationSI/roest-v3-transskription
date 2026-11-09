# Røst v3 wav2vec2 315m – kopi til transskription

Uændret kopi af den danske talegenkendelsesmodel
CoRal-project/roest-v3-wav2vec2-315m fra CoRal-projektet
(Alexandra Instituttet m.fl., finansieret af Innovationsfonden).

Original: https://huggingface.co/CoRal-project/roest-v3-wav2vec2-315m

Kopien bruges af Sundhedsinnovation, Region Sjælland, til transskription
af mødeoptagelser. Selve modelfilen (model.safetensors) ligger under
Releases.

## Licens og brugsbegrænsninger

Modellen er omfattet af licensen i filen LICENSE (tilpasset OpenRAIL-M).
Alle brugere af denne kopi er bundet af licensens brugsbegrænsninger,
jf. punkt 5 og Attachment A, herunder kravet om at mærke
maskingenereret indhold som maskingenereret.

Filerne i roden og under Releases er ikke ændret i forhold til originalen. MODELKORT.md er
originalens README.md, omdøbt.

## Webside til transskription af møder

Mappen `docs/` er en webside, der transskriberer mødeoptagelser med talere direkte i browseren
(lyden forlader ikke computeren). Den udgives med GitHub Pages:
https://sundhedsinnovationsi.github.io/roest-v3-transskription/

Vejledning til brugere: [docs/VEJLEDNING.md](docs/VEJLEDNING.md).
Websiden bruger en bearbejdet (int8-komprimeret ONNX) udgave af modellen. Ændringerne er beskrevet
i [docs/modeller/README.md](docs/modeller/README.md). Den er omfattet af samme licens.
