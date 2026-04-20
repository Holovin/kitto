import { TriangleAlert } from 'lucide-react';

export function PreviewUnavailableState() {
  return (
    <div className="flex min-h-[36rem] flex-col items-center justify-center gap-6 text-center">
      <div className="space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100/90 text-rose-400">
          <TriangleAlert className="h-7 w-7" />
        </div>
        <h3 className="text-3xl font-semibold tracking-tight text-slate-950">Preview is unavailable</h3>
        <p className="max-w-lg text-sm leading-6 text-slate-600">
          The current definition has validation issues, so Preview cannot render it safely. Review the Definition tab for details.
        </p>
      </div>
    </div>
  );
}
