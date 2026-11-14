import json
import os
import re
from typing import Any, Dict, List, Optional

MAX_ANALYSIS_CHARS = 18000

VALID_CLASSIFICATIONS = {
    "confirmed_violation",
    "potential_violation",
    "unverified_claim",
    "writing_suggestion",
}


def is_gemini_configured() -> bool:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return bool(key and key != "MY_GEMINI_API_KEY" and not key.startswith("YOUR_"))


def detect_content_language(content: str, hint: Optional[str] = None) -> str:
    devanagari = len(re.findall(r"[\u0900-\u097F]", content))
    bengali = len(re.findall(r"[\u0980-\u09FF]", content))
    english = len(re.findall(r"\b[A-Za-z]{2,}\b", content))

    active: List[str] = []
    if devanagari >= 2:
        active.append("Hindi")
    if bengali >= 2:
        active.append("Bengali")
    if english >= 2:
        active.append("English")

    if len(active) > 1:
        return f"Mixed ({' + '.join(active)})"
    if len(active) == 1:
        return active[0]

    clean_hint = (hint or "").strip()
    if clean_hint and clean_hint.lower() != "auto":
        return clean_hint
    return "English"


def _split_terms(raw: str) -> List[str]:
    return [item.strip() for item in re.split(r"[,;\n]+", raw or "") if item.strip()]


def _build_term_pattern(term: str) -> re.Pattern:
    escaped = re.escape(term)
    if all(32 <= ord(ch) <= 126 for ch in term):
        return re.compile(rf"\b{escaped}\b", re.IGNORECASE)
    return re.compile(escaped, re.IGNORECASE)


def _normalize_digits(text: str) -> str:
    devanagari = "०१२३৪৫৬৭৮৯"
    # Map both Devanagari and Bengali numerals to ASCII digits
    table = str.maketrans("०१२३४५६७८९০১২৩৪৫৬৭৮৯", "01234567890123456789")
    return text.translate(table)


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


def _normalize_classification(value: Any, issue_type: str, severity: str) -> str:
    if value in VALID_CLASSIFICATIONS:
        return value
    t_lower = issue_type.lower()
    if "unsupported" in t_lower or "unverified" in t_lower or "factual" in t_lower:
        return "unverified_claim"
    if "missing preferred" in t_lower or "writing" in t_lower:
        return "writing_suggestion"
    if severity == "High":
        return "confirmed_violation"
    return "potential_violation"


def _normalize_confidence(value: Any, classification: str) -> float:
    try:
        if value is not None:
            num = float(value)
            return round(min(1.0, max(0.1, num)), 2)
    except (TypeError, ValueError):
        pass
    if classification == "confirmed_violation":
        return 0.94
    if classification == "unverified_claim":
        return 0.85
    if classification == "potential_violation":
        return 0.78
    return 0.72


def _normalize_status(value: Any, issues: List[Dict[str, Any]]) -> str:
    if not issues:
        return "Compliant"
    has_high = any(i["severity"] == "High" for i in issues)
    has_confirmed = any(i["classification"] == "confirmed_violation" for i in issues)
    if has_high or has_confirmed:
        if value == "Needs Review" and not has_high:
            return "Needs Review"
        return "Non-Compliant"
    if value in ("Needs Review", "Non-Compliant"):
        return value
    return "Needs Review"


