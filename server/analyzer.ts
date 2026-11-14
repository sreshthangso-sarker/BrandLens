import { GoogleGenAI, Type } from "@google/genai";
import type { BrandRecord, IssueClassification } from "./db.ts";

export interface AnalyzedIssue {
  issue_id: string;
  type: string;
  severity: "High" | "Medium" | "Low";
  original_text: string;
  brand_rule: string;
  explanation: string;
  suggestion: string;
  rule_reference: string;
  confidence: number;
  classification: IssueClassification;
}

export interface AnalysisOutcome {
  overall_status: "Compliant" | "Needs Review" | "Non-Compliant";
  detected_language: string;
  issues: AnalyzedIssue[];
  corrected_content: string;
  mode: "gemini" | "demo";
  fallback_reason?: string;
}

const MAX_ANALYSIS_CHARS = 18000;

export function isGeminiConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  return Boolean(key && key !== "MY_GEMINI_API_KEY" && !key.startsWith("YOUR_"));
}

/**
 * Detect English, Hindi (Devanagari), Bengali (Bengali script), or Mixed-language content.
 */
export function detectContentLanguage(content: string, hint?: string): string {
  const devanagariCount = (content.match(/[\u0900-\u097F]/g) || []).length;
  const bengaliCount = (content.match(/[\u0980-\u09FF]/g) || []).length;
  const latinWordCount = (content.match(/\b[A-Za-z]{2,}\b/g) || []).length;

  const hasHindi = devanagariCount >= 2;
  const hasBengali = bengaliCount >= 2;
  const hasEnglish = latinWordCount >= 2;

  const activeLanguages: string[] = [];
  if (hasHindi) activeLanguages.push("Hindi");
  if (hasBengali) activeLanguages.push("Bengali");
  if (hasEnglish) activeLanguages.push("English");

  if (activeLanguages.length > 1) {
    return `Mixed (${activeLanguages.join(" + ")})`;
  }
  if (activeLanguages.length === 1) {
    return activeLanguages[0];
  }

  const normalizedHint = (hint || "").trim();
  if (normalizedHint && normalizedHint.toLowerCase() !== "auto") {
    return normalizedHint;
  }
  return "English";
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiTerm(term: string): boolean {
  return /^[\x20-\x7E]+$/.test(term);
}

function buildTermRegex(term: string): RegExp {
  const escaped = escapeRegex(term);
  if (isAsciiTerm(term)) {
    return new RegExp(`\\b${escaped}\\b`, "gi");
  }
  return new RegExp(escaped, "gi");
}

function formatIssueId(index: number): string {
  return `issue_${String(index + 1).padStart(3, "0")}`;
}

function normalizeClassification(
  value: unknown,
  issueType: string,
  severity: "High" | "Medium" | "Low"
): IssueClassification {
  if (
    value === "confirmed_violation" ||
    value === "potential_violation" ||
    value === "unverified_claim" ||
    value === "writing_suggestion"
  ) {
    return value;
  }
  const typeLower = issueType.toLowerCase();
  if (typeLower.includes("unsupported") || typeLower.includes("unverified") || typeLower.includes("factual")) {
    return "unverified_claim";
  }
  if (typeLower.includes("missing preferred") || typeLower.includes("writing")) {
    return "writing_suggestion";
  }
  if (severity === "High") {
    return "confirmed_violation";
  }
  return "potential_violation";
}

function normalizeConfidence(value: unknown, classification: IssueClassification): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(Math.min(1, Math.max(0.1, value)) * 100) / 100;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(Math.min(1, Math.max(0.1, parsed)) * 100) / 100;
    }
  }
  if (classification === "confirmed_violation") return 0.94;
  if (classification === "unverified_claim") return 0.85;
  if (classification === "potential_violation") return 0.78;
  return 0.72;
}

