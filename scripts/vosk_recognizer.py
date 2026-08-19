#!/usr/bin/env python3
"""
Simple Vosk microphone recognizer that prints one recognized phrase per line.
Usage: python vosk_recognizer.py [MODEL_PATH]
If MODEL_PATH omitted, uses environment variable VOSK_MODEL_PATH or 'models/vosk-model-small-en-us-0.15'
"""
import sys
import os
import queue
import json

try:
    from vosk import Model, KaldiRecognizer
    import sounddevice as sd
except Exception as e:
    print(f"IMPORT_ERROR: {e}", file=sys.stderr)
    raise

model_path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('VOSK_MODEL_PATH', os.path.join('models', 'vosk-model-small-en-us-0.15'))
if not os.path.exists(model_path):
    print(f"MODEL_NOT_FOUND:{model_path}", file=sys.stderr)
    sys.exit(2)

samplerate = 16000
q = queue.Queue()

def callback(indata, frames, time, status):
    if status:
        print(f"STATUS:{status}", file=sys.stderr)
    q.put(bytes(indata))

try:
    model = Model(model_path)
    rec = KaldiRecognizer(model, samplerate)
except Exception as e:
    print(f"MODEL_LOAD_ERROR: {e}", file=sys.stderr)
    sys.exit(3)

print("VOSK_READY", flush=True)

with sd.RawInputStream(samplerate=samplerate, blocksize=8000, dtype='int16', channels=1, callback=callback):
    while True:
        data = q.get()
        if rec.AcceptWaveform(data):
            try:
                res = json.loads(rec.Result())
                text = res.get('text', '').strip()
                if text:
                    print(text, flush=True)
            except Exception:
                # ignore JSON parse errors
                pass
        else:
            # partial = rec.PartialResult()
            # optionally handle partial results
            pass
