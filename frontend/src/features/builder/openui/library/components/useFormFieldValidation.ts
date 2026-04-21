import { useId, useState } from 'react';
import {
  getValidationFeedback,
  sanitizeValidationRules,
  useKittoValidationInteraction,
  useRegisterKittoValidationField,
  type ValidationRule,
  type ValidationRuleConfig,
  type ValidationTarget,
} from './shared';

type FormFieldValidationAriaProps = {
  'aria-describedby'?: string;
  'aria-invalid': boolean;
};

type UseFormFieldValidationArgs = {
  helper?: string | null;
  name: string;
  skip?: boolean;
  target: ValidationTarget;
  validation?: ValidationRuleConfig[];
  value: unknown;
};

type UseFormFieldValidationResult = {
  ariaProps: FormFieldValidationAriaProps;
  hasVisibleError: boolean;
  helperText?: string;
  onBlur: () => void;
  rules: ValidationRule[];
};

const EMPTY_RULES: ValidationRule[] = [];
const noop = () => undefined;

export function useFormFieldValidation(args: UseFormFieldValidationArgs): UseFormFieldValidationResult {
  const { helper, name, skip = false, target, validation, value } = args;
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const { interactedNames } = useKittoValidationInteraction();

  useRegisterKittoValidationField(skip ? '' : name);

  if (skip) {
    return {
      ariaProps: {
        'aria-describedby': helper ? feedbackId : undefined,
        'aria-invalid': false,
      },
      hasVisibleError: false,
      helperText: helper ?? undefined,
      onBlur: noop,
      rules: EMPTY_RULES,
    };
  }

  const rules = sanitizeValidationRules(target, validation);
  const { hasVisibleError, helperText } = getValidationFeedback({
    helper,
    interactedNames,
    name,
    rules,
    target,
    touched,
    value,
  });
  const onBlur = () => {
    setTouched(true);
  };

  return {
    ariaProps: {
      'aria-describedby': helperText ? feedbackId : undefined,
      'aria-invalid': hasVisibleError,
    },
    hasVisibleError,
    helperText,
    onBlur,
    rules,
  };
}
