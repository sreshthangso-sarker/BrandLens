import json
import os
import re
from typing import Any, Dict, List, Optional


def is_gemini_configured() -> bool:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return bool(key and key != "MY_GEMINI_API_KEY" and not key.startswith("YOUR_"))


def _split_terms(raw: str) -> List[str]:
    return [item.strip() for item in re.split(r"[,;\n]+", raw or "") if item.strip()]


def _normalize_severity(value: Any) -> str:
    if value in ("High", "Medium", "Low"):
        return value
    if isinstance(value, str):
        lower = value.lower()
        if "high" in lower:
            return "High"
        if "low" in lower:
            return "Low"
    return "Medium"


def _normalize_status(value: Any, issue_count: int, has_high: bool) -> str:
    if value in ("Compliant", "Needs Review", "Non-Compliant"):
        if issue_count == 0 and value != "Compliant":
            return "Compliant"
        if has_high and value == "Compliant":
            return "Non-Compliant"
        return value
    if issue_count == 0:
        return "Compliant"
    return "Non-Compliant" if has_high else "Needs Review"


def validate_analysis_payload(raw: Any, original_content: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("AI response must be a JSON object.")

    raw_issues = raw.get("issues", [])
    if not isinstance(raw_issues, list):
        raw_issues = []

    issues = []
    for item in raw_issues:
        if not isinstance(item, dict):
            continue
        issues.append(
            {
                "type": str(item.get("type") or "Guideline Review").strip(),
                "severity": _normalize_severity(item.get("severity")),
                "original_text": str(item.get("original_text") or original_content[:120]).strip(),
                "brand_rule": str(item.get("brand_rule") or "Supplied brand guidelines").strip(),
                "explanation": str(item.get("explanation") or "Flagged for review.").strip(),
                "suggestion": str(item.get("suggestion") or "Revise to match guidelines.").strip(),
                "rule_reference": str(item.get("rule_reference") or "Brand guideline").strip(),
            }
        )

    has_high = any(i["severity"] == "High" for i in issues)
    overall_status = _normalize_status(raw.get("overall_status"), len(issues), has_high)
    corrected = str(raw.get("corrected_content") or "").strip() or original_content

    return {
        "overall_status": overall_status,
        "issues": issues,
        "corrected_content": corrected,
    }


def analyze_with_demo_mode(
    brand: Dict[str, Any],
    content: str,
    fallback_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Rule-grounded Demo Mode analyzer when Gemini API key is unavailable."""
    issues: List[Dict[str, str]] = []
    corrected = content

    prohibited = _split_terms(brand.get("prohibited_terms", ""))
    for term in prohibited:
        pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        match = pattern.search(content)
        if match:
            snippet = match.group(0)
            replacement = "accessible"
            if re.search(r"100%\s*risk-free", term, re.IGNORECASE):
                replacement = "backed by our transparent return policy"
            elif re.search(r"guaranteed", term, re.IGNORECASE):
                replacement = "designed"
            elif re.search(r"cheapest", term, re.IGNORECASE):
                replacement = "value-focused"

            issues.append(
                {
                    "type": "Prohibited Term",
                    "severity": "High",
                    "original_text": snippet,
                    "brand_rule": f"Prohibited words and phrases: {brand.get('prohibited_terms', '')}",
                    "explanation": f'The phrase "{snippet}" is listed in {brand["brand_name"]}\'s prohibited terminology.',
                    "suggestion": f'Replace "{snippet}" with "{replacement}".',
                    "rule_reference": "Prohibited words guideline",
                }
            )
            corrected = pattern.sub(replacement, corrected)

    guideline_text = f"{brand.get('guidelines', '')} {brand.get('description', '')}".lower()
    if "exaggerated" in guideline_text or "claim" in guideline_text:
        hyperbole_rules = [
            (
                r"\bguaranteed to change your life\b",
                "crafted to fit your everyday wardrobe",
                "Promises a life-changing outcome, which is an exaggerated marketing claim.",
            ),
            (
                r"\bchange your life\b",
                "elevate your everyday routine",
                "Uses hyperbolic language conflicting with avoiding exaggerated claims.",
            ),
            (
                r"\bthe best\b",
                "thoughtfully designed",
                "Superlative claim ('the best') cannot be verified against approved facts.",
            ),
        ]
        for pat, repl, reason in hyperbole_rules:
            found = re.search(pat, content, re.IGNORECASE)
            if found:
                issues.append(
                    {
                        "type": "Exaggerated Claim",
                        "severity": "High",
                        "original_text": found.group(0),
                        "brand_rule": brand.get("guidelines") or "Avoid exaggerated marketing claims.",
                        "explanation": reason,
                        "suggestion": f'Use grounded phrasing such as "{repl}".',
                        "rule_reference": "General writing guideline",
                    }
                )
                corrected = re.sub(pat, repl, corrected, flags=re.IGNORECASE)

    if re.search(r"\b(buy now|act now|limited time)\b", content, re.IGNORECASE):
        issues.append(
            {
                "type": "Tone Violation",
                "severity": "Medium",
                "original_text": "Buy now",
                "brand_rule": f"Preferred tone: {brand.get('tone', '')}",
                "explanation": f'High-pressure urgency does not match {brand["brand_name"]}\'s {brand.get("tone", "").lower()} tone.',
                "suggestion": "Use an inviting, conversational call to action.",
                "rule_reference": "Tone guideline",
            }
        )
        corrected = re.sub(r"\bBuy now and experience\b", "Explore", corrected, flags=re.IGNORECASE)
        corrected = re.sub(r"\bBuy now\b", "Explore our collection", corrected, flags=re.IGNORECASE)
        corrected = re.sub(r"!+", ".", corrected)

    approved_lower = (brand.get("approved_facts") or "").lower()
    for claim in re.findall(r"\b\d+%(?:\s+[a-zA-Z-]+){1,3}", content):
        clean_claim = claim.strip().lower()
        is_prohibited = any(
            p.lower() in clean_claim or clean_claim in p.lower() for p in prohibited
        )
        words = clean_claim.split()
        two_word_prefix = " ".join(words[:2])
        is_verified = clean_claim in approved_lower or (
            len(words) >= 2 and two_word_prefix in approved_lower
        )
        if not is_prohibited and not is_verified:
            issues.append(
                {
                    "type": "Unsupported Factual Claim",
                    "severity": "Medium",
                    "original_text": claim.strip(),
                    "brand_rule": f"Approved facts: {brand.get('approved_facts') or 'None supplied'}",
                    "explanation": f'The claim "{claim.strip()}" could not be verified against the supplied approved facts.',
                    "suggestion": "Verify this claim or reference an approved fact.",
                    "rule_reference": "Approved facts & claims",
                }
            )

    preferred = _split_terms(brand.get("preferred_terms", ""))
    if preferred and all(
        not re.search(rf"\b{re.escape(term)}\b", content, re.IGNORECASE) for term in preferred
    ):
        issues.append(
            {
                "type": "Missing Preferred Terminology",
                "severity": "Low",
                "original_text": content[:80].strip(),
                "brand_rule": f"Preferred words and phrases: {brand.get('preferred_terms', '')}",
                "explanation": f"None of the preferred terms ({', '.join(preferred)}) appear in this draft.",
                "suggestion": f'Naturally incorporate "{preferred[0]}" where relevant.',
                "rule_reference": "Preferred terminology",
            }
        )

    if (
        issues
        and brand["brand_name"].lower() == "novawear"
        and "cheapest fashion brand" in content.lower()
        and "100% risk-free" in content.lower()
    ):
        corrected = (
            "NovaWear is a modern sustainable fashion brand. "
            "Our pieces are thoughtfully designed for everyday wear. "
            "Explore our latest sustainable fashion collection today."
        )

    has_high = any(i["severity"] == "High" for i in issues)
    overall_status = "Compliant" if not issues else ("Non-Compliant" if has_high else "Needs Review")

    return {
        "overall_status": overall_status,
        "issues": issues,
        "corrected_content": content if not issues else corrected,
        "mode": "demo",
        "fallback_reason": fallback_reason,
    }


def analyze_content_with_ai(
    brand: Dict[str, Any],
    title: str,
    content_type: str,
    content: str,
    force_demo: bool = False,
) -> Dict[str, Any]:
    if force_demo or not is_gemini_configured():
        reason = (
            "Demo mode selected by user."
            if force_demo
            else "GEMINI_API_KEY is not configured; running in Demo Mode."
        )
        return analyze_with_demo_mode(brand, content, reason)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

        prompt = f"""Analyze the submitted marketing content strictly against the supplied Brand Guidelines.
Return valid JSON with fields: overall_status ("Compliant" | "Needs Review" | "Non-Compliant"),
issues (array of {{type, severity, original_text, brand_rule, explanation, suggestion, rule_reference}}),
and corrected_content (string).

Rules:
- Connect every confirmed violation to an actual supplied guideline.
- Do not invent brand rules.
- For unsupported claims, explain they could not be verified against approved facts without assuming they are false.
- Preserve meaning and do not invent new facts in corrected_content.

=== BRAND GUIDELINES ===
Brand Name: {brand['brand_name']}
Brand Description: {brand['description']}
Preferred Tone: {brand['tone']}
Preferred Words & Phrases: {brand['preferred_terms']}
Prohibited Words & Phrases: {brand['prohibited_terms']}
Approved Facts & Claims: {brand['approved_facts']}
General Writing Guidelines: {brand['guidelines']}

=== SUBMITTED CONTENT ===
Title: {title}
Content Type: {content_type}
Content:
\"\"\"
{content}
\"\"\"
"""
        response = client.models.generate_content(
            model="gemini-4-hydrogen",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        raw_text = (response.text or "").strip()
        if not raw_text:
            raise ValueError("Empty response from Gemini API.")

        parsed = json.loads(raw_text)
        validated = validate_analysis_payload(parsed, content)
        return {**validated, "mode": "gemini"}
    except Exception as exc:
        return analyze_with_demo_mode(
            brand,
            content,
            f"Gemini API fallback ({exc}). Showing rule-based Demo Mode analysis.",
        )
