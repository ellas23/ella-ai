#!/usr/bin/env python3
"""Local microphone recognizer for Ella using faster-whisper.

The model is loaded once at startup. Audio is collected into short utterances
using an energy gate, then faster-whisper's built-in Silero VAD filters silence
before transcription. Completed transcript text is printed one line at a time
for the desktop orb to consume.
"""

from __future__ import annotations

import os
import queue
import sys
import time
import json
from pathlib import Path
from typing import Optional

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download


SAMPLE_RATE = int(os.environ.get("ELLA_SAMPLE_RATE", "16000"))
BLOCK_SIZE = int(os.environ.get("ELLA_AUDIO_BLOCK_SIZE", "1600"))
START_THRESHOLD = float(os.environ.get("ELLA_START_THRESHOLD", "120"))
SILENCE_SECONDS = float(os.environ.get("ELLA_SILENCE_SECONDS", "0.8"))
MAX_UTTERANCE_SECONDS = float(os.environ.get("ELLA_MAX_UTTERANCE_SECONDS", "20"))
RUNTIME_CONFIG_FILE = Path(__file__).resolve().parents[1] / "data" / "runtime_config.json"
try:
    _runtime = json.loads(RUNTIME_CONFIG_FILE.read_text(encoding="utf-8")) if RUNTIME_CONFIG_FILE.exists() else {}
except (OSError, json.JSONDecodeError):
    _runtime = {}