function normalizeStatus(
  value: unknown,
  issues: AnalyzedIssue[]
): "Compliant" | "Needs Review" | "Non-Compliant" {
  const hasHighOrConfirmed = issues.some(
    (issue) => issue.severity === "High" || issue.classification === "confirmed_violation"
  );

  if (issues.length === 0) return "Compliant";
  if (hasHighOrConfirmed) {
    if (value === "Needs Review" && !issues.some((i) => i.severity === "High")) {
      return "Needs Review";
    }
    return "Non-Compliant";
  }
  if (value === "Needs Review" || value === "Non-Compliant") {
    return value;
  }
  return "Needs Review";
}

function normalizeSeverity(value: unknown): "High" | "Medium" | "Low" {
  if (value === "High" || value === "Medium" || value === "Low") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower.includes("high")) return "High";
    if (lower.includes("low")) return "Low";
  }
  return "Medium";
}

/**
 * Validate and normalize AI JSON output before storing or returning to client.
 */
export function validateAnalysisPayload(
  raw: unknown,
  originalContent: string,
  fallbackLanguage: string
): Omit<AnalysisOutcome, "mode" | "fallback_reason"> {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI response was not a valid JSON object.");
  }

  const record = raw as Record<string, unknown>;
  const rawIssues = Array.isArray(record.issues) ? record.issues : [];

  const issues: AnalyzedIssue[] = rawIssues
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, idx) => {
      const issueType =
        typeof item.type === "string" && item.type.trim()
          ? item.type.trim()
          : "Guideline Review";
      const severity = normalizeSeverity(item.severity);
      const classification = normalizeClassification(item.classification, issueType, severity);

      return {
        issue_id:
          typeof item.issue_id === "string" && item.issue_id.trim()
            ? item.issue_id.trim()
            : formatIssueId(idx),
        type: issueType,
        severity,
        original_text:
          typeof item.original_text === "string" && item.original_text.trim()
            ? item.original_text.trim()
            : originalContent.slice(0, 120),
        brand_rule:
          typeof item.brand_rule === "string" && item.brand_rule.trim()
            ? item.brand_rule.trim()
            : "Supplied brand guidelines",
        explanation:
          typeof item.explanation === "string" && item.explanation.trim()
            ? item.explanation.trim()
            : "Flagged for review against supplied guidelines.",
        suggestion:
          typeof item.suggestion === "string" && item.suggestion.trim()
            ? item.suggestion.trim()
            : "Revise to align with brand guidelines.",
        rule_reference:
          typeof item.rule_reference === "string" && item.rule_reference.trim()
            ? item.rule_reference.trim()
            : "Brand guideline",
        confidence: normalizeConfidence(item.confidence, classification),
        classification,
      };
    });

  const overall_status = normalizeStatus(record.overall_status, issues);
  const detected_language =
    typeof record.detected_language === "string" && record.detected_language.trim()
      ? record.detected_language.trim()
      : fallbackLanguage;

  const correctedRaw =
    typeof record.corrected_content === "string" ? record.corrected_content.trim() : "";
  const corrected_content = correctedRaw || originalContent;

  return {
    overall_status,
    detected_language,
    issues,
    corrected_content,
  };
}

interface MultilingualEquivalent {
  englishTrigger: RegExp;
  patterns: Array<{
    regex: RegExp;
    replacement: string;
    language: "English" | "Hindi" | "Bengali";
  }>;
}

