"""StatAssay API — upload a CSV, get an automatic statistical inference report.

A single synchronous endpoint. A full sweep of a <=40-column frame completes in a few
seconds; streaming progress for very large files is future work.
"""

import io
import logging

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from inference import run_inference

logger = logging.getLogger("statassay")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MiB

app = FastAPI(title="StatAssay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "service": "statassay"}


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (limit is 25 MB).")
    if not content.strip():
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    try:
        df = pd.read_csv(io.BytesIO(content))
        raw_df = pd.read_csv(
            io.BytesIO(content), dtype=str, keep_default_na=False, na_filter=False
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    if df.shape[0] == 0 or df.shape[1] == 0:
        raise HTTPException(status_code=400, detail="The CSV has no rows or no columns.")

    try:
        return run_inference(df, raw_df, file.filename or "uploaded.csv")
    except Exception as exc:  # defensive catch-all
        logger.exception("run_inference failed for %r", file.filename)
        raise HTTPException(status_code=500, detail="Analysis failed while processing this file.") from exc
