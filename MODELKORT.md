---
library_name: transformers
datasets:
- CoRal-project/coral-v3
language:
- da
base_model:
- facebook/wav2vec2-xls-r-300m
metrics:
- cer
license: openrail
pipeline_tag: automatic-speech-recognition
---

# Røst-v3-wav2vec2-315m

This is a Danish state-of-the-art speech recognition model, trained as part of the CoRal project by the [Alexandra Institute](https://www.alexandra.dk/).

This repository contains a Wav2vec2-XLSR-300M model trained on the [CoRal-v3 dataset](https://huggingface.co/datasets/CoRal-project/coral-v3). 
The CoRal-v3 dataset includes a rich variety of Danish conversational and read-aloud data, distributed across diverse age groups, genders, and dialects. 
The model is designed for automatic speech recognition (ASR).


## Quick Start

Start by installing the required libraries:

```shell
$ pip install transformers
```

Next you can use the model using the `transformers` Python package as follows:

```python
>>> from transformers import pipeline
>>> audio = get_audio()  # 16kHz raw audio array
>>> transcriber = pipeline(model="CoRal-project/roest-v3-wav2vec2-315m")
>>> transcriber(audio)
{'text': 'your transcription'}
```

## Model Details

Wav2vec2 is a state-of-the-art model architecture for speech recognition, leveraging self-supervised learning from raw audio data. 
The pre-trained [Wav2vec2-XLS-R](facebook/wav2vec2-xls-r-300m) has been fine-tuned for automatic speech recognition 
with the [CoRal-v3 dataset](https://huggingface.co/datasets/CoRal-project/coral-v3) dataset to enhance its performance in recognising 
Danish speech with consideration to different dialects. The model was trained using the 
[CoRal model training framework](https://github.com/alexandrainst/coral) by running:

```bash
uv run accelerate launch \
  --use-deepspeed \
  --zero-stage 2 \
  src/scripts/finetune_asr_model.py \
  model=wav2vec2-small \
  per_device_batch_size=64 \
  max_steps=100000
```

Note that the dataset, and thus also this model, is licensed under a custom license, adapted from OpenRAIL-M, which allows 
commercial use with few restrictions (speech synthesis and biometric identification) - see 
[license](https://huggingface.co/Alvenir/coral-1-whisper-large/blob/main/LICENSE).

---

## Evaluation

The model was evaluated using Character Error Rate (CER), which is the percentage of characters incorrectly transcribed.

### Conversational CoRal Performance

| Model                                                                                               | Number of parameters |   Finetuned on data of type | [CoRal-v3::conversation](https://huggingface.co/datasets/CoRal-project/coral-v3/viewer/conversation/test) CER |
| :-------------------------------------------------------------------------------------------------- | -------------------: | --------------------------: | ------------------------------------------------------------------------------------------------------------: |
| [CoRal-project/roest-v3-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v3-whisper-1.5b)   |                1540M | Read-aloud and conversation |                                                                                                     **11.6%** |
| CoRal-project/roest-v3-wav2vec2-315m (this model)                                                   |                 315M | Read-aloud and conversation |                                                                                                       _13.7%_ |
| [CoRal-project/roest-v2-wav2vec2-315m](https://huggingface.co/CoRal-project/roest-v2-wav2vec2-315m) |                 315M | Read-aloud and conversation |                                                                                                         24.2% |
| [CoRal-project/roest-v1-wav2vec2-315m](https://huggingface.co/CoRal-project/roest-v1-wav2vec2-315m) |                 315M |                  Read-aloud |                                                                                                         17.6% |
| [CoRal-project/roest-v1-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v1-whisper-1.5b)   |                1540M |                  Read-aloud |                                                                                                         35.6% |
| [syvai/hviske-v3-conversation](https://huggingface.co/syvai/hviske-v3-conversation)                 |                1540M | Read-aloud and conversation |                                                                                                         15.1% |
| [syvai/hviske-v2](https://huggingface.co/syvai/hviske-v2)                                           |                1540M |                  Read-aloud |                                                                                                         29.4% |
| [openai/whisper-large-v3](https://hf.co/openai/whisper-large-v3)                                    |                1540M |                           - |                                                                                                         27.5% |

<img src="https://cdn-uploads.huggingface.co/production/uploads/60d368a613f774189902f555/EvCjm3ui4t9F0Wq1c_pms.png" width="1000px">


### Read-aloud CoRal Performance 

| Model                                                                                               | Number of parameters |   Finetuned on data of type | [CoRal-v3::read_aloud](https://huggingface.co/datasets/CoRal-project/coral-v3/viewer/read_aloud/test) CER |
| :-------------------------------------------------------------------------------------------------- | -------------------: | --------------------------: | --------------------------------------------------------------------------------------: |
| [CoRal-project/roest-v3-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v3-whisper-1.5b)   |                1540M | Read-aloud and conversation |                                                                                  _4.5%_ |
| CoRal-project/roest-v3-wav2vec2-315m (this model)                                                   |                 315M | Read-aloud and conversation |                                                                                    5.9% |
| [CoRal-project/roest-v2-wav2vec2-315m](https://huggingface.co/CoRal-project/roest-v2-wav2vec2-315m) |                 315M | Read-aloud and conversation |                                                                                    6.4% |
| [CoRal-project/roest-v1-wav2vec2-315m](https://huggingface.co/CoRal-project/roest-v1-wav2vec2-315m) |                 315M |                  Read-aloud |                                                                                    8.2% |
| [CoRal-project/roest-v1-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v1-whisper-1.5b)   |                1540M |                  Read-aloud |                                                                                **4.0%** |
| [syvai/hviske-v3-conversation](https://huggingface.co/syvai/hviske-v3-conversation)                 |                1540M | Read-aloud and conversation |                                                                                  _4.5%_ |
| [syvai/hviske-v2](https://huggingface.co/syvai/hviske-v2)                                           |                1540M |                  Read-aloud |                                                                                **4.0%** |
| [openai/whisper-large-v3](https://hf.co/openai/whisper-large-v3)                                    |                1540M |                           - |                                                                                   10.1% |

<img src="https://cdn-uploads.huggingface.co/production/uploads/60d368a613f774189902f555/duGymBAttMwxAEQ738zEo.png" width="1000px">


## Creators and Funders
This model has been trained and the model card written by [Dan Saattrup Smart](https://huggingface.co/saattrupdan) at the [Alexandra Institute](https://www.alexandra.dk/).

The CoRal project is funded by the [Danish Innovation Fund](https://innovationsfonden.dk/) and consists of the following partners:

- [Alexandra Institute](https://alexandra.dk/)
- [University of Copenhagen](https://www.ku.dk/)
- [Agency for Digital Government](https://digst.dk/)
- [Alvenir](https://www.alvenir.ai/)
- [Corti](https://www.corti.ai/)