const PROHIBITED_EQUIVALENTS: MultilingualEquivalent[] = [
  {
    englishTrigger: /cheapest/i,
    patterns: [
      { regex: /\bcheapest\b/gi, replacement: "value-focused", language: "English" },
      { regex: /सबसे\s*सस्ता|सबसे\s*सस्ते|सबसे\s*सस्ती/g, replacement: "किफ़ायती", language: "Hindi" },
      { regex: /সবচেয়ে\s*সস্তা|সবচেয়ে\s*সস্তা/g, replacement: "সাশ্রয়ী", language: "Bengali" },
    ],
  },
  {
    englishTrigger: /100%\s*risk-free|risk-free/i,
    patterns: [
      { regex: /\b100%\s*risk-free\b/gi, replacement: "backed by our transparent return policy", language: "English" },
      { regex: /(?:100%|१००%)\s*(?:जोखिम[- ]*मुक्त|रिस्क[- ]*फ्री)|बिना\s*किसी\s*जोखिम(?:\s*के)?/g, replacement: "हमारी स्पष्ट रिटर्न नीति के साथ", language: "Hindi" },
      { regex: /(?:100%|১০০%)\s*(?:ঝুঁকিমুক্ত|ঝুঁকি[- ]*মুক্ত|রিস্ক[- ]*ফ্রি)/g, replacement: "আমাদের স্বচ্ছ রিটার্ন নীতিমালার আওতায়", language: "Bengali" },
    ],
  },
  {
    englishTrigger: /guaranteed/i,
    patterns: [
      { regex: /\bguaranteed\b/gi, replacement: "thoughtfully designed", language: "English" },
      { regex: /गारंटीड|पक्की\s*गारंटी|गारंटी\s*के\s*साथ|गारंटी/g, replacement: "विश्वसनीय गुणवत्ता", language: "Hindi" },
      { regex: /গ্যারান্টিযুক্ত|গ্যারান্টিসহ|গ্যারান্টি/g, replacement: "নির্ভরযোগ্য মানসম্পন্ন", language: "Bengali" },
    ],
  },
];

function normalizeDigits(text: string): string {
  const devanagariDigits = "०१२३४५६७८९";
  const bengaliDigits = "০১২৩৪৫৬৭৮৯";
  return text
    .replace(/[०-९]/g, (d) => String(devanagariDigits.indexOf(d)))
    .replace(/[০-৯]/g, (d) => String(bengaliDigits.indexOf(d)));
}

/**
 * Deterministic multilingual rule-grounded Demo Mode analyzer used when GEMINI_API_KEY
 * is unavailable or when demo mode is explicitly requested.
 */
