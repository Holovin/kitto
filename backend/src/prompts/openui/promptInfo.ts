import type { AppEnv } from '../../env.js';
import { openUiEnvelopeFormat } from '../../services/openai/envelope.js';
import { getOpenUiMaxOutputTokens, getOpenUiTemperature } from './requestConfig.js';
import {
  OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
  buildOpenUiSystemPrompt,
  getOpenUiSystemPromptHash,
} from './systemPrompt.js';
import { getPromptToolSpecSummaries, type PromptToolSpecSummary } from './toolSpecs.js';
import { buildOpenUiUserPromptTemplate } from './userPrompt.js';

const REPAIR_PROMPT_CRITICAL_RULES = [
  'Return only raw OpenUI Lang.',
  'Return the full updated program.',
  'Use only supported components and tools.',
  'Every @Run(ref) must reference a defined Query or Mutation.',
  'AppShell signature is AppShell(children, appearance?).',
  'Screen signature is Screen(id, title, children, isActive?, appearance?).',
  'Group signature is Group(title, direction, children, variant?, appearance?).',
  'The second Group argument is direction and must be "vertical" or "horizontal".',
  'If you pass a Group variant, place it in the optional fourth argument.',
  'Never put "block" or "inline" in the second Group argument.',
  'Use appearance only as { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }.',
  'Text supports only appearance.contrastColor. Do not pass appearance.mainColor to Text.',
  'For Button default, contrastColor becomes the button background and mainColor becomes the button text.',
  'Never use CSS, className, style objects, named colors, rgb(), hsl(), var(), url(), or arbitrary layout styling.',
  'Use $currentScreen + @Set for screen navigation.',
  'Button signature is Button(id, label, variant, action?, disabled?, appearance?).',
] as const;

export interface PromptInfoSnapshot {
  config: {
    cacheKeyPrefix: string;
    maxOutputTokens: number;
    model: string;
    outputMaxBytes: number;
    requestMaxBytes: number;
    structuredOutput: boolean;
    temperature: number;
  };
  envelopeSchema: Record<string, unknown>;
  repairPromptTemplate: string;
  systemPrompt: {
    hash: string;
    text: string;
  };
  toolSpecs: PromptToolSpecSummary[];
  userPromptTemplate: string;
}

let cachedPromptInfoSnapshot: { cacheKey: string; snapshot: PromptInfoSnapshot } | null = null;

function buildPromptInfoSnapshotCacheKey(env: AppEnv) {
  return JSON.stringify({
    model: env.OPENAI_MODEL,
    outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
    requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    structuredOutput: env.LLM_STRUCTURED_OUTPUT,
  });
}

function buildRepairPromptTemplate() {
  return [
    'The previous OpenUI draft cannot be committed yet. Automatic repair attempt {{attemptNumber}} of 1.',
    'The draft may have validation issues and/or product-quality issues.',
    'Use the current committed valid OpenUI source as the baseline for this request.',
    'Stay close to the model draft below where possible, and fix only the listed issues.',
    'Do not rewrite unrelated parts or introduce new features.',
    'Return a complete corrected program.',
    '',
    'Original user request:',
    '{{userPrompt}}',
    '',
    'Current committed valid OpenUI source:',
    '{{committedSource}}',
    '',
    'Model draft to repair:',
    '{{invalidSource}}',
    '',
    'Validation and/or quality issues:',
    '- {{issue.code}} in {{statementId}}: {{message}}',
    '',
    'Targeted repair hints:',
    '- {{hint}}',
    '- (omit this section when there are no targeted hints)',
    '',
    'Current critical syntax rules:',
    ...REPAIR_PROMPT_CRITICAL_RULES.map((rule) => `- ${rule}`),
  ].join('\n');
}

export function getPromptInfoSnapshot(env: AppEnv): PromptInfoSnapshot {
  const cacheKey = buildPromptInfoSnapshotCacheKey(env);

  if (cachedPromptInfoSnapshot?.cacheKey === cacheKey) {
    return cachedPromptInfoSnapshot.snapshot;
  }

  const structuredOutput = env.LLM_STRUCTURED_OUTPUT;
  const snapshot: PromptInfoSnapshot = {
    config: {
      cacheKeyPrefix: OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX,
      maxOutputTokens: getOpenUiMaxOutputTokens(env),
      model: env.OPENAI_MODEL,
      outputMaxBytes: env.LLM_OUTPUT_MAX_BYTES,
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
      structuredOutput,
      temperature: getOpenUiTemperature('initial'),
    },
    envelopeSchema: structuredClone(openUiEnvelopeFormat.schema) as Record<string, unknown>,
    repairPromptTemplate: buildRepairPromptTemplate(),
    systemPrompt: {
      hash: getOpenUiSystemPromptHash({ structuredOutput }),
      text: buildOpenUiSystemPrompt({ structuredOutput }),
    },
    toolSpecs: [...getPromptToolSpecSummaries()],
    userPromptTemplate: buildOpenUiUserPromptTemplate({ structuredOutput }),
  };

  cachedPromptInfoSnapshot = {
    cacheKey,
    snapshot,
  };

  return snapshot;
}
