import type { MessageRecord } from '../types/records';

/** A persisted recovery response is the only authority for a model-context reset. */
export function isContentFilterOutcome(message: MessageRecord): boolean {
  return message.direction === 'outbound'
    && message.metadata?.['conversationOutcome'] === 'input_filtered'
    && typeof message.metadata?.['sourceInboundMessageId'] === 'string';
}

/** Preserve the recovery explanation while excluding the rejected turn and earlier context. */
export function modelMessagesAfterContentFilter(messages: MessageRecord[]): MessageRecord[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isContentFilterOutcome(messages[index]!)) return messages.slice(index);
  }
  return messages;
}

/** Project history through an inbound even if its earlier recovery was saved later. */
export function modelMessagesForInbound(
  messages: MessageRecord[],
  inboundIndex: number,
): { messages: MessageRecord[]; boundaryApplied: boolean } {
  let boundarySourceIndex = -1;
  let boundaryOutcome: MessageRecord | undefined;
  for (let outcomeIndex = 0; outcomeIndex < messages.length; outcomeIndex += 1) {
    const outcome = messages[outcomeIndex]!;
    if (!isContentFilterOutcome(outcome)) continue;
    const sourceIndex = messages.findIndex((message) =>
      message.id === outcome.metadata?.['sourceInboundMessageId'] && message.direction === 'inbound');
    const causalIndex = sourceIndex >= 0 ? sourceIndex : outcomeIndex;
    if (causalIndex < inboundIndex && causalIndex > boundarySourceIndex) {
      boundarySourceIndex = causalIndex;
      boundaryOutcome = outcome;
    }
  }
  if (!boundaryOutcome) {
    return { messages: messages.slice(0, inboundIndex + 1), boundaryApplied: false };
  }
  return {
    messages: [boundaryOutcome, ...messages.slice(boundarySourceIndex + 1, inboundIndex + 1)
      .filter((message) => message.id !== boundaryOutcome.id)],
    boundaryApplied: true,
  };
}

/** Explain only what the provider reported; its response does not identify a specific phrase. */
export function contentFilterExplanation(locale?: string): string {
  if (locale?.toLowerCase().startsWith('uk')) {
    return 'Я не зміг відповісти: сервіс моделі відхилив запит через фільтр вмісту. Він не вказав, який саме фрагмент став причиною, тому я не буду вгадувати. Можеш надіслати суть ще раз окремим повідомленням?';
  }
  if (locale?.toLowerCase().startsWith('ru')) {
    return 'Я не смог ответить: сервис модели отклонил запрос из-за фильтра содержимого. Он не указал, какой именно фрагмент стал причиной, поэтому я не буду гадать. Можешь отправить суть ещё раз отдельным сообщением?';
  }
  return 'I could not answer because the model service rejected the request with a content filter. It did not identify which part caused this, so I cannot give a more specific reason. Could you send the main point again as a separate message?';
}
