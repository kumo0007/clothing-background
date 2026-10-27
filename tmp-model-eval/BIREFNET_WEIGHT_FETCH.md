# BiRefNet weight fetch — reproducible procedure

**Repo:** `studioludens/birefnet-lite-512`  
**Commit observed:** `962e67969ec6acec9c19fab76acee4f5e22e990c`  
**Default host:** `https://huggingface.co`

## Required files (same-origin layout)

| Relative path | Role | Validation |
| --- | --- | --- |
| `config.json` | transformers.js dtype hint | size ≥ 20 B |
| `preprocessor_config.json` | 512² ImageNet mean/std | size ≥ 50 B |
| `LICENSE` | MIT text | size ≥ 50 B |
| `onnx/model_fp16.onnx` | Browser ONNX (fp16) | **exact** 98 484 532 bytes; SHA-256 `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |

SHA-256 / size come from the Git LFS pointer at  
`https://huggingface.co/studioludens/birefnet-lite-512/raw/main/onnx/model_fp16.onnx`  
(do not invent alternate hashes).

Install destination:

```
public/models/studioludens/birefnet-lite-512/
```

## Automated fetch

```bash
npm run fetch:birefnet-weights
```

Env knobs:

| Variable | Meaning |
| --- | --- |
| `HF_ENDPOINT` | HF-compatible base URL (default `https://huggingface.co`) |
| `BIREFNET_FETCH_TIMEOUT_MS` | Per-attempt timeout (default `600000`) |
| `BIREFNET_FETCH_RETRIES` | Bounded retries 1–8 (default `4`) |
| `BIREFNET_FETCH_STRICT=1` | Exit non-zero if mirror incomplete |

Downloads write `*.part` then rename atomically. Incomplete files are deleted.  
`.mirror-meta.json` sets `"ready": true` only after SHA-256 validation.

## Manual download (network-enabled machine)

```bash
mkdir -p public/models/studioludens/birefnet-lite-512/onnx
cd public/models/studioludens/birefnet-lite-512

curl -L -o config.json \
  "https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/config.json"
curl -L -o preprocessor_config.json \
  "https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/preprocessor_config.json"
curl -L -o LICENSE \
  "https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/LICENSE"
curl -L -o onnx/model_fp16.onnx.part \
  "https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/onnx/model_fp16.onnx"

# Validate then promote
# Linux/macOS:
#   shasum -a 256 onnx/model_fp16.onnx.part
# Windows PowerShell:
#   Get-FileHash onnx\model_fp16.onnx.part -Algorithm SHA256
# Expect: eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516
# Expect size: 98484532
mv onnx/model_fp16.onnx.part onnx/model_fp16.onnx
```

Copy the tree into this project’s `public/models/…` path before `npm run build` / `npm run dev`.

## Observed blocker on the agent host (2026-10-27)

| Probe | Result |
| --- | --- |
| `nslookup huggingface.co` | DNS timeouts (resolver `198.18.0.1`) — early probes |
| `curl` HEAD/GET to HF | Intermittent **exit 28** connect timeout |
| Mid-transfer | `curl: (56) schannel: server closed abruptly` at ~54% |
| Recovery | `curl -C -` resume completed; SHA-256 matched; `.mirror-meta.json` `ready: true` |

**Implication:** flaky DNS/TLS to HF is real — use resume + checksum validation. Do not trust truncated `.onnx` files. Manual procedure above remains the offline fallback.

## Preprocessing assumptions (must match checkpoint)

- Resize 512×512, rescale `/255`, ImageNet mean/std  
- Input name `input_image`, NCHW float32  
- Output logits → **sigmoid** → soft alpha; polarity in-app: `255 = KEEP`
