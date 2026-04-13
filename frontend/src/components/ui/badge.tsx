import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-slate-200 bg-white/80 text-slate-700',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        danger: 'border-rose-200 bg-rose-50 text-rose-700',
        muted: 'border-slate-200 bg-slate-100 text-slate-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
