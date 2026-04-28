import { useCallback, useEffect } from 'react';
import { BUILDER_PERSISTENCE_QUOTA_WARNING } from '@store/persistence';
import { BuilderRequestControlsProvider } from '@pages/Chat/builder/context/BuilderRequestControlsProvider';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import type { BuilderChatNotice } from '@pages/Chat/builder/types';
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

  useEffect(() => {
    function handlePersistenceWarning(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const content =
        detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
          ? detail.message
          : BUILDER_PERSISTENCE_QUOTA_WARNING;

      handleSystemNotice({
        content,
        messageKey: 'builder-persistence-warning',
        tone: 'info',
      });
    }

    window.addEventListener('kitto:persistence-warning', handlePersistenceWarning);

    return () => {
      window.removeEventListener('kitto:persistence-warning', handlePersistenceWarning);
    };
  }, [handleSystemNotice]);

  return (
    <BuilderRequestControlsProvider>
      <section className="grid h-full min-h-0 w-full gap-6 xl:grid-cols-[minmax(22rem,0.78fr)_minmax(0,1.42fr)]">
        <ChatPanel onSystemNotice={handleSystemNotice} />
        <PreviewTabs onSystemNotice={handleSystemNotice} />
      </section>
    </BuilderRequestControlsProvider>
  );
}
