import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { escapeStringLiteralBackticksForParser } from '@kitto-openui/shared/openuiAst.js';
import { ChevronDown, Download, FileUp, Info, LoaderCircle, MoreHorizontal, RotateCcw, X } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { useConfigQuery, useGetPromptsInfoQuery } from '@api/apiSlice';
import { Button } from '@components/ui/button';
import { Card, CardContent } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { getBuilderRuntimeConfigStatus } from '@pages/Chat/builder/config';
import { DefinitionPanel } from '@pages/Chat/builder/components/DefinitionPanel';
import { PreviewEmptyState } from '@pages/Chat/builder/components/PreviewEmptyState';
import { PreviewErrorFallback } from '@pages/Chat/builder/components/PreviewErrorFallback';
import { resolvePreviewCanvasState } from '@pages/Chat/builder/components/previewCanvasState';
import { PreviewUnavailableState } from '@pages/Chat/builder/components/PreviewUnavailableState';
import {
  applyBackendPromptContextDisplayMetadata,
  buildStaticPromptInfoContextSections,
  type ContextMeterSection,
} from '@pages/Chat/builder/hooks/generationContext';
import { useBuilderHistoryControls } from '@pages/Chat/builder/hooks/useBuilderHistoryControls';
import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';
import { handleOpenUiActionEvent } from '@pages/Chat/builder/openui/runtime/actionEvents';
import {
  combinePreviewIssues,
  createRendererCrashIssue,
  mapOpenUiErrorsToIssues,
  mapParseResultToIssues,
  shouldResetRuntimeIssues,
} from '@pages/Chat/builder/openui/runtime/issues';
import { createBuilderToolProvider } from '@pages/Chat/builder/openui/runtime/toolProvider';
import {
  selectActiveTab,
  selectDefinitionWarnings,
  selectDefinitionSource,
  selectDomainData,
  selectHasRejectedDefinition,
  selectHistory,
  selectIsStreaming,
  selectLastPromptContext,
  selectLastStreamChunkAt,
  selectParseIssues,
  selectPreviewSource,
  selectRuntimeSessionState,
  selectStreamedSource,
  selectStreamingStatus,
} from '@pages/Chat/builder/store/selectors';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { clonePersistedDomainData, clonePersistedRuntimeState } from '@pages/Chat/builder/store/path';
import type { BuilderChatNotice, PromptBuildValidationIssue, BuilderTabId } from '@pages/Chat/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';

type ScopedRuntimeIssues = {
  issues: PromptBuildValidationIssue[];
  scope: string;
};

interface PreviewTabsProps {
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

interface PreviewStreamingOverlayProps {
  isPreviewEmptyCanvas: boolean;
  lastStreamChunkAt: number | null;
  streamingStatus: string | null;
  streamedSourceBytes: number;
}

interface ContextPanelProps {
  incompleteNotice?: string;
  sections: ContextMeterSection[];
}

type StreamingTimerTick = {
  clockMs: number;
  startedAt: number;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function createDomainDataCell(initialData: Record<string, unknown>) {
  let currentData = initialData;

  return {
    read: () => currentData,
    replace: (nextData: Record<string, unknown>) => {
      currentData = nextData;
    },
  };
}

const textEncoder = new TextEncoder();
const STREAM_ACTIVE_WINDOW_MS = 2_500;

function getByteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

function formatByteCount(bytes: number) {
  if (bytes < 1_024) {
    return `${new Intl.NumberFormat().format(bytes)} B`;
  }

  if (bytes < 1_048_576) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_024)} KB`;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`;
}

function formatCharCount(chars: number) {
  return String(chars);
}

function formatContextSectionChars(section: ContextMeterSection) {
  const baseChars = formatCharCount(section.chars);

  if (section.unminifiedChars === undefined || section.unminifiedChars === section.chars) {
    return baseChars;
  }

  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{baseChars}</span>
      <span className="text-[0.68rem] text-slate-500">({formatCharCount(section.unminifiedChars)})</span>
    </span>
  );
}

function formatContextSectionCharsTitle(section: ContextMeterSection) {
  const baseChars = formatCharCount(section.chars);

  return section.unminifiedChars === undefined || section.unminifiedChars === section.chars
    ? baseChars
    : `${baseChars} (${formatCharCount(section.unminifiedChars)})`;
}

