"""
SDR domain router — Software Defined Radio.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/sdr", tags=["sdr"])