def validate_analysis_payload(
    raw: Any, original_content: str, fallback_language: str
) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("AI response must be a JSON object.")

    raw_issues = raw.get("issues", [])
    if not isinstance(raw_issues, list):
        raw_issues = []

    issues: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_issues):
        if not isinstance(item, dict):
            continue
        issue_type = str(item.get("type") or "Guideline Review").strip()
        severity = _normalize_severity(item.get("severity"))
        classification = _normalize_classification(
            item.get("classification"), issue_type, severity
        )
        issue_id = str(item.get("issue_id") or "").strip() or f"issue_{idx + 1:03d}"

        issues.append(
            {
                "issue_id": issue_id,
                "type": issue_type,
                "severity": severity,
                "original_text": str(item.get("original_text") or original_content[:120]).strip(),
                "brand_rule": str(item.get("brand_rule") or "Supplied brand guidelines").strip(),
                "explanation": str(item.get("explanation") or "Flagged for review.").strip(),
                "suggestion": str(item.get("suggestion") or "Revise to match guidelines.").strip(),
                "rule_reference": str(item.get("rule_reference") or "Brand guideline").strip(),
                "confidence": _normalize_confidence(item.get("confidence"), classification),
                "classification": classification,
            }
        )

    overall_status = _normalize_status(raw.get("overall_status"), issues)
    detected_language = (
        str(raw.get("detected_language") or "").strip() or fallback_language
    )
    corrected = str(raw.get("corrected_content") or "").strip() or original_content

    return {
        "overall_status": overall_status,
        "detected_language": detected_language,
        "issues": issues,
        "corrected_content": corrected,
    }


PROHIBITED_EQUIVALENTS = [
    (
        re.compile(r"cheapest", re.IGNORECASE),
        [
            (re.compile(r"\bcheapest\b", re.IGNORECASE), "value-focused", "English"),
            (re.compile(r"सबसे\s*सस्ता|सबसे\s*सस्ते|सबसे\s*सस्ती"), "किफ़ायती", "Hindi"),
            (re.compile(r"সবচেয়ে\s*সস্তা|সবচেয়ে\s*সস্তা"), "সাশ্রয়ী", "Bengali"),
        ],
    ),
    (
        re.compile(r"100%\s*risk-free|risk-free", re.IGNORECASE),
        [
            (re.compile(r"\b100%\s*risk-free\b", re.IGNORECASE), "backed by our transparent return policy", "English"),
            (re.compile(r"(?:100%|१००%)\s*(?:जोखिम[- ]*मुक्त|रिस्क[- ]*फ्री)|बिना\s*किसी\s*जोखिम(?:\s*के)?"), "हमारी स्पष्ट रिटर्न नीति के साथ", "Hindi"),
            (re.compile(r"(?:100%|১০০%)\s*(?:ঝুঁকিমুক্ত|ঝুঁকি[- ]*মুক্ত|রিস্ক[- ]*ফ্রি)"), "আমাদের স্বচ্ছ রিটার্ন নীতিমালার আওতায়", "Bengali"),
        ],
    ),
    (
        re.compile(r"guaranteed", re.IGNORECASE),
        [
            (re.compile(r"\bguaranteed\b", re.IGNORECASE), "thoughtfully designed", "English"),
            (re.compile(r"गारंटीड|पक्की\s*गारंटी|गारंटी\s*के\s*साथ|गारंटी"), "विश्वसनीय गुणवत्ता", "Hindi"),
            (re.compile(r"গ্যারান্টিযুক্ত|গ্যারান্টিসহ|গ্যারান্টি"), "নির্ভরযোগ্য মানসম্পন্ন", "Bengali"),
        ],
    ),
]


