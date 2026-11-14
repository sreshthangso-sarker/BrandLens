from typing import Literal, Optional
from pydantic import BaseModel, Field


class BrandPayload(BaseModel):
    brand_name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    tone: str = ""
    preferred_terms: str = ""
    prohibited_terms: str = ""
    approved_facts: str = ""
    guidelines: str = ""


class AnalyzeRequest(BaseModel):
    brand_id: int = Field(..., gt=0)
    title: str = Field(..., min_length=1, max_length=200)
    content_type: str = "General Text"
    content: str = Field(..., min_length=5)
    force_demo: bool = False


class ReviewRequest(BaseModel):
    approval_status: Optional[
        Literal["Pending Review", "Approved Original", "Approved Corrected", "Rejected"]
    ] = None
    corrected_content: Optional[str] = None
    final_content: Optional[str] = None
    review_notes: Optional[str] = None