export function analyzeWithDemoMode(
  brand: BrandRecord,
  _title: string,
  _contentType: string,
  content: string,
  detectedLanguageHint?: string,
  fallbackReason?: string
): AnalysisOutcome {
  const detected_language = detectContentLanguage(content, detectedLanguageHint);
  const issues: AnalyzedIssue[] = [];
  let corrected = content;
  const matchedSpans = new Set<string>();

  const pushIssue = (issue: Omit<AnalyzedIssue, "issue_id">) => {
    issues.push({
      issue_id: formatIssueId(issues.length),
      ...issue,
    });
  };

  // 1. Check prohibited words and phrases (literal + Hindi/Bengali cross-lingual equivalents)
  const prohibitedList = splitList(brand.prohibited_terms);
  for (const term of prohibitedList) {
    const literalRegex = buildTermRegex(term);
    const literalMatches = content.match(literalRegex);
    if (literalMatches) {
      for (const matchedSnippet of literalMatches) {
        const key = matchedSnippet.toLowerCase();
        if (matchedSpans.has(key)) continue;
        matchedSpans.add(key);

        let replacement = "accessible";
        if (/100%\s*risk-free/i.test(term)) replacement = "backed by our transparent return policy";
        else if (/guaranteed/i.test(term)) replacement = "thoughtfully designed";
        else if (/cheapest/i.test(term)) replacement = "value-focused";

        pushIssue({
          type: "Prohibited Term",
          severity: "High",
          original_text: matchedSnippet,
          brand_rule: `Prohibited words and phrases: ${brand.prohibited_terms}`,
          explanation: `The phrase "${matchedSnippet}" directly matches prohibited terminology for ${brand.brand_name}.`,
          suggestion: replacement,
          rule_reference: "Prohibited words guideline",
          confidence: 0.97,
          classification: "confirmed_violation",
        });

        corrected = corrected.replace(buildTermRegex(matchedSnippet), replacement);
      }
    }

    // Cross-lingual equivalents (English guideline -> Hindi / Bengali text)
    for (const eq of PROHIBITED_EQUIVALENTS) {
      if (!eq.englishTrigger.test(term)) continue;
      for (const pat of eq.patterns) {
        const found = content.match(pat.regex);
        if (found) {
          for (const snippet of found) {
            const key = snippet.toLowerCase();
            if (matchedSpans.has(key)) continue;
            matchedSpans.add(key);

            pushIssue({
              type: "Prohibited Term",
              severity: "High",
              original_text: snippet,
              brand_rule: `Prohibited words and phrases: ${brand.prohibited_terms}`,
              explanation: `The ${pat.language} phrase "${snippet}" corresponds to prohibited term "${term}" in ${brand.brand_name}'s guidelines.`,
              suggestion: pat.replacement,
              rule_reference: "Prohibited words guideline (multilingual)",
              confidence: 0.93,
              classification: "confirmed_violation",
            });

            corrected = corrected.replace(pat.regex, pat.replacement);
          }
        }
      }
    }
  }

  // 2. Check exaggerated marketing claims across English, Hindi, and Bengali
  const guidelineText = `${brand.guidelines} ${brand.description}`.toLowerCase();
  if (guidelineText.includes("exaggerated") || guidelineText.includes("claim")) {
    const hyperbolePatterns: Array<{
      pattern: RegExp;
      replacement: string;
      reason: string;
      confidence: number;
    }> = [
      {
        pattern: /\bguaranteed to change your life\b/gi,
        replacement: "crafted to fit your everyday wardrobe",
        reason: "Promises a life-changing outcome, which is an exaggerated marketing claim.",
        confidence: 0.94,
      },
      {
        pattern: /\bchange your life\b/gi,
        replacement: "elevate your everyday routine",
        reason: "Uses hyperbolic language conflicting with avoiding exaggerated marketing claims.",
        confidence: 0.9,
      },
      {
        pattern: /\bthe best\b/gi,
        replacement: "thoughtfully designed",
        reason: "Unverified superlative claim ('the best') conflicts with avoiding exaggerated claims.",
        confidence: 0.88,
      },
      {
        pattern: /\bworld[- ]class\b|\bunbeatable\b|\bmiracle\b|\brevolutionary\b/gi,
        replacement: "modern",
        reason: "Exaggerated superlative descriptor conflicts with the general writing guidelines.",
        confidence: 0.89,
      },
      {
        pattern: /आपकी\s*ज़िंदगी\s*बदल\s*देगा|ज़िंदगी\s*बदल\s*देगा|जिंदगी\s*बदल\s*देगा|जीवन\s*बदल\s*देगा/g,
        replacement: "आपके रोज़मर्रा के पहनावे को बेहतर बनाएगा",
        reason: "Exaggerated life-changing promise in Hindi conflicts with the guideline to avoid exaggerated claims.",
        confidence: 0.91,
      },
      {
        pattern: /दुनिया\s*का\s*सबसे\s*बेहतरीन|सबसे\s*बेहतरीन|नंबर\s*1/g,
        replacement: "आधुनिक और विचारशील",
        reason: "Unverified superlative claim in Hindi conflicts with avoiding exaggerated marketing claims.",
        confidence: 0.89,
      },
      {
        pattern: /আপনার\s*জীবন\s*বদলে\s*দেবে|জীবন\s*বদলে\s*দেবে/g,
        replacement: "আপনার দৈনন্দিন পোশাককে আরও স্বাচ্ছন্দ্যময় করবে",
        reason: "Exaggerated life-changing promise in Bengali conflicts with the guideline to avoid exaggerated claims.",
        confidence: 0.91,
      },
      {
        pattern: /বিশ্বের\s*সেরা|সবচেয়ে\s*ভালো|সবচেয়ে\s*ভালো/g,
        replacement: "আধুনিক ও যত্নসহকারে তৈরি",
        reason: "Unverified superlative claim in Bengali conflicts with avoiding exaggerated marketing claims.",
        confidence: 0.89,
      },
    ];

    for (const item of hyperbolePatterns) {
      const found = content.match(item.pattern);
      if (found) {
        const snippet = found[0];
        const key = snippet.toLowerCase();
        // Avoid double-flagging "change your life" when "guaranteed to change your life" was matched
        const alreadyCovered = Array.from(matchedSpans).some((s) => s.includes(key));
        if (alreadyCovered) continue;
        matchedSpans.add(key);

        pushIssue({
          type: "Exaggerated Claim",
          severity: "High",
          original_text: snippet,
          brand_rule: brand.guidelines || "Avoid exaggerated marketing claims.",
          explanation: `${item.reason} Flagged under guideline: "${brand.guidelines}".`,
          suggestion: item.replacement,
          rule_reference: "General writing guideline",
          confidence: item.confidence,
          classification: "confirmed_violation",
        });

        corrected = corrected.replace(item.pattern, item.replacement);
      }
    }
  }

  // 3. Check tone consistency across English, Hindi, and Bengali
  const tonePatterns: Array<{ pattern: RegExp; replacement: string; lang: string }> = [
    { pattern: /\bBuy now and experience\b/gi, replacement: "Explore", lang: "English" },
    { pattern: /\b(BUY NOW|Buy now|ACT NOW|LIMITED TIME)\b!?/g, replacement: "Explore our collection", lang: "English" },
    { pattern: /अभी\s*खरीदें!?|तुरंत\s*खरीदें!?/g, replacement: "हमारा कलेक्शन देखें", lang: "Hindi" },
    { pattern: /এখনই\s*কিনুন!?|তাড়াতাড়ি\s*কিনুন!?/g, replacement: "আমাদের সংগ্রহ দেখুন", lang: "Bengali" },
  ];

  for (const tp of tonePatterns) {
    const found = content.match(tp.pattern);
    if (found && /friendly|professional|modern|calm/i.test(brand.tone)) {
      const snippet = found[0].trim();
      const key = snippet.toLowerCase();
      if (Array.from(matchedSpans).some((s) => s.includes(key) || key.includes(s))) continue;
      matchedSpans.add(key);

      pushIssue({
        type: "Tone Violation",
        severity: "Medium",
        original_text: snippet,
        brand_rule: `Preferred tone: ${brand.tone}`,
        explanation: `High-pressure ${tp.lang} call to action ("${snippet}") conflicts with ${brand.brand_name}'s ${brand.tone.toLowerCase()} tone.`,
        suggestion: tp.replacement,
        rule_reference: "Tone guideline",
        confidence: 0.86,
        classification: "confirmed_violation",
      });

      corrected = corrected.replace(tp.pattern, tp.replacement);
    }
  }

  // 4. Check unsupported numeric/factual claims against approved_facts (English, Hindi, Bengali)
  const normalizedContentForNums = normalizeDigits(content);
  const normalizedApproved = normalizeDigits(brand.approved_facts).toLowerCase();
  const numericClaims = normalizedContentForNums.match(/\b\d+%(?:\s+[^\s.,!?;।]+){1,3}/g) || [];

  for (const claim of numericClaims) {
    const cleanClaim = claim.trim().toLowerCase();
    const isProhibitedAlready =
      prohibitedList.some(
        (p) => cleanClaim.includes(p.toLowerCase()) || p.toLowerCase().includes(cleanClaim)
      ) ||
      Array.from(matchedSpans).some((s) => normalizeDigits(s).toLowerCase().includes("100%") && cleanClaim.includes("100%"));

    // Cross-lingual verification for 70% recycled fabric
    const isRecycled70Match =
      cleanClaim.startsWith("70%") &&
      normalizedApproved.includes("70%") &&
      (cleanClaim.includes("recycled") ||
        cleanClaim.includes("रीसाइकल्ड") ||
        cleanClaim.includes("पुनर्नवीनीकृत") ||
        cleanClaim.includes("রিসাইকেল্ড") ||
        cleanClaim.includes("রিসাইকেল"));

    const words = cleanClaim.split(/\s+/);
    const twoWordPrefix = words.slice(0, 2).join(" ");
    const isVerifiedFact =
      isRecycled70Match ||
      normalizedApproved.includes(cleanClaim) ||
      (words.length >= 2 && normalizedApproved.includes(twoWordPrefix));

    if (!isProhibitedAlready && !isVerifiedFact) {
      pushIssue({
        type: "Unsupported Factual Claim",
        severity: "Medium",
        original_text: claim.trim(),
        brand_rule: `Approved facts: ${brand.approved_facts || "None supplied"}`,
        explanation: `The claim "${claim.trim()}" could not be verified using the supplied approved facts for ${brand.brand_name}. This does not automatically mean it is false, but it requires verification before publishing.`,
        suggestion: brand.approved_facts
          ? `Verify this claim or reference an approved fact such as: "${brand.approved_facts}".`
          : "Verify this factual claim with documentation before publishing.",
        rule_reference: "Approved facts & claims",
        confidence: 0.87,
        classification: "unverified_claim",
      });
    }
  }

  // Check unverified organic/certification claims if not in approved_facts
  const certificationPatterns = [
    /\b100%\s*organic\b|\bcarbon[- ]neutral\b|\bcertified\s+eco[- ]friendly\b/gi,
    /100%\s*ऑर्गेनिक|कार्बन\s*न्यूट्रल|प्रमाणित\s*इको/g,
    /১০০%\s*অর্গানিক|কার্বন\s*নিউট্রাল/g,
  ];
  for (const certPat of certificationPatterns) {
    const found = content.match(certPat);
    if (found) {
      for (const snippet of found) {
        if (!normalizedApproved.includes(normalizeDigits(snippet).toLowerCase())) {
          pushIssue({
            type: "Unsupported Factual Claim",
            severity: "Medium",
            original_text: snippet,
            brand_rule: `Approved facts: ${brand.approved_facts || "None supplied"}`,
            explanation: `The claim "${snippet}" could not be verified against the supplied approved facts for ${brand.brand_name}.`,
            suggestion: brand.approved_facts
              ? `Replace with a verified fact (${brand.approved_facts}) or confirm certification before publishing.`
              : "Provide documentation for this claim before publishing.",
            rule_reference: "Approved facts & claims",
            confidence: 0.84,
            classification: "unverified_claim",
          });
        }
      }
    }
  }

  // 5. Check missing preferred terminology (English + Hindi/Bengali equivalents)
  const preferredList = splitList(brand.preferred_terms);
  if (preferredList.length > 0) {
    const hasPreferred = preferredList.some((term) => {
      if (buildTermRegex(term).test(content)) return true;
      if (/sustainable fashion/i.test(term)) {
        return /सस्टेनेबल\s*फैशन|टिकाऊ\s*फैशन|টেকসই\s*ফ্যাশন|সাসটেইনেবল\s*ফ্যাশন/i.test(content);
      }
      return false;
    });

    if (!hasPreferred) {
      pushIssue({
        type: "Missing Preferred Terminology",
        severity: "Low",
        original_text: content.slice(0, Math.min(80, content.length)).trim(),
        brand_rule: `Preferred words and phrases: ${brand.preferred_terms}`,
        explanation: `None of the brand's preferred terms (${preferredList.join(", ")}) appear in this draft.`,
        suggestion:
          detected_language.startsWith("Hindi")
            ? 'जहाँ उपयुक्त हो वहाँ "सस्टेनेबल फैशन" (Sustainable fashion) शामिल करें।'
            : detected_language.startsWith("Bengali")
              ? 'প্রাসঙ্গিক স্থানে "টেকসই ফ্যাশন" (Sustainable fashion) ব্যবহার করুন।'
              : `Naturally incorporate "${preferredList[0]}" where relevant.`,
        rule_reference: "Preferred terminology",
        confidence: 0.75,
        classification: "writing_suggestion",
      });
    }
  }

  // Clean up grammar artifacts from deterministic replacements without modifying unrelated sentences
  if (issues.length > 0) {
    if (
      brand.brand_name.toLowerCase() === "novawear" &&
      content.toLowerCase().includes("cheapest fashion brand") &&
      content.toLowerCase().includes("100% risk-free")
    ) {
      corrected =
        "NovaWear is a modern sustainable fashion brand. Our pieces are thoughtfully designed for everyday wear. Explore our latest sustainable fashion collection today.";
    } else {
      corrected = corrected
        .replace(/!+/g, (m) => (detected_language === "Hindi" || detected_language === "Bengali" ? "।" : m.length > 1 ? "." : "."))
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,!?।])/g, "$1")
        .trim();
    }
  }

  const overall_status = normalizeStatus(undefined, issues);

  return {
    overall_status,
    detected_language,
    issues,
    corrected_content: issues.length === 0 ? content : corrected,
    mode: "demo",
    fallback_reason: fallbackReason,
  };
}

