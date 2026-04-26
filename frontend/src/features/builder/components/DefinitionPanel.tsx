import { Textarea } from '@components/ui/textarea';
import type { PromptBuildValidationIssue } from '@features/builder/types';

interface DefinitionPanelProps {
  issues: PromptBuildValidationIssue[];
  source: string;
  warnings: PromptBuildValidationIssue[];
}

export function DefinitionPanel({ issues, source, warnings }: DefinitionPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Textarea className="min-h-0 flex-1 font-mono text-xs leading-5" readOnly value={source} />

      {issues.length > 0 ? (
        <div className="shrink-0 space-y-2 rounded-[1.5rem] border border-rose-200 bg-rose-50/80 p-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-rose-700">Parse and runtime issues</p>
          <div className="space-y-2">
            {issues.map((issue, index) => (
              <div key={`${issue.code}-${issue.statementId ?? 'global'}-${index}`} className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">
                <strong className="text-slate-900">{issue.code}</strong>
                {issue.statementId ? ` in ${issue.statementId}` : null}
                : {issue.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="shrink-0 space-y-2 rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-amber-700">Generation quality warnings</p>
          <div className="space-y-2">
            {warnings.map((warning, index) => (
              <div
                key={`${warning.code}-${warning.statementId ?? 'global'}-${index}`}
                className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700"
              >
                <strong className="text-slate-900">{warning.code}</strong>
                {warning.statementId ? ` in ${warning.statementId}` : null}
                : {warning.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
