import { Button } from '@components/ui/button';

type PreviewErrorFallbackProps = {
  error: unknown;
  onOpenDefinition: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown runtime error.';
}

export function PreviewErrorFallback({ error, onOpenDefinition }: PreviewErrorFallbackProps) {
  return (
    <div
      className="rounded-[1.75rem] border border-rose-200 bg-rose-50/80 p-6 text-slate-700"
      role="alert"
    >
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-rose-700">Preview runtime error</p>
      <h3 className="mt-3 text-lg font-semibold text-slate-950">The committed preview crashed while rendering.</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Review the Definition tab for the current committed source and runtime issue details. The committed source is unchanged.
      </p>
      <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm leading-6 break-words text-slate-700">{getErrorMessage(error)}</p>
      <div className="mt-4">
        <Button type="button" variant="secondary" onClick={onOpenDefinition}>
          Open Definition
        </Button>
      </div>
    </div>
  );
}
