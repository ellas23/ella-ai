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
    import numpy as np
except Exception:
    np = None
 
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
voice_gain = float(os.environ.get('VOSK_GAIN', '3.5'))
noise_floor = float(os.environ.get('VOSK_NOISE_FLOOR', '25'))

def amplify_audio(indata):
    if np is None:
        return bytes(indata)
    audio = np.frombuffer(indata, dtype=np.int16).astype(np.float32)
    if audio.size == 0:
        return bytes(indata)
    peak = np.abs(audio).mean()
    if peak < noise_floor:
        return b''
    boosted = audio * voice_gain
    boosted = np.clip(boosted, -32768, 32767)
    return boosted.astype(np.int16).tobytes()

def callback(indata, frames, time, status):
    if status:
        print(f"STATUS:{status}", file=sys.stderr)
    payload = amplify_audio(indata)
    if payload:
        q.put(payload)

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
                    # Basic filtering: ignore single short filler words to avoid accidental wakeups
                    lower = text.lower()
                    filler_blacklist = {'huh','hmm','uh','um','ah','oh','la','laa','mm','ha','haah','haha','sing','singing','la-la','laa','mmh'}
                    words = lower.split()
                    # If it's a single short token or a known filler, skip it
                    if len(words) < 2:
                        if lower in filler_blacklist or len(lower) < 4:
                            # ignore likely non-addressed speech (e.g., "huh", "uh", short noises)
                            continue
                    print(text, flush=True)
            except Exception:
                # ignore JSON parse errors
                pass
        else:
            # partial = rec.PartialResult()
            # optionally handle partial results
            pass
