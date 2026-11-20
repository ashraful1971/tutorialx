from __future__ import annotations

import importlib.metadata
import json
import platform
import sys
from typing import Any


def capabilities() -> dict[str, Any]:
    import torch

    devices = ["cpu"]
    if torch.cuda.is_available():
        devices.append("cuda")
    return {
        "version": importlib.metadata.version("whisperx"),
        "pythonVersion": platform.python_version(),
        "devices": devices,
    }


def align(payload: dict[str, Any]) -> dict[str, Any]:
    import whisperx

    device = payload["device"]
    audio = whisperx.load_audio(payload["audioPath"])
    model = whisperx.load_model(
        payload["model"], device, compute_type=payload["computeType"], language=payload["language"]
    )
    transcription = model.transcribe(audio, batch_size=4, language=payload["language"])
    align_model, metadata = whisperx.load_align_model(
        language_code=payload["language"], device=device
    )
    result = whisperx.align(
        transcription["segments"], align_model, metadata, audio, device, return_char_alignments=False
    )
    words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            words.append(
                {
                    "text": str(word.get("word", "")).strip(),
                    "startSeconds": word.get("start"),
                    "endSeconds": word.get("end"),
                }
            )
    return {
        "transcript": " ".join(str(segment.get("text", "")).strip() for segment in result.get("segments", [])).strip(),
        "words": words,
    }


def main() -> None:
    command = sys.argv[1]
    payload = json.load(sys.stdin)
    result = capabilities() if command == "capabilities" else align(payload)
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
