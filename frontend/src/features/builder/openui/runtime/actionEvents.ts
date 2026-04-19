import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';
import { openSafeUrl, type SafeUrlOpener } from './safeUrl';

export function createOpenUiActionEventHandler(openUrl?: SafeUrlOpener) {
  return function handleOpenUiActionEvent(event: ActionEvent) {
    if (event.type !== BuiltinActionType.OpenUrl) {
      return false;
    }

    return openSafeUrl(event.params.url, openUrl);
  };
}

export const handleOpenUiActionEvent = createOpenUiActionEventHandler();
