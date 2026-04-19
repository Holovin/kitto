import { useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { PreviewTabs } from './PreviewTabs';

export function BuilderPage() {
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <section className="grid h-full min-h-0 w-full gap-6 xl:grid-cols-[minmax(22rem,0.78fr)_minmax(0,1.42fr)]">
      <ChatPanel feedback={feedback} onFeedbackChange={setFeedback} />
      <PreviewTabs onFeedbackChange={setFeedback} />
    </section>
  );
}