function getContextSectionLimitLabels(section: ContextMeterSection) {
  if (section.limitLabels?.length) {
    return section.limitLabels;
  }

  return ['-'];
}

function formatContextLimitLabel(label: string) {
  const normalizedLabel = label.replace(/^optional context target\s+/, '').replace(/^global\s+/, '');

  return normalizedLabel.replace(/^LLM_MODEL_PROMPT_/, '').replace(/^LLM_/, '').replace('_BYTES', '');
}

function formatContextLimitLabelParts(label: string) {
  const formattedLabel = formatContextLimitLabel(label);
  const match = /^(.*?)(\d+)$/.exec(formattedLabel);

  if (!match) {
    return {
      name: formattedLabel,
      value: '',
    };
  }

  return {
    name: match[1]?.trimEnd() ?? formattedLabel,
    value: match[2] ?? '',
  };
}

function formatFullContextLimitLabel(label: string) {
  return label.replace(/^optional context target\s+/, '').replace(/^global\s+/, '');
}

function getContextLimitDescription(label: string) {
  const normalizedLabel = formatFullContextLimitLabel(label);

  if (normalizedLabel.startsWith('LLM_MODEL_PROMPT_MAX_CHARS ')) {
    return 'Target character budget used to trim optional prompt context. Protected prompt sections can make the full request larger.';
  }

  if (normalizedLabel.startsWith('LLM_REQUEST_MAX_BYTES ')) {
    return 'Maximum backend API request body size accepted for a generation request.';
  }

  if (normalizedLabel.startsWith('LLM_OUTPUT_MAX_BYTES ')) {
    return 'Maximum model response size the backend will accept and return.';
  }

  return null;
}

function formatContextSectionBudget(section: ContextMeterSection) {
  if (section.budgetLabel !== undefined) {
    return section.budgetLabel;
  }

  return section.protected ? 'Protected' : 'Optional';
}

function tryFormatJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return null;
  }
}

function formatContextSectionContent(content: string) {
  const trimmedContent = content.trim();
  const formattedJson = tryFormatJson(trimmedContent);

  if (formattedJson !== null) {
    return formattedJson;
  }

  let formattedBlockCount = 0;
  const formattedContent = content.replace(/<([A-Za-z_][\w-]*)>\n([\s\S]*?)\n<\/\1>/g, (block, tagName: string, blockContent: string) => {
    const formattedBlockJson = tryFormatJson(blockContent.trim());

    if (formattedBlockJson === null) {
      return block;
    }

    formattedBlockCount += 1;
    return `<${tagName}>\n${formattedBlockJson}\n</${tagName}>`;
  });

  return formattedBlockCount > 0 ? formattedContent : content;
}

function getContextSectionStatus(section: ContextMeterSection) {
  return section.included ? '✅' : '➖';
}

function getContextSectionStatusLabel(section: ContextMeterSection) {
  if (section.included) {
    return section.reason ? `Included: ${section.reason}` : 'Included';
  }

  return section.reason ?? 'Not included';
}

