export type PreviewCanvasState = 'empty' | 'preview' | 'unavailable';

interface ResolvePreviewCanvasStateOptions {
  isShowingRejectedDefinition: boolean;
  previewSource: string;
}

export function resolvePreviewCanvasState({
  isShowingRejectedDefinition,
  previewSource,
}: ResolvePreviewCanvasStateOptions): PreviewCanvasState {
  if (!previewSource.trim()) {
    return isShowingRejectedDefinition ? 'unavailable' : 'empty';
  }

  return 'preview';
}
