import { reactive as openUiReactive, type Library, type PromptSpec } from '@openuidev/react-lang';
import type { z } from 'zod';

const literalValueBindingSchemas = new WeakSet<object>();

export function actionModeReactive<T extends z.ZodType>(schema: T) {
  const reactiveSchema = openUiReactive(schema);
  literalValueBindingSchemas.add(reactiveSchema);

  return reactiveSchema;
}

function hasLiteralValueBinding(schema: unknown): schema is object {
  return typeof schema === 'object' && schema !== null && literalValueBindingSchemas.has(schema);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includeLiteralValueInBindingSignature(signature: string, propName: string) {
  return signature.replace(
    new RegExp(`(\\b${escapeRegExp(propName)}\\??: )\\$binding<([^>]+)>`),
    (_match, prefix: string, valueType: string) => `${prefix}$binding<${valueType}> | ${valueType}`,
  );
}

export function includeActionModeLiteralValues(spec: PromptSpec, library: Library): PromptSpec {
  return {
    ...spec,
    components: Object.fromEntries(
      Object.entries(spec.components).map(([componentName, componentSpec]) => {
        const component = library.components[componentName];

        if (!component) {
          return [componentName, componentSpec];
        }

        const signature = Object.entries(component.props.shape).reduce((currentSignature, [propName, propSchema]) => {
          return hasLiteralValueBinding(propSchema)
            ? includeLiteralValueInBindingSignature(currentSignature, propName)
            : currentSignature;
        }, componentSpec.signature);

        return [componentName, { ...componentSpec, signature }];
      }),
    ),
  };
}