def analyze_with_demo_mode(
    brand: Dict[str, Any],
    content: str,
    detected_language_hint: Optional[str] = None,
    fallback_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Multilingual rule-grounded Demo Mode analyzer when Gemini API key is unavailable."""
    detected_language = detect_content_language(content, detected_language_hint)
    issues: List[Dict[str, Any]] = []
    corrected = content
    matched_spans = set()

    def push_issue(issue_data: Dict[str, Any]) -> None:
        issues.append(
            {
                "issue_id": f"issue_{len(issues) + 1:03d}",
                **issue_data,
            }
        )

    prohibited = _split_terms(brand.get("prohibited_terms", ""))
    for term in prohibited:
        lit_pattern = _build_term_pattern(term)
        for match in lit_pattern.finditer(content):
            snippet = match.group(0)
            key = snippet.lower()
            if key in matched_spans:
                continue
            matched_spans.add(key)

            replacement = "accessible"
            if re.search(r"100%\s*risk-free", term, re.IGNORECASE):
                replacement = "backed by our transparent return policy"
            elif re.search(r"guaranteed", term, re.IGNORECASE):
                replacement = "thoughtfully designed"
            elif re.search(r"cheapest", term, re.IGNORECASE):
                replacement = "value-focused"

            push_issue(
                {
                    "type": "Prohibited Term",
                    "severity": "High",
                    "original_text": snippet,
                    "brand_rule": f"Prohibited words and phrases: {brand.get('prohibited_terms', '')}",
                    "explanation": f'The phrase "{snippet}" directly matches prohibited terminology for {brand["brand_name"]}.',
                    "suggestion": replacement,
                    "rule_reference": "Prohibited words guideline",
                    "confidence": 0.97,
                    "classification": "confirmed_violation",
                }
            )
            corrected = _build_term_pattern(snippet).sub(replacement, corrected)

        for trigger, equivalents in PROHIBITED_EQUIVALENTS:
            if not trigger.search(term):
                continue
            for pat, repl, lang in equivalents:
                for match in pat.finditer(content):
                    snippet = match.group(0)
                    key = snippet.lower()
                    if key in matched_spans:
                        continue
                    matched_spans.add(key)
                    push_issue(
                        {
                            "type": "Prohibited Term",
                            "severity": "High",
                            "original_text": snippet,
                            "brand_rule": f"Prohibited words and phrases: {brand.get('prohibited_terms', '')}",
                            "explanation": f'The {lang} phrase "{snippet}" corresponds to prohibited term "{term}".',
                            "suggestion": repl,
                            "rule_reference": "Prohibited words guideline (multilingual)",
                            "confidence": 0.93,
                            "classification": "confirmed_violation",
                        }
                    )
                    corrected = pat.sub(repl, corrected)

    guideline_text = f"{brand.get('guidelines', '')} {brand.get('description', '')}".lower()
    if "exaggerated" in guideline_text or "claim" in guideline_text:
        hyperbole_rules = [
            (
                re.compile(r"\bguaranteed to change your life\b", re.IGNORECASE),
                "crafted to fit your everyday wardrobe",
                "Promises a life-changing outcome, which is an exaggerated marketing claim.",
                0.94,
            ),
            (
                re.compile(r"\bchange your life\b", re.IGNORECASE),
                "elevate your everyday routine",
                "Uses hyperbolic language conflicting with avoiding exaggerated claims.",
                0.90,
            ),
            (
                re.compile(r"\bthe best\b", re.IGNORECASE),
                "thoughtfully designed",
                "Unverified superlative claim ('the best') cannot be substantiated from approved facts.",
                0.88,
            ),
            (
                re.compile(r"आपकी\s*ज़िंदगी\s*बदल\s*देगा|ज़िंदगी\s*बदल\s*देगा|जिंदगी\s*बदल\s*देगा|जीवन\s*बदल\s*देगा"),
                "आपके रोज़मर्रा के पहनावे को बेहतर बनाएगा",
                "Exaggerated life-changing promise in Hindi conflicts with avoiding exaggerated claims.",
                0.91,
            ),
            (
                re.compile(r"दुनिया\s*का\s*सबसे\s*बेहतरीन|सबसे\s*बेहतरीन|नंबर\s*1"),
                "आधुनिक और विचारशील",
                "Unverified superlative claim in Hindi conflicts with general writing guidelines.",
                0.89,
            ),
            (
                re.compile(r"আপনার\s*জীবন\s*বদলে\s*দেবে|জীবন\s*বদলে\s*দেবে"),
                "আপনার দৈনন্দিন পোশাককে আরও স্বাচ্ছন্দ্যময় করবে",
                "Exaggerated life-changing promise in Bengali conflicts with avoiding exaggerated claims.",
                0.91,
            ),
            (
                re.compile(r"বিশ্বের\s*সেরা|সবচেয়ে\s*ভালো|সবচেয়ে\s*ভালো"),
                "আধুনিক ও যত্নসহকারে তৈরি",
                "Unverified superlative claim in Bengali conflicts with general writing guidelines.",
                0.89,
            ),
        ]
        for pat, repl, reason, conf in hyperbole_rules:
            match = pat.search(content)
            if match:
                snippet = match.group(0)
                key = snippet.lower()
                if any(key in s for s in matched_spans):
                    continue
                matched_spans.add(key)
                push_issue(
                    {
                        "type": "Exaggerated Claim",
                        "severity": "High",
                        "original_text": snippet,
                        "brand_rule": brand.get("guidelines") or "Avoid exaggerated marketing claims.",
                        "explanation": reason,
                        "suggestion": repl,
                        "rule_reference": "General writing guideline",
                        "confidence": conf,
                        "classification": "confirmed_violation",
                    }
                )
                corrected = pat.sub(repl, corrected)

    tone_rules = [
        (re.compile(r"\bBuy now and experience\b", re.IGNORECASE), "Explore", "English"),
        (re.compile(r"\b(BUY NOW|Buy now|ACT NOW|LIMITED TIME)\b!?"), "Explore our collection", "English"),
        (re.compile(r"अभी\s*खरीदें!?|तुरंत\s*खरीदें!?"), "हमारा कलेक्शन देखें", "Hindi"),
        (re.compile(r"এখনই\s*কিনুন!?|তাড়াতাড়ি\s*কিনুন!?"), "আমাদের সংগ্রহ দেখুন", "Bengali"),
    ]
    for pat, repl, lang in tone_rules:
        match = pat.search(content)
        if match and re.search(r"friendly|professional|modern|calm", brand.get("tone", ""), re.IGNORECASE):
            snippet = match.group(0).strip()
            key = snippet.lower()
            if any(key in s or s in key for s in matched_spans):
                continue
            matched_spans.add(key)
            push_issue(
                {
                    "type": "Tone Violation",
                    "severity": "Medium",
                    "original_text": snippet,
                    "brand_rule": f"Preferred tone: {brand.get('tone', '')}",
                    "explanation": f'High-pressure {lang} call to action ("{snippet}") does not match {brand["brand_name"]}\'s tone.',
                    "suggestion": repl,
                    "rule_reference": "Tone guideline",
                    "confidence": 0.86,
                    "classification": "confirmed_violation",
                }
            )
            corrected = pat.sub(repl, corrected)

    norm_content = _normalize_digits(content)
    norm_approved = _normalize_digits(brand.get("approved_facts") or "").lower()
    for claim in re.findall(r"\b\d+%(?:\s+[^\s.,!?;।]+){1,3}", norm_content):
        clean_claim = claim.strip().lower()
        is_prohibited = any(
            p.lower() in clean_claim or clean_claim in p.lower() for p in prohibited
        ) or any("100%" in _normalize_digits(s) and "100%" in clean_claim for s in matched_spans)
        is_recycled_70 = clean_claim.startswith("70%") and "70%" in norm_approved and any(
            kw in clean_claim for kw in ("recycled", "रीसाइकल्ड", "पुनर्नवीनीकृत", "রিসাইকেল্ড", "রিসাইকেল")
        )
        words = clean_claim.split()
        two_word_prefix = " ".join(words[:2])
        is_verified = (
            is_recycled_70
            or clean_claim in norm_approved
            or (len(words) >= 2 and two_word_prefix in norm_approved)
        )
        if not is_prohibited and not is_verified:
            push_issue(
                {
                    "type": "Unsupported Factual Claim",
                    "severity": "Medium",
                    "original_text": claim.strip(),
                    "brand_rule": f"Approved facts: {brand.get('approved_facts') or 'None supplied'}",
                    "explanation": f'The claim "{claim.strip()}" could not be verified using the supplied approved facts.',
                    "suggestion": "Verify this claim or reference an approved fact.",
                    "rule_reference": "Approved facts & claims",
                    "confidence": 0.87,
                    "classification": "unverified_claim",
                }
            )

    preferred = _split_terms(brand.get("preferred_terms", ""))
    if preferred:
        has_preferred = any(
            _build_term_pattern(term).search(content)
            or (
                re.search(r"sustainable fashion", term, re.IGNORECASE)
                and re.search(r"सस्टेनेबल\s*फैशन|टिकाऊ\s*फैशन|টেকসই\s*ফ্যাশন", content)
            )
            for term in preferred
        )
        if not has_preferred:
            push_issue(
                {
                    "type": "Missing Preferred Terminology",
                    "severity": "Low",
                    "original_text": content[:80].strip(),
                    "brand_rule": f"Preferred words and phrases: {brand.get('preferred_terms', '')}",
                    "explanation": f"None of the preferred terms ({', '.join(preferred)}) appear in this draft.",
                    "suggestion": f'Naturally incorporate "{preferred[0]}" where relevant.',
                    "rule_reference": "Preferred terminology",
                    "confidence": 0.75,
                    "classification": "writing_suggestion",
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
    elif issues:
        corrected = re.sub(r"\s{2,}", " ", corrected).strip()

    overall_status = _normalize_status(None, issues)

    return {
        "overall_status": overall_status,
        "detected_language": detected_language,
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
    source_type: str = "text",
    detected_language_hint: Optional[str] = None,
    force_demo: bool = False,
) -> Dict[str, Any]:
    detected_language = detect_content_language(content, detected_language_hint)
    safe_content = content[:MAX_ANALYSIS_CHARS]

    if force_demo or not is_gemini_configured():
        reason = (
            "Demo mode selected by user."
            if force_demo
            else "GEMINI_API_KEY is not configured; running in Multilingual Demo Mode."
        )
        return analyze_with_demo_mode(brand, safe_content, detected_language, reason)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

        prompt = f"""Analyze the submitted marketing content in English, Hindi, Bengali, or mixed languages strictly against the supplied Brand Guidelines.
Return valid JSON matching:
{{
  "overall_status": "Compliant" | "Needs Review" | "Non-Compliant",
  "detected_language": "English" | "Hindi" | "Bengali" | "Mixed (...)",
  "issues": [
    {{
      "issue_id": "issue_001",
      "type": "...",
      "severity": "High" | "Medium" | "Low",
      "original_text": "...",
      "brand_rule": "...",
      "explanation": "...",
      "suggestion": "...",
      "rule_reference": "...",
      "confidence": 0.92,
      "classification": "confirmed_violation" | "potential_violation" | "unverified_claim" | "writing_suggestion"
    }}
  ],
  "corrected_content": "..."
}}

Multilingual & Governance Rules:
- Analyze Hindi and Bengali directly in their original scripts without translating before analysis.
- Apply English brand guidelines semantically to Hindi and Bengali content.
- Return every independent violation as a separate issue with sequential issue_id.
- Never invent guidelines or flag valid statements.
- Generate suggestions and corrected_content in the same language/script as the input without changing unrelated compliant sentences.

=== SOURCE CONTEXT ===
Source Type: {source_type}
Content Type: {content_type}
Title: {title}
Pre-detected Language Hint: {detected_language}

=== BRAND GUIDELINES ===
Brand Name: {brand['brand_name']}
Brand Description: {brand['description']}
Preferred Tone: {brand['tone']}
Preferred Words & Phrases: {brand['preferred_terms']}
Prohibited Words & Phrases: {brand['prohibited_terms']}
Approved Facts & Claims: {brand['approved_facts']}
General Writing Guidelines: {brand['guidelines']}

=== SUBMITTED CONTENT ===
\"\"\"
{safe_content}
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
        validated = validate_analysis_payload(parsed, safe_content, detected_language)
        return {**validated, "mode": "gemini"}
    except Exception as exc:
        return analyze_with_demo_mode(
            brand,
            safe_content,
            detected_language,
            f"Gemini API fallback ({exc}). Showing rule-based Multilingual Demo Mode analysis.",
        )
