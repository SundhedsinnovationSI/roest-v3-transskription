# Modeller til websiden

| Fil | Indhold | Kilde | Licens |
|---|---|---|---|
| `roest-int8-del0.bin` … `del3.bin` | Røst v3 som ONNX, int8-komprimeret, delt i fire filer (samlet 356.244.130 bytes) | [CoRal-project/roest-v3-wav2vec2-315m](https://huggingface.co/CoRal-project/roest-v3-wav2vec2-315m) | Tilpasset OpenRAIL-M, se [LICENSE](../../LICENSE) |
| `segmentering.onnx` | pyannote segmentation 3.0 (ONNX-udgave fra sherpa-onnx) | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models) | MIT, se `segmentering.LICENSE` |
| `campplus.onnx` | CAM++ stemmegenkendelse fra 3D-Speaker (ONNX-udgave fra sherpa-onnx) | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models) | Apache 2.0 (3D-Speaker) |

## Ændringer i forhold til Røst v3

Røst-filerne er en **bearbejdet udgave** af den originale model (`model.safetensors` under Releases):

1. Eksporteret fra PyTorch til ONNX (opset 17) med `torch.onnx.export`, så den kan køre i en browser.
2. Komprimeret med `onnxruntime.quantization.quantize_dynamic` (vægte som uint8 pr. kanal,
   kun MatMul-lag), så filen fylder 339 MB i stedet for 1,26 GB.
3. Delt i fire filer på højst 90 MB, fordi GitHub ikke tillader filer over 100 MB.
   Websiden sætter dem sammen igen.

Komprimeringen ændrer resultatet en smule. På et testklip var ordfejlraten 20,0 % mod 19,5 %
for den originale model. Modelvægtene er ikke trænet videre.

## Licens og brugsbegrænsninger

Den bearbejdede model er omfattet af samme licens som originalen (tilpasset OpenRAIL-M, se
[LICENSE](../../LICENSE)). Alle brugere er bundet af licensens brugsbegrænsninger, jf. punkt 5 og
Attachment A, herunder kravet om at mærke maskingenereret indhold som maskingenereret.
