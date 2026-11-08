"""本地 ASR：把 16k 单声道 wav 转成中文文字。

用法：
  python asr.py <audio.wav> [model]
输出：纯文本到 stdout。
"""
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel


def main():
    path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    lang_arg = sys.argv[3] if len(sys.argv) > 3 else "zh"
    language = None if lang_arg == "auto" else lang_arg
    with wave.open(path, "rb") as f:
        if f.getframerate() != 16000 or f.getnchannels() != 1:
            raise SystemExit("需要 16k 单声道 wav")
        frames = f.readframes(f.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        vad_filter=True,
        initial_prompt="B站视频 抖音视频 大肥鱼 主人 白米饭",
    )
    texts = [seg.text.strip() for seg in segments if seg.text.strip()]
    print("".join(texts), flush=True)


if __name__ == "__main__":
    main()
