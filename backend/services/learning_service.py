import json
import os
from typing import Any, Dict, List
from services.gemini_service import is_gemini_configured

ALLOWED_FIELDS = {
    "tone",
    "preferred_terms",
    "prohibited_terms",
    "approved_facts",
    "guidelines",
}


def _to_decision_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "review_id": row["review_id"],
        "issue_id": row["issue_db_id"],
        "issue_type": row["issue_type"],
        "decision": row["decision"],
        "original_text": row["original_text"],
        "reviewer_reason": row["reviewer_reason"],
    }


def generate_demo_guideline_suggestions(
    brand: Dict[str, Any], reviews: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    suggestions: List[Dict[str, Any]] = []
    reviewed = [r for r in reviews if r["decision"] in ("accepted", "rejected")]
    if not reviewed:
        return suggestions

    rejected = [r for r in reviewed if r["decision"] == "rejected"]
    if rejected:
        tone_rejections = [
            r
            for r in rejected
            if "tone" in r["issue_type"].lower() or "tone" in r["brand_rule"].lower()
        ]
        if tone_rejections:
            sample_reason = next(
                (r["reviewer_reason"] for r in tone_rejections if r["reviewer_reason"]),
                "Conversational phrasing was marked acceptable by reviewers.",
            )
            existing = brand.get("tone") or "Friendly, modern and professional"
            proposed = (
                existing
                if "social" in existing.lower()
                else f"{existing}; conversational and engaging phrasing is acceptable for social media posts"
            )
            suggestions.append(
                {
                    "target_field": "tone",
                    "existing_guideline": existing,
                    "proposed_guideline": proposed,
                    "reason": f'Reviewers rejected {len(tone_rejections)} tone flag(s) (e.g. "{sample_reason}"). Clarifying channel tone flexibility prevents recurring false positives.',
                    "related_decisions": [_to_decision_summary(r) for r in tone_rejections[:4]],
                }
            )
        else:
            first = rejected[0]
            existing = brand.get("guidelines") or "Avoid exaggerated marketing claims."
            reason_note = (
                first["reviewer_reason"]
                or "Reviewer marked this detection as acceptable in context."
            )
            suggestions.append(
                {
                    "target_field": "guidelines",
                    "existing_guideline": existing,
                    "proposed_guideline": f"{existing} Exception note: {reason_note}",
                    "reason": f'Reviewer(s) rejected {len(rejected)} AI finding(s) as false positives ({first["issue_type"]}: "{first["original_text"]}").',
                    "related_decisions": [_to_decision_summary(r) for r in rejected[:4]],
                }
            )

    accepted = [r for r in reviewed if r["decision"] == "accepted"]
    if accepted:
        prohibited_acc = [r for r in accepted if "prohibited" in r["issue_type"].lower()]
        unverified_acc = [
            r
            for r in accepted
            if "unsupported" in r["issue_type"].lower()
            or "unverified" in r["issue_type"].lower()
        ]
        other_acc = [
            r for r in accepted if r not in prohibited_acc and r not in unverified_acc
        ]

        if prohibited_acc:
            edited = [
                f'"{r["original_text"]}" -> "{r["final_corrected_text"]}"'
                for r in prohibited_acc
                if r["correction_decision"] == "edited" and r["final_corrected_text"]
            ]
            flagged = list(dict.fromkeys(f'"{r["original_text"]}"' for r in prohibited_acc))[:3]
            existing = brand.get("guidelines") or "Avoid exaggerated marketing claims."
            extra = (
                f" Use reviewer-approved alternatives such as {edited[0]}."
                if edited
                else f" Strictly replace flagged terms ({', '.join(flagged)}) with neutral, factual phrasing."
            )
            suggestions.append(
                {
                    "target_field": "guidelines",
                    "existing_guideline": existing,
                    "proposed_guideline": f"{existing}{extra}",
                    "reason": f"Reviewers confirmed {len(prohibited_acc)} prohibited-term violation(s) ({', '.join(flagged)}).",
                    "related_decisions": [_to_decision_summary(r) for r in prohibited_acc[:4]],
                }
            )
        elif unverified_acc:
            existing = brand.get("approved_facts") or ""
            claims = [r["original_text"] for r in unverified_acc[:2]]
            suggestions.append(
                {
                    "target_field": "approved_facts",
                    "existing_guideline": existing or "No approved facts listed yet.",
                    "proposed_guideline": (
                        f'{existing} (Ensure claims such as "{", ".join(claims)}" are verified before publication.)'
                        if existing
                        else f'Verify factual claims ({", ".join(claims)}) with source documentation before publishing.'
                    ),
                    "reason": f"Reviewers confirmed {len(unverified_acc)} unverified factual claim(s).",
                    "related_decisions": [_to_decision_summary(r) for r in unverified_acc[:4]],
                }
            )
        elif other_acc:
            first = other_acc[0]
            existing = brand.get("guidelines") or "Maintain clear and accurate brand messaging."
            note = f" Reviewer guidance: {first['reviewer_reason']}" if first["reviewer_reason"] else ""
            suggestions.append(
                {
                    "target_field": "guidelines",
                    "existing_guideline": existing,
                    "proposed_guideline": f'{existing} Avoid {first["issue_type"].lower()} patterns such as "{first["original_text"]}".{note}',
                    "reason": f"Reviewers accepted {len(other_acc)} violation(s) around {first['issue_type']}.",
                    "related_decisions": [_to_decision_summary(r) for r in other_acc[:4]],
                }
            )

    return suggestions


def generate_guideline_suggestions(
    brand: Dict[str, Any], reviews: List[Dict[str, Any]]
) -> Dict[str, Any]:
    reviewed = [r for r in reviews if r["decision"] in ("accepted", "rejected")]
    if not reviewed:
        return {"suggestions": [], "mode": "gemini" if is_gemini_configured() else "demo"}

    if not is_gemini_configured():
        return {
            "suggestions": generate_demo_guideline_suggestions(brand, reviewed),
            "mode": "demo",
        }

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        review_log = [
            {
                "review_id": r["review_id"],
                "issue_id": r["issue_db_id"],
                "content_type": r["content_type"],
                "issue_type": r["issue_type"],
                "severity": r["severity"],
                "original_text": r["original_text"],
                "brand_rule": r["brand_rule"],
                "decision": r["decision"],
                "reviewer_reason": r["reviewer_reason"],
                "correction_decision": r["correction_decision"],
                "final_corrected_text": r["final_corrected_text"],
            }
            for r in reviewed[:25]
        ]

        prompt = f"""Analyze the saved human review decisions for "{brand['brand_name']}" and propose 1 to 3 concise brand guideline improvements as JSON:
{{"suggestions": [{{"target_field": "tone|preferred_terms|prohibited_terms|approved_facts|guidelines", "existing_guideline": "...", "proposed_guideline": "...", "reason": "...", "related_review_ids": [1]}}]}}

Current brand profile:
tone: {brand.get('tone', '')}
preferred_terms: {brand.get('preferred_terms', '')}
prohibited_terms: {brand.get('prohibited_terms', '')}
approved_facts: {brand.get('approved_facts', '')}
guidelines: {brand.get('guidelines', '')}

Review decisions:
{json.dumps(review_log, ensure_ascii=False)}
"""
        response = client.models.generate_content(
            model="gemini-4-hydrogen",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        parsed = json.loads((response.text or "{}").strip())
        raw_list = parsed.get("suggestions", []) if isinstance(parsed, dict) else []
        by_id = {r["review_id"]: r for r in reviewed}

        mapped: List[Dict[str, Any]] = []
        for s in raw_list[:3]:
            if not isinstance(s, dict) or not str(s.get("proposed_guideline") or "").strip():
                continue
            target = s.get("target_field")
            target_field = target if target in ALLOWED_FIELDS else "guidelines"
            ids = [int(i) for i in s.get("related_review_ids", []) if str(i).isdigit() and int(i) in by_id]
            matched = [by_id[i] for i in ids] if ids else reviewed[:3]
            mapped.append(
                {
                    "target_field": target_field,
                    "existing_guideline": brand.get(target_field) or str(s.get("existing_guideline") or ""),
                    "proposed_guideline": str(s["proposed_guideline"]).strip(),
                    "reason": str(s.get("reason") or "Derived from saved reviewer decisions.").strip(),
                    "related_decisions": [_to_decision_summary(r) for r in matched],
                }
            )
        if not mapped:
            return {
                "suggestions": generate_demo_guideline_suggestions(brand, reviewed),
                "mode": "demo",
            }
        return {"suggestions": mapped, "mode": "gemini"}
    except Exception:
        return {
            "suggestions": generate_demo_guideline_suggestions(brand, reviewed),
            "mode": "demo",
        }
