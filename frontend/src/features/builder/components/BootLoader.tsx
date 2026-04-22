import { LoaderCircle } from 'lucide-react';

export function BootLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/10 px-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-[2rem] border border-white/70 bg-white/92 px-8 py-10 text-center shadow-[0_32px_90px_-42px_rgba(15,23,42,0.45)]">
        <LoaderCircle className="h-9 w-9 animate-spin text-slate-900" />
        <div className="space-y-1">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Kitto boot</p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Connecting to the backend</h2>
          <p className="text-sm leading-6 text-slate-600">
            The fullscreen loader stays visible until the initial backend health check finishes.
          </p>
        </div>
      </div>
    </div>
  );
}
