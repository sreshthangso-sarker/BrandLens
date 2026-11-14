export type AnalysisStatus = "Compliant" | "Needs Review" | "Non-Compliant";
export type ApprovalStatus =
  | "Pending Review"
  | "Approved Original"
  | "Approved Corrected"
  | "Rejected";
export type SeverityLevel = "High" | "Medium" | "Low";
export type PageView =
  | "dashboard"
  | "guidelines"
  | "checker"
  | "results"
  | "review"
  | "history";

export interface Brand {
  id: number;
  brand_name: string;
  description: string;
  tone: string;
  preferred_terms: string;
  prohibited_terms: string;
  approved_facts: string;
  guidelines: string;
  created_at: string;
}

export interface BrandInput {
  brand_name: string;
  description: string;
  tone: string;
  preferred_terms: string;
  prohibited_terms: string;
  approved_facts: string;
  guidelines: string;
}

export type IssueClassification =
  | "confirmed_violation"
  | "potential_violation"
  | "unverified_claim"
  | "writing_suggestion";

export type IssueDecision = "pending" | "accepted" | "rejected";
export type CorrectionDecision = "pending" | "accepted" | "rejected" | "edited";
export type SuggestionStatus = "pending" | "approved" | "rejected";
export type GuidelineTargetField =
  | "tone"
  | "preferred_terms"
  | "prohibited_terms"
  | "approved_facts"
  | "guidelines";

export interface ContentItem {
  id: number;
  brand_id: number;
  title: string;
  content_type: string;
  source_type?: string;
  detected_language?: string;
  original_content: string;
  corrected_content: string;
  final_content: string;
  analysis_status: AnalysisStatus;
  approval_status: ApprovalStatus;
  analysis_mode: "gemini" | "demo";
  review_notes: string;
  created_at: string;
}

export interface AnalysisIssue {
  id: number;
  content_id: number;
  issue_id?: string;
  issue_type: string;
  severity: SeverityLevel;
  original_text: string;
  brand_rule: string;
  explanation: string;
  suggested_correction: string;
  rule_reference: string;
  confidence?: number;
  classification?: IssueClassification;
  review_record_id?: number | null;
  decision?: IssueDecision;
  reviewer_reason?: string;
  correction_decision?: CorrectionDecision;
  final_corrected_text?: string;
  reviewed_at?: string | null;
}

export interface RelatedReviewDecision {
  issue_id: string;
  issue_type: string;
  decision: "accepted" | "rejected";
  reviewer_reason: string;
  original_text: string;
  correction_decision: string;
  final_corrected_text: string;
}

export interface GuidelineSuggestion {
  id: number;
  brand_id: number;
  target_field: GuidelineTargetField;
  existing_guideline: string;
  proposed_guideline: string;
  reason: string;
  related_decisions: RelatedReviewDecision[];
  status: SuggestionStatus;
  created_at: string;
  approved_at: string | null;
}

export interface HistoryItem extends ContentItem {
  brand_name: string;
  issue_count: number;
}

export interface DashboardStats {
  total_analyzed: number;
  compliant_count: number;
  needs_review_count: number;
  non_compliant_count: number;
  pending_approval_count: number;
  approved_count: number;
  rejected_count: number;
}

export interface AnalysisDetailResponse {
  overall_status?: AnalysisStatus;
  detected_language?: string;
  source_type?: string;
  corrected_content?: string;
  content: ContentItem;
  brand: Brand;
  issues: AnalysisIssue[];
  analysis_mode?: "gemini" | "demo";
  fallback_reason?: string;
}

export type IngestSourceType = "text" | "url" | "pdf" | "image";

export interface IngestResponse {
  success: boolean;
  source_type: IngestSourceType;
  source_name: string;
  title?: string;
  detected_language: string;
  extracted_text: string;
  message: string;
  extraction_method?: string;
}

export interface HealthResponse {
  status: string;
  database: string;
  ai_mode: "gemini" | "demo";
  model: string;
}
