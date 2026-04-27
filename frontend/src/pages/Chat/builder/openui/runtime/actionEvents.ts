import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';
import { openSafeUrl } from './safeUrl';

export function handleOpenUiActionEvent(event: ActionEvent) {
  if (event.type !== BuiltinActionType.OpenUrl) {
    return false;
  }

  return openSafeUrl(event.params.url);
}
