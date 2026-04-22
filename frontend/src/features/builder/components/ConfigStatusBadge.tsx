import { Badge } from '@components/ui/badge';
import type { BuilderRuntimeConfigStatus } from '@features/builder/config';
import { cn } from '@lib/utils';

const statusConfig: Record<
  Exclude<BuilderRuntimeConfigStatus, 'loaded'>,
  {
    badgeClassName: string;
    description: string;
    dotClassName: string;
    label: string;
  }
> = {
  loading: {
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-800',
    description: 'Chat send stays disabled until /api/config has loaded.',
    dotClassName: 'bg-amber-500',
    label: 'Runtime config: loading',
  },
  failed: {
    badgeClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    description: 'Chat send is unavailable because /api/config could not be loaded.',
    dotClassName: 'bg-rose-500',
    label: 'Runtime config: unavailable',
  },
};

interface ConfigStatusBadgeProps {
  status: BuilderRuntimeConfigStatus;
}

export function ConfigStatusBadge({ status }: ConfigStatusBadgeProps) {
  if (status === 'loaded') {
    return null;
  }

  const config = statusConfig[status];

  return (
    <Badge className={cn('gap-2', config.badgeClassName)} title={config.description} variant="default">
      <span className={cn('h-2.5 w-2.5 rounded-full', config.dotClassName)} />
      {config.label}
    </Badge>
  );
}
