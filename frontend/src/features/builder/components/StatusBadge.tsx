import { Badge } from '@components/ui/badge';
import { cn } from '@lib/utils';
import type { BuilderConnectionStatus } from '@features/builder/types';

const statusConfig: Record<
  BuilderConnectionStatus,
  {
    badgeVariant: 'danger' | 'muted' | 'success';
    dotClassName: string;
    label: string;
  }
> = {
  loading: {
    badgeVariant: 'muted',
    dotClassName: 'bg-slate-400',
    label: 'Backend model: loading...',
  },
  connected: {
    badgeVariant: 'muted',
    dotClassName: 'bg-emerald-500',
    label: 'Backend model',
  },
  disconnected: {
    badgeVariant: 'danger',
    dotClassName: 'bg-rose-500',
    label: 'Backend model: unavailable',
  },
};

interface StatusBadgeProps {
  model?: string;
  status: BuilderConnectionStatus;
}

export function StatusBadge({ status, model }: StatusBadgeProps) {
  const config = statusConfig[status];
  const label = status === 'connected' && model ? `Backend model: ${model}` : config.label;

  return (
    <Badge className="gap-2 text-slate-600" variant={config.badgeVariant}>
      <span className={cn('h-2.5 w-2.5 rounded-full', config.dotClassName)} />
      {label}
    </Badge>
  );
}
