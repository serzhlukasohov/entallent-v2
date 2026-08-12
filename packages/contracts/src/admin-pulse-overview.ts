export interface AdminPulseQuestionRow {
  stableKey: string;
  title: string;
  assessmentStatus: string | null;
}

export interface AdminPulseGroupRow {
  questionGroup: string;
  status: string | null;
  employeeScore: number | null;
  confirmedAt: string | null;
  questions: AdminPulseQuestionRow[];
}

export interface AdminPulseBacklogNextQuestion {
  stableKey: string;
  group: string;
}

export interface AdminPulseBacklogSummary {
  doneCount: number;
  pendingCount: number;
  totalIgnoreCount: number;
  nextQuestion: AdminPulseBacklogNextQuestion | null;
}

export interface AdminPulseEmployeeRow {
  userId: string;
  displayName: string | null;
  groups: AdminPulseGroupRow[];
  backlog: AdminPulseBacklogSummary;
}

export interface AdminPulseOverviewResponse {
  tenantId: string;
  generatedAt: string;
  allGroups: string[];
  employees: AdminPulseEmployeeRow[];
}
