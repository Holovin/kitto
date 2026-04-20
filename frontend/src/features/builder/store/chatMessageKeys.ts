export const SYSTEM_CHAT_MESSAGE_KEYS = {
  appStateReset: 'app-state-reset',
  definitionExportSuccess: 'definition-export-success',
  definitionImportStatus: 'definition-import-status',
  demoLoadSuccess: 'demo-load-success',
  historyNavigation: 'history-navigation',
  standaloneHtmlDownloadSuccess: 'standalone-html-download-success',
} as const;

export type SystemChatMessageKey = (typeof SYSTEM_CHAT_MESSAGE_KEYS)[keyof typeof SYSTEM_CHAT_MESSAGE_KEYS];
