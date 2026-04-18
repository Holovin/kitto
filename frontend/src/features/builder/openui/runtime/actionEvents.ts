import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';

export function handleOpenUiActionEvent(event: ActionEvent) {
  if (event.type !== BuiltinActionType.OpenUrl) {
    return false;
  }

  const url = typeof event.params.url === 'string' ? event.params.url : '';

  if (!url.startsWith('https://')) {
    return false;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
