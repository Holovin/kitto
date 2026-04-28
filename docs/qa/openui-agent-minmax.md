# Code Review Findings

## Для другого агента / For another agent



1. **Дублирование компакции chat history на frontend и backend**
   - `frontend/src/pages/Chat/builder/config.ts:43-58` - `compactBuilderLlmRequestForTransport`
   - `backend/src/routes/llmOpenui/requestSchema.ts:128-154` - `compactLlmRequest`
   - Обе делают одно и то же. Backend компакция вызывается после frontend. Можно убрать frontend-компакцию и положиться на backend.

2. **Intent detection слишком агрессивно срабатывает**
   - `backend/src/prompts/openui/qualitySignals.ts:8-13` - THEME_REQUEST_PATTERN ловит любое упоминание "color", "dark", "light"
   - `backend/src/prompts/openui/qualitySignals.ts:15` - COMPUTE_REQUEST_PATTERN ловит "calculate" даже в безобидных контекстах
   - Это может приводить к нежелательным rule/exemplar включениям в промпт

3. **Repair request использует новый transportRequestId**
   - `frontend/src/pages/Chat/builder/hooks/useValidationRepair.ts:506` - `createRequestId()` создаёт новый ID для ремонтного запроса
   - По smoke test step 8, fallback должен использовать тот же `x-kitto-request-id`. Repair request - не fallback, но проверь что semantically это осознанное решение (выглядит правильно)

### Улучшения промпт-цепочки / Prompt chain improvements

4. **Упростить: убрать frontend compaction**
   - Оставить только backend compaction в `requestSchema.ts:compactLlmRequest`
   - Frontend `getBuilderSanitizedLlmRequestForTransport` дублирует логику
   - Это упростит код и уберёт двойной проход

5. **Добавить intent context в frontend для UI feedback**
   - `frontend/src/pages/Chat/builder/hooks/useBuilderSubmission.ts` не знает какой intent был детектирован
   - Можно добавить опциональный `detectedIntents` в ответ `/api/config` или отдельный эндпоинт
   - Это позволит показывать пользователю "Detected: todo, filtering" в UI

6. **Улучшить qualitySignals регулярки**
   ```typescript
   // CURRENT - слишком широко
   const VISUAL_STYLING_REQUEST_PATTERN = /\b(color|colors|palette)\b/i;

   // PROPOSED - более точный
   const VISUAL_STYLING_REQUEST_PATTERN = /\b(color\s*scheme|color\s*palette|paint\s*colors?)\b/i;
   ```

7. **Добавить кэширование intent detection результата**
   - `promptIntents.ts:60` - `detectPromptIntents` вызывается синхронно при каждом запросе
   - Можно добавить simple memoization для идентичных промптов

### Potential bugs

8. **Race condition в streaming**
   - `frontend/src/pages/Chat/builder/api/streamGenerate.ts:229` - reader.cancel() вызывается в finally после abort check
   - Если abort произошёл между read и cancel, может быть неопределённое состояние
   - Редкий edge case, но стоит добавить guard

9. **Missing null check в streamGenerate**
   - `streamGenerate.ts:107` - `decoder.decode(value ?? new Uint8Array(), { stream: !done })`
   - Если `value` undefined и `done` true, это нормально, но семантика "stream: !done" странная когда value undefined
   - Скорее всего не баг, но стоит проверить

10. **Repair chat history append может дублировать**
    - `useValidationRepair.ts:486` - `buildRepairChatHistoryWithRejectedDraftNotice` добавляет assistant message после каждого repair
    - Если repair fails и делается retry, notice уже добавлен в chatHistory
    - Проверь что `buildRepairChatHistoryWithRejectedDraftNotice` не добавляет дубликаты


### Что стоит улучшить в промптах / Prompt improvements

14. **System prompt может быть слишком длинным**
    - `systemPrompt.ts` генерирует ~400 строк включая component specs, tool signatures, rules, examples
    - Можно разбить на chunks и загружать progressive
    - Или дать модели ability to ask for clarification

15. **Exemplars могут конфликтовать с user request**
    - `exemplars.ts` выбирает exemplars на основе intent detection
    - Но если intent detection false positive - неправильный exemplar попадает в промпт
    - Рассмотри более conservative exemplar selection

16. **Repair prompt структура сложная**
    - Role-based repair (system/user/assistant/user messages) - правильно
    - Но budget allocation может truncation-ить критичную информацию
    - Проверь что rules секция не truncate-ится слишком агрессивно