function ContextPanel({ incompleteNotice, sections }: ContextPanelProps) {
  const [expandedSectionName, setExpandedSectionName] = useState<string | null>(null);
  const expandedSection = expandedSectionName ? sections.find((section) => section.name === expandedSectionName) : null;
  const visibleSections = expandedSection ? [expandedSection] : sections;

  return (
    <Card className="h-full min-h-0 min-w-0 overflow-hidden border-white/70 bg-white/92">
      <CardContent className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-6">
        <div className="kitto-context-table-scroll min-h-0 min-w-0 flex-1 overflow-auto rounded-[1.25rem] border border-slate-200">
          <table className={`w-full min-w-[44rem] table-fixed border-collapse text-left text-sm ${expandedSection ? 'h-full' : ''}`}>
            <colgroup>
              <col style={{ width: '9%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '27%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead className="sticky top-0 bg-slate-50 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="w-16 whitespace-nowrap border-b border-slate-200 py-3 pl-3 pr-2">Prio</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3">Section</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3">Chars</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3">Limits</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3">Used</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3">Budget</th>
                <th className="border-b border-slate-200 px-3 py-3" aria-label="Expand row" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSections.map((section) => {
                const isExpanded = expandedSectionName === section.name;
                const limitLabels = getContextSectionLimitLabels(section);
                const hasLimitDescriptions = limitLabels.some((label) => getContextLimitDescription(label) !== null);
                const hasLimitValues = limitLabels.some((label) => formatContextLimitLabelParts(label).value !== '');
                const hasCustomBudgetLabel = section.budgetLabel !== undefined;

                return (
                  <Fragment key={section.name}>
                    <tr
                      aria-expanded={isExpanded}
                      className={`${section.protected ? 'bg-emerald-50/45' : 'bg-white'} ${section.name === 'GLOBAL' ? 'border-b-2 border-slate-300' : ''} cursor-pointer hover:bg-slate-50`}
                      tabIndex={0}
                      onClick={() => setExpandedSectionName((currentName) => (currentName === section.name ? null : section.name))}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }

                        event.preventDefault();
                        setExpandedSectionName((currentName) => (currentName === section.name ? null : section.name));
                      }}
                    >
                      <td className="overflow-hidden py-3 pl-3 pr-2 tabular-nums text-slate-600">{section.priority}</td>
                      <td className="truncate px-2 py-3 font-medium text-slate-900" title={section.name}>
                        {section.name}
                      </td>
                      <td className="truncate px-2 py-3 font-mono tabular-nums text-slate-700" title={formatContextSectionCharsTitle(section)}>
                        {formatContextSectionChars(section)}
                      </td>
                      <td className="overflow-visible px-2 py-3 font-mono">
                        <span
                          className={
                            hasLimitDescriptions
                              ? 'inline-grid max-w-full min-w-0 grid-cols-[minmax(0,1fr)_6ch_auto] items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                              : hasLimitValues
                                ? 'inline-grid max-w-full min-w-0 grid-cols-[max-content_auto] items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                                : 'inline-flex max-w-full min-w-0 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                          }
                        >
                          {limitLabels.map((label) => {
                            const description = getContextLimitDescription(label);
                            const labelParts = formatContextLimitLabelParts(label);

                            if (!hasLimitValues) {
                              return (
                                <span key={label} className="min-w-0 truncate" title={formatFullContextLimitLabel(label)}>
                                  {labelParts.name}
                                </span>
                              );
                            }

                            return (
                              <Fragment key={label}>
                                <span className="min-w-0 truncate" title={formatFullContextLimitLabel(label)}>
                                  {labelParts.name}
                                </span>
                                <span className="text-left tabular-nums">{labelParts.value}</span>
                                {hasLimitDescriptions ? (
                                  description ? (
                                    <span className="group relative inline-flex">
                                      <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-80 -translate-x-1/2 whitespace-normal rounded-lg border border-slate-200 bg-slate-950 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg group-hover:block">
                                        <span className="block font-semibold">{formatFullContextLimitLabel(label)}</span>
                                        <span className="mt-1 block">{description}</span>
                                      </span>
                                    </span>
                                  ) : (
                                    <span aria-hidden="true" />
                                  )
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </span>
                      </td>
                      <td
                        className="px-2 py-3 text-lg leading-none"
                        aria-label={getContextSectionStatusLabel(section)}
                        title={getContextSectionStatusLabel(section)}
                      >
                        {getContextSectionStatus(section)}
                      </td>
                      <td className="overflow-hidden px-2 py-3">
                        <span
                          className={
                            hasCustomBudgetLabel
                              ? 'inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                              : section.protected
                              ? 'inline-flex rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800'
                              : 'inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                          }
                          title={formatContextSectionBudget(section)}
                        >
                          {formatContextSectionBudget(section)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-400">
                        {isExpanded ? (
                          <X className="mx-auto h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="mx-auto h-4 w-4" aria-hidden="true" />
                        )}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${section.name}-details`} className={`${section.protected ? 'bg-sky-50/80' : 'bg-sky-50/70'} h-full`}>
                        <td colSpan={7} className="h-full max-w-0 px-4 pb-4 pt-3 align-top">
                          <div className="h-full min-w-0 max-w-full overflow-hidden">
                            <textarea
                              className="box-border block h-full min-h-[25rem] w-full min-w-0 max-w-full resize-none overflow-x-auto overflow-y-auto whitespace-pre rounded-lg border border-sky-200 bg-white p-3 font-mono text-xs leading-5 text-slate-800 shadow-inner outline-none"
                              readOnly
                              wrap="off"
                              value={formatContextSectionContent(section.content)}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {incompleteNotice ? (
          <div className="shrink-0 space-y-2 rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-4">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-amber-700">Context data incomplete</p>
            <div className="rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">{incompleteNotice}</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PreviewStreamingOverlay({
  isPreviewEmptyCanvas,
  lastStreamChunkAt,
  streamingStatus,
  streamedSourceBytes,
}: PreviewStreamingOverlayProps) {
  const [timerTick, setTimerTick] = useState<StreamingTimerTick | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setTimerTick({
        clockMs: Date.now(),
        startedAt,
      });
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const previewOverlayLabel = isPreviewEmptyCanvas ? 'Generating...' : 'Updating...';
  const elapsedStreamingSeconds = timerTick ? Math.floor((timerTick.clockMs - timerTick.startedAt) / 1_000) : 0;
  const previewOverlayTimerLabel = `${elapsedStreamingSeconds}s elapsed`;
  const streamAgeMs = lastStreamChunkAt === null ? null : Math.max(0, (timerTick?.clockMs ?? lastStreamChunkAt) - lastStreamChunkAt);
  const previewOverlayStatusLabel =
    streamingStatus ?? (lastStreamChunkAt === null
      ? 'Waiting for first chunk'
      : streamAgeMs !== null && streamAgeMs <= STREAM_ACTIVE_WINDOW_MS
        ? 'Stream active'
        : 'Finalizing response');
  const previewOverlayPrimaryLabel = `${previewOverlayLabel} · ${previewOverlayTimerLabel}`;
  const previewOverlaySecondaryLabel = `${previewOverlayStatusLabel} · ${formatByteCount(streamedSourceBytes)} draft`;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[1.75rem] bg-white/60 backdrop-blur-[1px]">
      <div
        aria-live="polite"
        className="flex min-w-[350px] items-center gap-3 rounded-full border border-slate-200/80 bg-white/90 px-5 py-4 text-slate-900 shadow-lg"
        role="status"
      >
        <LoaderCircle className="h-7 w-7 animate-spin" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{previewOverlayPrimaryLabel}</span>
          <span className="text-xs text-slate-500">{previewOverlaySecondaryLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function PreviewTabs({ onSystemNotice }: PreviewTabsProps) {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(selectActiveTab);
  const definitionWarnings = useAppSelector(selectDefinitionWarnings);
  const definitionSource = useAppSelector(selectDefinitionSource);
  const domainData = useAppSelector(selectDomainData);
  const history = useAppSelector(selectHistory);
  const isShowingRejectedDefinition = useAppSelector(selectHasRejectedDefinition);
  const isStreaming = useAppSelector(selectIsStreaming);
  const lastPromptContext = useAppSelector(selectLastPromptContext);
  const lastStreamChunkAt = useAppSelector(selectLastStreamChunkAt);
  const parseIssues = useAppSelector(selectParseIssues);
  const previewSource = useAppSelector(selectPreviewSource);
  const runtimeSessionState = useAppSelector(selectRuntimeSessionState);
  const streamedSource = useAppSelector(selectStreamedSource);
  const streamingStatus = useAppSelector(selectStreamingStatus);
  const configState = useConfigQuery(undefined, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const configStatus = getBuilderRuntimeConfigStatus(configState);
  const [scopedRuntimeIssues, setScopedRuntimeIssues] = useState<ScopedRuntimeIssues>({
    issues: [],
    scope: '',
  });
  const [rendererResetVersion, setRendererResetVersion] = useState(0);
  const currentSnapshot = history.at(-1);
  const currentSnapshotCommittedAt = currentSnapshot?.committedAt ?? '';
  const previewRenderInput = useMemo(
    () => ({
      key: `${history.length}:${currentSnapshotCommittedAt}:${previewSource}`,
      source: previewSource,
    }),
    [currentSnapshotCommittedAt, history.length, previewSource],
  );
  const deferredPreviewRender = useDeferredValue(previewRenderInput);
  const deferredPreviewSource = deferredPreviewRender.source;
  const deferredPreviewParserSource = useMemo(
    () => escapeStringLiteralBackticksForParser(deferredPreviewSource),
    [deferredPreviewSource],
  );
  const isPreviewSynchronized = deferredPreviewSource === previewSource;
  const previewCanvasState = resolvePreviewCanvasState({
    isShowingRejectedDefinition,
    previewSource: deferredPreviewSource,
  });
  const isPreviewEmptyCanvas = previewCanvasState !== 'preview';
  const isPreviewUnavailable = previewCanvasState === 'unavailable';
  const isEmptyCanvas = previewCanvasState === 'empty';
  const isContextTabDisabled = configStatus === 'failed' || isEmptyCanvas;
  const promptsInfoState = useGetPromptsInfoQuery(undefined, {
    skip: isContextTabDisabled || activeTab !== 'context',
  });
  const resolvedActiveTab =
    (isEmptyCanvas && (activeTab === 'definition' || activeTab === 'app-state')) ||
    (isContextTabDisabled && activeTab === 'context')
      ? 'preview'
      : activeTab;
  const runtimeIssueScope = `${history.length}:${currentSnapshot?.committedAt ?? ''}:${previewSource}:${isShowingRejectedDefinition ? 'rejected' : 'preview'}:${rendererResetVersion}`;
  const runtimeIssues = scopedRuntimeIssues.scope === runtimeIssueScope ? scopedRuntimeIssues.issues : [];
  const toolProvider = useMemo(
    () => {
      const domainDataCell = createDomainDataCell(domainData);

      return createBuilderToolProvider({
        readDomainData: domainDataCell.read,
        replaceDomainData: (nextData) => {
          domainDataCell.replace(nextData);
          dispatch(domainActions.replaceData(nextData));
        },
        syncLatestSnapshotDomainData: (nextData) => {
          dispatch(builderActions.syncLatestSnapshotState({ domainData: nextData }));
        },
      });
    },
    [dispatch, domainData],
  );
  const combinedIssues = combinePreviewIssues({
    isPreviewEmptyCanvas,
    isShowingRejectedDefinition,
    parseIssues,
    runtimeIssues,
  });
  const streamedSourceBytes = getByteLength(streamedSource);
  const contextMeterSections = useMemo(() => {
    return lastPromptContext
      ? applyBackendPromptContextDisplayMetadata(lastPromptContext.sections, promptsInfoState.data)
      : buildStaticPromptInfoContextSections(promptsInfoState.data);
  }, [lastPromptContext, promptsInfoState.data]);
  const contextIncompleteNotice =
    promptsInfoState.isLoading || promptsInfoState.isFetching || promptsInfoState.isUninitialized
      ? 'Prompt config is still loading, so the table may only contain temporary placeholders.'
      : !lastPromptContext
        ? 'No generation request has completed yet. The table shows static prompt config and waiting placeholders, not the full last LLM request.'
        : undefined;
  const previousPreviewRef = useRef<{
    isShowingRejectedDefinition: boolean;
    previewSource: string;
  } | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const {
    canExport,
    canDownloadStandalone,
    fileInputRef,
    preloadStandaloneHtml,
    handleDownloadStandalone,
    handleExport,
    handleImport,
  } = useBuilderHistoryControls({
    onSystemNotice,
  });
  const toolbarButtonClassName =
    'h-11 w-11 rounded-full border border-slate-200 bg-white/80 p-0 text-slate-700 shadow-none hover:bg-white hover:text-slate-950';
  const fileMenuItemClassName =
    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent disabled:hover:text-slate-400';

  useEffect(() => {
    if (!isEmptyCanvas || activeTab === 'preview') {
      return;
    }

    dispatch(builderActions.setActiveTab('preview'));
  }, [activeTab, dispatch, isEmptyCanvas]);

  useEffect(() => {
    const previousPreview = previousPreviewRef.current;
    previousPreviewRef.current = {
      isShowingRejectedDefinition,
      previewSource,
    };

    if (
      !shouldResetRuntimeIssues({
        nextPreviewSource: previewSource,
        nextRejectedDefinition: isShowingRejectedDefinition,
        previousPreviewSource: previousPreview?.previewSource ?? null,
        previousRejectedDefinition: previousPreview?.isShowingRejectedDefinition ?? null,
      })
    ) {
      return;
    }

    if (!isShowingRejectedDefinition) {
      dispatch(builderActions.setParseIssues([]));
    }
  }, [dispatch, isShowingRejectedDefinition, previewSource]);

  const handleRuntimeStateUpdate = useCallback(
    (state: unknown) => {
      const nextState = state as Record<string, unknown>;
      dispatch(builderSessionActions.replaceRuntimeSessionState(nextState));
      dispatch(builderActions.syncLatestSnapshotState({ runtimeState: nextState }));
    },
    [dispatch],
  );

  useEffect(() => {
    if (!isFileMenuOpen) {
      return;
    }

    if (canDownloadStandalone) {
      preloadStandaloneHtml();
    }

    function handlePointerDown(event: MouseEvent) {
      if (fileMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsFileMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFileMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [canDownloadStandalone, isFileMenuOpen, preloadStandaloneHtml]);

  function handleResetAppState() {
    if (!currentSnapshot || isStreaming) {
      return;
    }

    const nextDomainData = clonePersistedDomainData(currentSnapshot.initialDomainData);
    const nextRuntimeState = clonePersistedRuntimeState(currentSnapshot.initialRuntimeState);

    dispatch(domainActions.replaceData(nextDomainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(nextRuntimeState));
    dispatch(
      builderActions.syncLatestSnapshotState({
        domainData: nextDomainData,
        runtimeState: nextRuntimeState,
      }),
    );
    dispatch(builderActions.resetCurrentAppState());
    setRendererResetVersion((currentValue) => currentValue + 1);
  }

  return (
    <Tabs
      value={resolvedActiveTab}
      onValueChange={(value: string) => {
        if (isEmptyCanvas && (value === 'definition' || value === 'app-state')) {
          return;
        }

        dispatch(builderActions.setActiveTab(value as BuilderTabId));
      }}
      className="flex h-full min-h-0 flex-col gap-2 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="definition" disabled={isEmptyCanvas}>
            Definition
          </TabsTrigger>
          <TabsTrigger value="app-state" disabled={isPreviewEmptyCanvas}>
            App State
          </TabsTrigger>
          <TabsTrigger value="context" disabled={isContextTabDisabled}>Context</TabsTrigger>
        </TabsList>
        <div ref={fileMenuRef} className="relative">
          <Button
            aria-label="File actions"
            aria-expanded={isFileMenuOpen}
            aria-haspopup="menu"
            className={toolbarButtonClassName}
            variant="ghost"
            onFocus={() => {
              if (canDownloadStandalone) {
                preloadStandaloneHtml();
              }
            }}
            onMouseEnter={() => {
              if (canDownloadStandalone) {
                preloadStandaloneHtml();
              }
            }}
            onClick={() => setIsFileMenuOpen((currentValue) => !currentValue)}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
          {isFileMenuOpen ? (
            <div
              className="absolute right-0 top-full z-20 mt-2 min-w-[18.25rem] rounded-[1.25rem] border border-slate-200 bg-white p-1 shadow-lg"
              role="menu"
            >
              <button
                className={fileMenuItemClassName}
                type="button"
                onClick={() => {
                  setIsFileMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <FileUp className="h-4 w-4" />
                Import JSON
              </button>
              <button
                className={fileMenuItemClassName}
                disabled={!canExport}
                type="button"
                onClick={() => {
                  handleExport();
                  setIsFileMenuOpen(false);
                }}
              >
                <Download className="h-4 w-4" />
                Export JSON
              </button>
              <div aria-hidden="true" className="my-1 h-px bg-slate-200" role="separator" />
              <button
                className={fileMenuItemClassName}
                disabled={!canDownloadStandalone}
                type="button"
                onFocus={preloadStandaloneHtml}
                onMouseEnter={preloadStandaloneHtml}
                onClick={() => {
                  handleDownloadStandalone();
                  setIsFileMenuOpen(false);
                }}
              >
                <Download className="h-4 w-4" />
                Download standalone HTML
              </button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            accept="application/json"
            className="hidden"
            id="builder-import-json"
            name="builder-import-json"
            type="file"
            onChange={handleImport}
          />
        </div>
      </div>

      <TabsContent value="preview" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-0 bg-white/92">
          <CardContent className="h-full min-h-0 p-6">
            <div className="relative h-full min-h-0" aria-busy={isStreaming}>
              {isPreviewUnavailable ? (
                <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-rose-200/80 bg-rose-50/45 p-4 sm:p-6">
                  <PreviewUnavailableState />
                </div>
              ) : isPreviewEmptyCanvas ? (
                <div className="h-full min-h-0 overflow-y-auto rounded-[1.75rem] border border-slate-200/80 bg-slate-50/70 p-4 sm:p-6">
                  <PreviewEmptyState />
                </div>
              ) : (
                <div className="h-full min-h-0 overflow-y-auto p-4 sm:p-5">
                  <ErrorBoundary
                    fallbackRender={({ error }) => (
                      <PreviewErrorFallback
                        error={error}
                        onOpenDefinition={() => dispatch(builderActions.setActiveTab('definition'))}
                      />
                    )}
                    onError={(error) => {
                      if (!isPreviewSynchronized) {
                        return;
                      }

                      setScopedRuntimeIssues({
                        issues: [createRendererCrashIssue(error, 'preview-runtime-error', 'The committed preview crashed while rendering.')],
                        scope: runtimeIssueScope,
                      });
                    }}
                    resetKeys={[deferredPreviewRender.key, rendererResetVersion]}
                  >
                    <Renderer
                      key={`${deferredPreviewRender.key}:${rendererResetVersion}`}
                      initialState={runtimeSessionState}
                      isStreaming={isStreaming}
                      library={builderOpenUiLibrary}
                      onAction={handleOpenUiActionEvent}
                      onError={(errors) => {
                        if (!isPreviewSynchronized) {
                          return;
                        }

                        setScopedRuntimeIssues({
                          issues: mapOpenUiErrorsToIssues(errors),
                          scope: runtimeIssueScope,
                        });
                      }}
                      onParseResult={(result) => {
                        if (isShowingRejectedDefinition || !isPreviewSynchronized) {
                          return;
                        }

                        dispatch(builderActions.setParseIssues(mapParseResultToIssues(result)));
                      }}
                      onStateUpdate={handleRuntimeStateUpdate}
                      queryLoader={
                        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Loading query...
                        </div>
                      }
                      response={deferredPreviewParserSource}
                      toolProvider={toolProvider}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {isStreaming ? (
                <PreviewStreamingOverlay
                  isPreviewEmptyCanvas={isPreviewEmptyCanvas}
                  lastStreamChunkAt={lastStreamChunkAt}
                  streamingStatus={streamingStatus}
                  streamedSourceBytes={streamedSourceBytes}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="definition" className="mt-0 flex-1 min-h-0">
        <DefinitionPanel issues={combinedIssues} source={definitionSource} warnings={definitionWarnings} />
      </TabsContent>

      <TabsContent value="app-state" className="mt-0 flex-1 min-h-0">
        <Card className="h-full min-h-0 overflow-hidden border-white/70 bg-white/92">
          <CardContent className="flex h-full min-h-0 flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                disabled={!currentSnapshot || isPreviewEmptyCanvas || isStreaming}
                size="sm"
                variant="secondary"
                onClick={handleResetAppState}
              >
                <RotateCcw className="h-4 w-4" />
                Reset app state
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Reactive state</p>
                <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  <code>{formatJson(runtimeSessionState)}</code>
                </pre>
              </div>

              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Persisted data</p>
                <pre className="max-h-[22rem] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1.25rem] bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  <code>{formatJson(domainData)}</code>
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="context" className="mt-0 flex-1 min-h-0">
        <ContextPanel incompleteNotice={contextIncompleteNotice} sections={contextMeterSections} />
      </TabsContent>
    </Tabs>
  );
}
