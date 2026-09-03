"""Automatic statistical inference pipeline.

Public entry point: ``run_inference(df, raw_df, filename) -> dict``.
"""

from .report import TOOL_VERSION, run_inference

__all__ = ["run_inference", "TOOL_VERSION"]
