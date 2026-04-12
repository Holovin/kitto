import { Badge } from '@components/ui/badge';
import { cn } from '@lib/utils';
import { useHealthQuery } from '@api/apiSlice';

export function StatusBadge() {
  const { data, error, isLoading, isFetching } = useHealthQuery(undefined, {
    pollingInterval: 30000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const isConnected = Boolean(data) && !error;
  const isPending = (isLoading || isFetching) && !data && !error;
  const modelLabel = data?.model ?? 'gpt-5.4-mini';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="outline" className="gap-2 rounded-full border-border/80 bg-background/70 px-4 py-2 text-sm font-normal text-foreground">
        <span
          className={cn(
            'size-2 rounded-full',
            isPending && 'bg-slate-400',
            isConnected && 'bg-emerald-500',
            !isPending && !isConnected && 'bg-rose-500',
          )}
        />
        <span>{isPending ? 'Loading backend' : isConnected ? 'Backend connected' : 'Backend disconnected'}</span>
      </Badge>
      <Badge variant="outline" className="rounded-full border-border/80 bg-background/70 px-4 py-2 text-sm font-normal text-muted-foreground">
        Backend model: {modelLabel}
      </Badge>
    </div>
  );
}
