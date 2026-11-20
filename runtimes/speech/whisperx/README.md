# Optional WhisperX runtime

This runtime is not installed with TutorialX core and never downloads a model during base package
installation. It pins WhisperX 3.8.6 in `pyproject.toml`; `uv.lock` freezes the complete Python
environment for Python 3.10 through 3.13.

Install only when local alignment is selected:

```sh
uv sync --frozen --python 3.12
```

The selected transcription and language-specific alignment models may download on the first
explicit alignment run. Review their licenses, sizes, and network requirements before authorizing
that run. CPU mode uses `device: "cpu"` with `computeType: "int8"` and is supported but can be slow.
CUDA remains an explicit separate configuration.

The Node adapter launches `worker.py` with isolated Python mode, bounded JSON input/output, an
operation deadline, and forceful cancellation. Only an explicit environment map is added beyond
`PATH` and `LANG`; portable job records never carry tokens or model-cache credentials.
