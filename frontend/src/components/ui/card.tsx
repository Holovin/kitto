import * as React from 'react';
import { cn } from '@lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-[1.75rem] border border-white/60 bg-white/88 text-slate-900 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] backdrop-blur',
      className,
    )}
    {...props}
  />
));

Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
));

CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-xl font-semibold tracking-tight text-slate-950', className)} {...props} />
));

CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn('text-sm text-slate-600', className)} {...props} />,
);

CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('px-6 pb-6', className)} {...props} />
));

CardContent.displayName = 'CardContent';

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
