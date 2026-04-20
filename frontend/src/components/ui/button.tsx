import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[transform,background-color,color,box-shadow,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/20 active:translate-y-px active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-slate-950 !text-white shadow-sm hover:bg-slate-800 hover:shadow-md',
        secondary: 'bg-white/70 !text-slate-900 ring-1 ring-slate-200 hover:bg-white hover:ring-slate-300 hover:shadow-sm',
        ghost: '!text-slate-700 hover:bg-white/70 hover:text-slate-950',
        destructive: 'bg-rose-600 !text-white hover:bg-rose-500 hover:shadow-md',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-5 text-[0.95rem]',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);

Button.displayName = 'Button';

export { Button };
