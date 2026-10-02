"""
Snap Notes OCR endpoint for Modal (optional, for advanced users).

Deploys an open-source document-OCR vision-language model behind an OpenAI-compatible HTTP API
(`POST /v1/chat/completions`, `GET /v1/models`) in YOUR Modal account. Snap Notes talks to it over
HTTPS only (no Modal SDK in the app) and treats it as an OCR engine: screenshot in, Markdown out.

Deploy:   modal deploy integrations/modal/snap_notes_ocr.py
Endpoint: https://<workspace>--snap-notes-ocr-serve.modal.run

Access is protected by Modal Proxy Auth Tokens (Modal-Key / Modal-Secret headers). Create a token at
https://modal.com/settings/proxy-auth-tokens and enter Token ID, Token Secret and the endpoint in
Snap Notes → Settings → ИИ и распознавание → Modal OCR.

Settings (environment variables at deploy time, all optional):
  SNAP_NOTES_OCR_MODEL  Hugging Face model id. Default: dots-studio/dots.ocr (dots.ocr, 1.7B, 100+ languages).
                        Any vLLM-supported vision-language model works (for example another document-OCR VLM).
  SNAP_NOTES_OCR_GPU    Modal GPU type. Default: L4 (24 GB is plenty for a ~2B model).
  SNAP_NOTES_OCR_IDLE   Seconds the container stays warm after the last request. Default: 300.

Nothing here is started automatically: the container runs (and is billed by Modal) only while it
serves requests and during the idle window.
"""

import os
import subprocess

import modal

MINUTES = 60
PORT = 8000

MODEL = os.environ.get("SNAP_NOTES_OCR_MODEL", "dots-studio/dots.ocr")
GPU = os.environ.get("SNAP_NOTES_OCR_GPU", "L4")
IDLE_SECONDS = int(os.environ.get("SNAP_NOTES_OCR_IDLE", "300"))

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    # dots.ocr is supported by vLLM >= 0.11; pin to a version you have tested.
    .uv_pip_install("vllm==0.21.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1", "SNAP_NOTES_OCR_MODEL": MODEL})
)

# Model weights are downloaded once and cached between cold starts.
hf_cache = modal.Volume.from_name("snap-notes-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("snap-notes-vllm-cache", create_if_missing=True)

app = modal.App("snap-notes-ocr")


@app.function(
    image=image,
    gpu=GPU,
    scaledown_window=IDLE_SECONDS,
    timeout=10 * MINUTES,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=PORT, startup_timeout=10 * MINUTES, requires_proxy_auth=True)
def serve():
    """Starts `vllm serve` inside the container; Modal proxies HTTPS requests to it."""
    command = [
        "vllm",
        "serve",
        MODEL,
        "--served-model-name",
        MODEL,
        "--host",
        "0.0.0.0",
        "--port",
        str(PORT),
        # dots.ocr ships custom model code and expects plain string chat content.
        "--trust-remote-code",
        "--chat-template-content-format",
        "string",
        "--max-model-len",
        "16384",
        "--gpu-memory-utilization",
        "0.85",
    ]
    subprocess.Popen(command)
