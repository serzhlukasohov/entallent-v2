export const REPORTING_DISCLOSURE_VERSION = 'reporting-disclosure-v1';

const REPORTING_DISCLOSURE_TEXT = {
  en: 'If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.',
  ru: 'Если ты подтвердишь обезличенное резюме пульс-опроса, оно может использоваться только в агрегированных рекомендациях для команды. Ты можешь исправить его или попросить меня исключить его из отчётности.',
  uk: 'Якщо ти підтвердиш знеособлене резюме пульс-опитування, воно може використовуватися лише в агрегованих рекомендаціях для команди. Ти можеш виправити його або попросити мене виключити його зі звітності.',
} as const;

const REPORTING_ACCESS_EXPLANATION_TEXT = {
  en: 'Confirmation approves only the exact de-identified summary shown and does not change access permissions. It does not let managers or HR read your individual messages, answers, personal summary, tasks, goals, or identity through EnTalent reporting. Separate audited internal operational access is not granted by confirmation. Conversation data or temporary working state may still be retained under product retention rules, but storage alone never makes it reportable. Unconfirmed pulse answers and temporary summaries never contribute to team-report scoring, aggregation, themes, recommendations, intermediate reports, or final reports. Only the exact shown summary may contribute to team-level reporting after it is confirmed, de-identified, and non-withdrawn.',
  ru: 'Подтверждение одобряет только показанный точный текст обезличенного резюме и не меняет права доступа. Оно не позволяет менеджерам или HR читать через отчётность EnTalent твои личные сообщения, ответы, персональное резюме, задачи, цели или данные, раскрывающие личность. Отдельный аудируемый внутренний операционный доступ не предоставляется подтверждением. Данные разговора или временное рабочее состояние могут по-прежнему храниться согласно правилам хранения продукта, но само хранение никогда не делает их доступными для отчётности. Неподтверждённые ответы пульс-опроса и временные резюме никогда не участвуют в оценке, агрегации, темах, рекомендациях, промежуточных или итоговых отчётах. В командную отчётность может попасть только показанное точное резюме после подтверждения и обезличивания, если оно не отозвано.',
  uk: 'Підтвердження схвалює лише показаний точний текст знеособленого резюме й не змінює права доступу. Воно не дозволяє менеджерам або HR читати через звітність EnTalent твої особисті повідомлення, відповіді, персональне резюме, завдання, цілі чи дані, що розкривають особу. Окремий аудитований внутрішній операційний доступ не надається підтвердженням. Дані розмови або тимчасовий робочий стан можуть і далі зберігатися за правилами зберігання продукту, але саме зберігання ніколи не робить їх придатними для звітності. Непідтверджені відповіді пульс-опитування й тимчасові резюме ніколи не беруть участі в оцінюванні, агрегації, темах, рекомендаціях, проміжних або підсумкових звітах. До командної звітності може потрапити лише показане точне резюме після підтвердження й знеособлення, якщо його не відкликано.',
} as const;

export function getReportingDisclosureText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_DISCLOSURE_TEXT;
  return REPORTING_DISCLOSURE_TEXT[baseLanguage] ?? REPORTING_DISCLOSURE_TEXT.en;
}

export function getReportingExplanationText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_ACCESS_EXPLANATION_TEXT;
  const explanation = REPORTING_ACCESS_EXPLANATION_TEXT[baseLanguage]
    ?? REPORTING_ACCESS_EXPLANATION_TEXT.en;
  return `${explanation}\n\n${getReportingDisclosureText(language)}`;
}

export function appendReportingDisclosure(responseText: string, language?: string): string {
  const disclosure = getReportingDisclosureText(language);
  if (responseText.includes(disclosure)) return responseText;
  return responseText ? `${responseText}\n\n${disclosure}` : disclosure;
}
