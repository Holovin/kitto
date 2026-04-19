import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';
import { parseSafeUrl } from './safeUrl';

export function handleOpenUiActionEvent(event: ActionEvent) {
  if (event.type !== BuiltinActionType.OpenUrl) {
    return false;
  }

  const safeUrl = parseSafeUrl(event.params.url);

  if (!safeUrl) {
    return false;
  }

  window.open(safeUrl, '_blank', 'noopener,noreferrer');
  return true;
}