_voice_config = _runtime.get("voice", {}) if isinstance(_runtime, dict) else {}
MODEL_NAME = os.environ.get("FASTER_WHISPER_MODEL", _voice_config.get("model", "medium.en"))
MODEL_DIR = Path(
    os.environ.get(
        "FASTER_WHISPER_MODEL_DIR",
        str(Path(__file__).resolve().parents[1] / "models" / f"faster-whisper-{MODEL_NAME}"),
    )
)
DEVICE = os.environ.get("FASTER_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.environ.get("FASTER_WHISPER_BEAM_SIZE", str(_voice_config.get("beamSize", 5))))
VAD_ENABLED = str(os.environ.get("FASTER_WHISPER_VAD", str(_voice_config.get("vad", True))).lower()) not in {"0", "false", "no"}
MIC_CONFIG = _voice_config.get("microphone", {}) if isinstance(_voice_config, dict) else {}
CLAP_CONFIG = _voice_config.get("doubleClap", {}) if isinstance(_voice_config, dict) else {}
STATUS_FILE = Path(__file__).resolve().parents[1] / "data" / "voice_status.json"
CLAP_ENABLED = str(os.environ.get("ELLA_DOUBLE_CLAP_ENABLED", str(CLAP_CONFIG.get("enabled", False))).lower()) not in {"0", "false", "no"}
CLAP_SPIKE_RATIO = max(2.0, float(os.environ.get("ELLA_DOUBLE_CLAP_SPIKE_RATIO", str(CLAP_CONFIG.get("spikeRatio", 7.0)))))
CLAP_MIN_LEVEL = max(1.0, float(os.environ.get("ELLA_DOUBLE_CLAP_MIN_LEVEL", str(CLAP_CONFIG.get("minLevel", 400)))))
CLAP_COOLDOWN = max(0.1, float(os.environ.get("ELLA_DOUBLE_CLAP_COOLDOWN", str(CLAP_CONFIG.get("cooldownSeconds", 0.8)))))
CLAP_MIN_GAP = max(0.02, float(os.environ.get("ELLA_DOUBLE_CLAP_MIN_GAP", str(CLAP_CONFIG.get("minGapSeconds", 0.05)))))
CLAP_MAX_GAP = max(CLAP_MIN_GAP, float(os.environ.get("ELLA_DOUBLE_CLAP_MAX_GAP", str(CLAP_CONFIG.get("maxGapSeconds", 0.35)))))
MICROPHONE_DEVICE = os.environ.get("ELLA_MICROPHONE_DEVICE", str(MIC_CONFIG.get("device", ""))).strip()


def write_error(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def write_status(**patch: object) -> None:
    current: dict = {}
    try:
        if STATUS_FILE.exists():
            loaded = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                current = loaded
    except (OSError, json.JSONDecodeError):
        current = {}
    current.update(patch)
    current["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATUS_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(current, indent=2), encoding="utf-8")
        temporary.replace(STATUS_FILE)
    except OSError as exc:
        write_error(f"VOICE_STATUS_ERROR: {exc}")


def input_devices() -> list[dict]:
    devices = []
    for index, device in enumerate(sd.query_devices()):
        if int(device.get("max_input_channels", 0)) >= 1:
            devices.append({"index": index, "name": str(device.get("name", "")), "hostApi": int(device.get("hostapi", -1))})
    return devices


def resolve_microphone() -> tuple[int, list[dict]]:
    devices = input_devices()
    if not devices:
        raise RuntimeError("No microphone input devices are available.")
    selected: Optional[int] = None
    if MICROPHONE_DEVICE:
        if MICROPHONE_DEVICE.isdigit():
            candidate = int(MICROPHONE_DEVICE)
            if any(item["index"] == candidate for item in devices):
                selected = candidate
        else:
            needle = MICROPHONE_DEVICE.lower()
            selected = next((item["index"] for item in devices if needle in item["name"].lower()), None)
        if selected is None:
            raise RuntimeError(f"Configured microphone '{MICROPHONE_DEVICE}' was not found.")
    else:
        default = sd.default.device[0]
        if isinstance(default, int) and default >= 0 and any(item["index"] == default for item in devices):
            selected = default
        else:
            selected = devices[0]["index"]
    candidates = [selected] + [item["index"] for item in devices if item["index"] != selected]
    probe_errors = []
    for candidate in candidates:
        try:
            with sd.InputStream(device=candidate, samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=BLOCK_SIZE):
                selected = candidate
                break
        except Exception as exc:
            probe_errors.append(f"{candidate}: {exc}")
    else:
        raise RuntimeError(f"No microphone could be opened ({'; '.join(probe_errors)})")
    selected_name = next(item["name"] for item in devices if item["index"] == selected)
    write_status(
        status="SELECTED",
        selectedDevice={"index": selected, "name": selected_name},
        availableDevices=devices,
        doubleClap={"enabled": CLAP_ENABLED, "spikeRatio": CLAP_SPIKE_RATIO, "minLevel": CLAP_MIN_LEVEL, "cooldownSeconds": CLAP_COOLDOWN, "minGapSeconds": CLAP_MIN_GAP, "maxGapSeconds": CLAP_MAX_GAP},
        model=MODEL_NAME,
        error=None,
    )
    return selected, devices


def transcribe(model: WhisperModel, audio: np.ndarray) -> None:
    if audio.size == 0:
        return

    try:
        segments, _info = model.transcribe(
            audio,
            language="en",
            beam_size=BEAM_SIZE,
            vad_filter=VAD_ENABLED,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
        )
        # faster-whisper returns a lazy generator; consuming it performs inference.
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        if text:
            print(text, flush=True)
    except Exception as exc:
        write_error(f"TRANSCRIBE_ERROR: {exc}")


def load_model() -> WhisperModel:
    """Resolve a local model directory, downloading it once without symlinks."""
    model_path = Path(MODEL_NAME)
    if model_path.exists():
        resolved = str(model_path.resolve())
    else:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        resolved = str(
            snapshot_download(
                repo_id=f"Systran/faster-whisper-{MODEL_NAME}",
                local_dir=str(MODEL_DIR),
                local_dir_use_symlinks=False,
            )
        )

    write_error(f"Loading faster-whisper model={resolved} device={DEVICE} compute_type={COMPUTE_TYPE}")
    return WhisperModel(resolved, device=DEVICE, compute_type=COMPUTE_TYPE)


def main() -> int:
    try:
        input_device, _devices = resolve_microphone()
    except Exception as exc:
        write_status(status="ERROR", error=f"MICROPHONE_ERROR: {exc}")
        write_error(f"MICROPHONE_ERROR: {exc}")
        return 4
    try:
        model = load_model()
    except Exception as exc:
        write_status(status="ERROR", error=f"MODEL_LOAD_ERROR: {exc}")
        write_error(f"MODEL_LOAD_ERROR: {exc}")
        return 3

    audio_queue: queue.Queue[np.ndarray] = queue.Queue()

    def callback(indata: np.ndarray, _frames: int, _time: object, status: object) -> None:
        if status:
            write_error(f"AUDIO_STATUS: {status}")
        audio_queue.put(indata.copy().reshape(-1))

    try:
        with sd.InputStream(
            device=input_device,
            samplerate=SAMPLE_RATE,
            blocksize=BLOCK_SIZE,
            dtype="int16",
            channels=1,
            callback=callback,
        ):
            print("FASTER_WHISPER_READY", flush=True)
            write_status(status="READY", error=None, recognizerPid=os.getpid())
            chunks: list[np.ndarray] = []
            speaking = False
            silence_started: Optional[float] = None
            utterance_started = 0.0
            clap_noise_floor = 1.0
            clap_armed = True
            first_clap_time: Optional[float] = None
            last_clap_time = 0.0

            while True:
                chunk = audio_queue.get()
                level = float(np.mean(np.abs(chunk))) if chunk.size else 0.0
                now = time.monotonic()

                if CLAP_ENABLED:
                    clap_noise_floor = min(clap_noise_floor * 0.995 + level * 0.005, max(level, 1.0))
                    clap_threshold = max(CLAP_MIN_LEVEL, clap_noise_floor * CLAP_SPIKE_RATIO)
                    if level < clap_threshold * 0.55:
                        clap_armed = True
                    if clap_armed and level >= clap_threshold and now - last_clap_time >= CLAP_COOLDOWN:
                        clap_armed = False
                        if first_clap_time is None or now - first_clap_time > CLAP_MAX_GAP:
                            first_clap_time = now
                        else:
                            gap = now - first_clap_time
                            if CLAP_MIN_GAP <= gap <= CLAP_MAX_GAP:
                                first_clap_time = None
                                last_clap_time = now
                                print("DOUBLE_CLAP", flush=True)
                                write_status(lastDoubleClapAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), status="READY")

                if not speaking:
                    if level < START_THRESHOLD:
                        continue
                    speaking = True
                    utterance_started = now
                    silence_started = None
                    chunks = []

                chunks.append(chunk)
                if level < START_THRESHOLD:
                    silence_started = silence_started or now
                else:
                    silence_started = None

                silence_done = silence_started is not None and now - silence_started >= SILENCE_SECONDS
                max_duration = now - utterance_started >= MAX_UTTERANCE_SECONDS
                if silence_done or max_duration:
                    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
                    transcribe(model, audio)
                    chunks = []
                    speaking = False
                    silence_started = None
    except Exception as exc:
        write_status(status="ERROR", error=f"MICROPHONE_ERROR: {exc}")
        write_error(f"MICROPHONE_ERROR: {exc}")
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
