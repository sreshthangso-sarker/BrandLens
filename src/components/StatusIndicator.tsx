import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { AnalysisStatus, ApprovalStatus, SeverityLevel } from "../types.ts";

export function AnalysisStatusLabel({ status }: { status: AnalysisStatus }) {
  if (status === "Compliant") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        Compliant
      </span>
    );
  }
  if (status === "Needs Review") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
        Needs Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 whitespace-nowrap">
      <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-rose-600" />
      Non-Compliant
    </span>
  );
}

export function ApprovalStatusLabel({ status }: { status: ApprovalStatus }) {
  if (status === "Approved Original" || status === "Approved Corrected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        {status}
      </span>
    );
  }
  if (status === "Rejected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0 text-[#4DA6FF]" />
      Pending Review
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: SeverityLevel }) {
  if (severity === "High") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
        High Severity
      </span>
    );
  }
  if (severity === "Medium") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
        Medium Severity
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#6B5CE7] whitespace-nowrap">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#6B5CE7]" />
      Low Severity
    </span>
  );
}
