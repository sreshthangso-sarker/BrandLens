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
    content: str = Field(..., min_length=1)
    title: Optional[str] = None
    content_type: Optional[str] = None
    source_type: str = "text"
    detected_language: Optional[str] = None
    force_demo: bool = False


class ReviewRequest(BaseModel):
    # Issue-level review fields (Module 3)
    decision: Optional[Literal["pending", "accepted", "rejected"]] = None
    reviewer_reason: Optional[str] = None
    correction_decision: Optional[Literal["pending", "accepted", "rejected", "edited"]] = None
    final_corrected_text: Optional[str] = None
    # Content-level review fields (legacy fallback)
    approval_status: Optional[
        Literal["Pending Review", "Approved Original", "Approved Corrected", "Rejected"]
    ] = None
    corrected_content: Optional[str] = None
    final_content: Optional[str] = None
    review_notes: Optional[str] = None


class ApproveContentRequest(BaseModel):
    approval_status: Literal[
        "Pending Review", "Approved Original", "Approved Corrected", "Rejected"
    ] = "Approved Corrected"
    corrected_content: Optional[str] = None
    final_content: Optional[str] = None
    review_notes: Optional[str] = None


class SuggestionGenerateRequest(BaseModel):
    brand_id: int = Field(..., gt=0)


class SuggestionApproveRequest(BaseModel):
    proposed_guideline: Optional[str] = None


class SuggestionRejectRequest(BaseModel):
    reason: Optional[str] = None