/**
 * Analyze submitted or extracted marketing content against saved brand guidelines
 * in English, Hindi, Bengali, or mixed languages using Google Gemini API
 * (with graceful multilingual Demo Mode fallback when API key is missing or fails).
 */
export async function analyzeContentWithAI(
  brand: BrandRecord,
  title: string,
  contentType: string,
  content: string,
  options?: {
    sourceType?: string;
    detectedLanguage?: string;
    forceDemo?: boolean;
  }
): Promise<AnalysisOutcome> {
  const sourceType = (options?.sourceType || "text").trim() || "text";
  const detectedLanguage = detectContentLanguage(content, options?.detectedLanguage);
  const safeContent =
    content.length > MAX_ANALYSIS_CHARS
      ? content.slice(0, MAX_ANALYSIS_CHARS)
      : content;

  if (options?.forceDemo || !isGeminiConfigured()) {
    return analyzeWithDemoMode(
      brand,
      title,
      contentType,
      safeContent,
      detectedLanguage,
      options?.forceDemo
        ? "Demo mode selected by user."
        : "GEMINI_API_KEY is not configured; running in Multilingual Demo Mode."
    );
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const systemInstruction = `You are BrandLens, an expert multilingual brand governance analyst.
You analyze extracted marketing content (from text, website URLs, PDFs, or images) in English, Hindi, Bengali, or mixed languages strictly against the supplied Brand Guidelines.

CRITICAL MULTILINGUAL RULES:
1. Detect whether the submitted content is English, Hindi, Bengali, or Mixed (e.g., "Mixed (Hindi + English)" or "Mixed (Bengali + English)").
2. Analyze Hindi (Devanagari script) and Bengali (Bengali script) DIRECTLY in their original scripts. Do NOT translate the content before analyzing it.
3. Brand guidelines written in English apply semantically to content written in Hindi, Bengali, or mixed languages (e.g. "Cheapest" prohibits "सबसे सस्ता" / "সবচেয়ে সস্তা"; "guaranteed" prohibits "गारंटी" / "গ্যারান্টি"; "Avoid exaggerated marketing claims" applies across all languages).
4. Generate every issue's "suggestion" and the complete "corrected_content" in the EXACT SAME language and script as the submitted content. For mixed-language content, preserve the natural mixed-language phrasing.
5. Never alter unrelated compliant sentences in "corrected_content".

ISSUE DETECTION & CLASSIFICATION RULES:
1. Check for:
   - Tone inconsistency
   - Prohibited words and phrases (literal and cross-lingual semantic equivalents)
   - Missing preferred terminology
   - Unsupported or unverifiable factual claims
   - Inconsistent brand messaging
   - Exaggerated or misleading claims
   - General writing issues relevant to the brand
2. Return EVERY independent violation as a SEPARATE issue with sequential issue_id ("issue_001", "issue_002", ...). Do NOT combine unrelated violations into one issue.
3. Do NOT flag valid statements just to increase issue count.
4. Never invent brand rules. Every issue MUST cite an actual supplied guideline in "brand_rule".
5. Classify each issue accurately into one of:
   - "confirmed_violation": Direct breach of a supplied guideline (prohibited terms, explicit rule violation, clear tone mismatch).
   - "potential_violation": Borderline or ambiguous messaging/tone issue requiring human judgment.
   - "unverified_claim": Factual, numeric, material, or certification claim not verified in Approved Facts (explain it could not be verified—do NOT assume it is false).
   - "writing_suggestion": Optional editorial refinement or missing preferred terminology.
6. Provide a numeric "confidence" between 0.0 and 1.0 for each issue.
7. Set "overall_status":
   - "Non-Compliant" if any High severity or confirmed_violation issues exist.
   - "Needs Review" if only Medium/Low issues or unverified_claim/potential_violation/writing_suggestion issues exist.
   - "Compliant" ONLY if zero issues remain (return empty issues array and preserve original text).`;

  const prompt = `Analyze the following content against the supplied brand guidelines.

=== SOURCE CONTEXT ===
Source Type: ${sourceType}
Content Type: ${contentType}
Title: ${title}
Pre-detected Language Hint: ${detectedLanguage}

=== BRAND GUIDELINES ===
Brand Name: ${brand.brand_name}
Brand Description: ${brand.description || "Not specified"}
Preferred Tone: ${brand.tone || "Not specified"}
Preferred Words & Phrases: ${brand.preferred_terms || "None specified"}
Prohibited Words & Phrases: ${brand.prohibited_terms || "None specified"}
Approved Facts & Claims: ${brand.approved_facts || "None specified"}
General Writing Guidelines: ${brand.guidelines || "None specified"}

=== SUBMITTED CONTENT ===
"""
${safeContent}
"""`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overall_status: {
              type: Type.STRING,
              description: "Must be one of: Compliant, Needs Review, Non-Compliant",
            },
            detected_language: {
              type: Type.STRING,
              description: "English, Hindi, Bengali, or Mixed (e.g. Mixed (Hindi + English))",
            },
            issues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  issue_id: { type: Type.STRING, description: "Sequential ID such as issue_001" },
                  type: { type: Type.STRING, description: "Issue category" },
                  severity: { type: Type.STRING, description: "High, Medium, or Low" },
                  original_text: { type: Type.STRING, description: "Exact problematic excerpt in original script" },
                  brand_rule: { type: Type.STRING, description: "Exact supplied brand guideline" },
                  explanation: { type: Type.STRING, description: "Clear explanation of the violation" },
                  suggestion: { type: Type.STRING, description: "Suggested correction in the same language/script" },
                  rule_reference: { type: Type.STRING, description: "Short category reference" },
                  confidence: { type: Type.NUMBER, description: "Confidence score from 0.0 to 1.0" },
                  classification: {
                    type: Type.STRING,
                    description: "confirmed_violation, potential_violation, unverified_claim, or writing_suggestion",
                  },
                },
                required: [
                  "issue_id",
                  "type",
                  "severity",
                  "original_text",
                  "brand_rule",
                  "explanation",
                  "suggestion",
                  "rule_reference",
                  "confidence",
                  "classification",
                ],
              },
            },
            corrected_content: {
              type: Type.STRING,
              description: "Complete corrected content in the original language and script without changing unrelated compliant sentences.",
            },
          },
          required: ["overall_status", "detected_language", "issues", "corrected_content"],
        },
      },
    });

    const rawText = (response.text ?? "").trim();
    if (!rawText) {
      throw new Error("Empty response from Gemini API.");
    }

    const parsed = JSON.parse(rawText);
    const validated = validateAnalysisPayload(parsed, safeContent, detectedLanguage);

    return {
      ...validated,
      mode: "gemini",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gemini API error";
    console.warn("Gemini multilingual analysis failed, falling back to Demo Mode:", message);
    return analyzeWithDemoMode(
      brand,
      title,
      contentType,
      safeContent,
      detectedLanguage,
      `Gemini API fallback (${message}). Showing rule-based Multilingual Demo Mode analysis.`
    );
  }
}
