import { Badge } from '@components/ui/badge';
import { cn } from '@lib/utils';
import { useBackendStatus } from '@features/system/useBackendStatus';

export function StatusBadge() {
  const { model, status } = useBackendStatus();

  const isPending = status === 'booting';
  const isConnected = status === 'healthy';
  const isMisconfigured = status === 'misconfigured';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge
        variant="outline"
        className={cn(
          'gap-2 rounded-full px-4 py-2 text-sm font-normal',
          isMisconfigured
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-950'
            : 'border-border/80 bg-background/70 text-foreground',
        )}
      >
        <span
          className={cn(
            'size-2 rounded-full',
            isPending && 'bg-slate-400',
            isConnected && 'bg-emerald-500',
            isMisconfigured && 'bg-amber-500',
            !isPending && !isConnected && !isMisconfigured && 'bg-rose-500',
          )}
        />
        <span>
          {isPending
            ? 'Loading backend'
            : isConnected
              ? 'Backend connected'
              : isMisconfigured
                ? 'Backend reachable, OpenAI not configured'
                : 'Backend disconnected'}
        </span>
      </Badge>
      <Badge variant="outline" className="rounded-full border-border/80 bg-background/70 px-4 py-2 text-sm font-normal text-muted-foreground">
        Backend model: {model}
      </Badge>
    </div>
  );
}
