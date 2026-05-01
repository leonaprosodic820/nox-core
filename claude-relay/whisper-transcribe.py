#!/usr/bin/env python3
"""PROMETHEUS Whisper — Transcription audio locale"""
import sys, os
import whisper

def transcribe(audio_path):
    try:
        model = whisper.load_model("small")
        result = model.transcribe(audio_path, language="fr", fp16=False, verbose=False)
        print(result["text"].strip())
        return 0
    except Exception as e:
        print(f"WHISPER_ERROR: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: whisper-transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(sys.argv[1]):
        print(f"WHISPER_ERROR: Not found: {sys.argv[1]}", file=sys.stderr)
        sys.exit(1)
    sys.exit(transcribe(sys.argv[1]))
