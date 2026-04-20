import { useCallback } from 'react';
import { builderActions } from '@features/builder/store/builderSlice';
import type { BuilderChatNotice } from '@features/builder/types';
import { useAppDispatch } from '@store/hooks';
import { ChatPanel } from './ChatPanel';
import { PreviewTabs } from './PreviewTabs';

export function BuilderPage() {
  const dispatch = useAppDispatch();
  const handleSystemNotice = useCallback(
    (notice: BuilderChatNotice | null) => {
      if (!notice) {
        return;
      }

      dispatch(
        builderActions.appendChatMessage({
          content: notice.content,
          messageKey: notice.messageKey,
          role: 'system',
          tone: notice.tone ?? 'info',
        }),
      );
    },
    [dispatch],
  );

  return (
    <section className="grid h-full min-h-0 w-full gap-6 xl:grid-cols-[minmax(22rem,0.78fr)_minmax(0,1.42fr)]">
      <ChatPanel onSystemNotice={handleSystemNotice} />
      <PreviewTabs onSystemNotice={handleSystemNotice} />
    </section>
  );
}
