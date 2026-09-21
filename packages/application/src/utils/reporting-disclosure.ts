import type { PulseCaptureRecord } from '../types/records';

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

const CONCISE_REPORTING_ACCESS_EXPLANATION_TEXT = {
  en: 'Confirmation approves exact shown de-identified summary; grants no access. Managers/HR can’t read messages/answers/summary/tasks/goals/identity or gain audited internal access. Conversation/temp isn’t reportable. Unconfirmed pulse data never enters scores/aggregation/themes/recommendations/reports. Only confirmed, non-withdrawn summary may enter team report.',
  ru: 'Подтверждается показанное точное обезличенное резюме; доступа не даёт. Менеджерам/HR закрыты сообщения/ответы/резюме/задачи/цели/личность и аудируемый внутренний доступ. Разговор/временные данные не отчётны. Неподтверждённый пульс не входит в оценки/агрегацию/темы/рекомендации/отчёты. Лишь подтверждённое, неотозванное резюме может войти в командный отчёт.',
  uk: 'Підтверджується показане точне знеособлене резюме; доступу це не надає. Менеджерам/HR закриті повідомлення/відповіді/резюме/завдання/цілі/особа й аудитований внутрішній доступ. Розмова/тимчасові дані не звітні. Непідтверджений пульс не входить в оцінки/агрегацію/теми/рекомендації/звіти. Лише підтверджене, невідкликане резюме може ввійти в командний звіт.',
} as const;

const DATA_USE_EXPLANATION_TEXT = {
  en: 'I am an AI assistant, not a human. I use your messages to respond in this conversation. They may also support optional private memory and relevant goals, tasks, or reminders; pulse measurement; and safety checks. Private memory and unconfirmed material are not reportable. Only the exact shown summary may contribute to team-level reporting after it is confirmed, de-identified, and non-withdrawn. Messages and derived product data are kept under product retention rules. Audited internal admin and debugging access is limited to authorized staff.',
  ru: 'Я — ИИ-помощник, а не человек. Я использую твои сообщения, чтобы отвечать в этом разговоре. Они также могут использоваться для необязательной личной памяти и релевантных целей, задач или напоминаний, измерения пульса команды и проверок безопасности. Личная память и неподтверждённые материалы не подлежат отчётности. В командную отчётность может попасть только показанное точное резюме после подтверждения и обезличивания, если оно не отозвано. Сообщения и производные данные продукта хранятся согласно правилам хранения продукта. Внутренний административный доступ и доступ для отладки разрешён только уполномоченным сотрудникам и аудируется.',
  uk: 'Я — ШІ-помічник, а не людина. Я використовую твої повідомлення, щоб відповідати в цій розмові. Вони також можуть використовуватися для необов’язкової приватної пам’яті та релевантних цілей, завдань або нагадувань, вимірювання пульсу команди й перевірок безпеки. Приватна пам’ять і непідтверджені матеріали не підлягають звітності. До командної звітності може потрапити лише показане точне резюме після підтвердження й знеособлення, якщо його не відкликано. Повідомлення та похідні дані продукту зберігаються за правилами зберігання продукту. Внутрішній адміністративний доступ і доступ для налагодження дозволений лише уповноваженим працівникам та аудитується.',
} as const;

const CONCISE_DATA_USE_EXPLANATION_TEXT = {
  en: 'I am an AI, not human. Messages support replies, private memory, goals/tasks/reminders, pulse measurement, and safety checks. Private memory/unconfirmed data are not reportable; only shown confirmed, de-identified, non-withdrawn summary may enter team reports. Messages/derived data follow retention rules; audited admin/debug access: authorized staff only.',
  ru: 'Я — ИИ, не человек. Сообщения: ответы, приватная память, цели/задачи/напоминания, пульс, проверки безопасности. Память/неподтверждённое не отчётны; лишь показанное подтверждённое, обезличенное, неотозванное резюме может войти в командный отчёт. Сообщения/производные данные имеют сроки хранения; аудируемый админ/отладочный доступ — только уполномоченным.',
  uk: 'Я — ШІ, не людина. Повідомлення: відповіді, приватна пам’ять, цілі/завдання/нагадування, пульс, перевірки безпеки. Пам’ять/непідтверджене не звітні; лише показане підтверджене, знеособлене, невідкликане резюме може ввійти в командний звіт. Повідомлення/похідні дані мають строки зберігання; аудитований адмін/налагоджувальний доступ — лише уповноваженим.',
} as const;

const PULSE_CAPTURE_TEXT = {
  en: {
    absent: 'There is no current persisted pulse evidence linked to your earlier messages in this conversation. Pulse extraction can finish after a reply, so your most recent messages may not have been evaluated yet.',
    exactAbsent: 'There is no current persisted pulse evidence linked to this exact message. Pulse extraction can finish after a reply, so this message may not have been evaluated yet.',
    unresolved: 'I could not identify one exact earlier message. Please identify or quote the message you mean, and I will check only that message.',
    intro: 'Here is the current persisted pulse information linked to your earlier messages in this conversation:',
    exactIntro: 'Here is the current persisted pulse information linked to this exact message:',
    temporary: 'temporary working interpretation; not reportable',
    confirmed: 'confirmed; this exact de-identified summary is eligible for aggregated team reporting, but that does not mean it was included in a report',
    withdrawn: 'withdrawn from future reporting; this does not mean the underlying message was deleted or a previously delivered report was changed',
  },
  ru: {
    absent: 'Я не вижу сохранённых данных пульс-опроса, связанных с твоими предыдущими сообщениями в этом разговоре. Извлечение может завершиться уже после ответа, поэтому последние сообщения могли быть ещё не обработаны.',
    exactAbsent: 'Я не вижу сохранённых данных пульс-опроса для этого конкретного сообщения. Извлечение может завершиться уже после ответа, поэтому это сообщение могло быть ещё не обработано.',
    unresolved: 'Я не смог однозначно определить одно предыдущее сообщение. Уточни или процитируй нужное сообщение, и я проверю только его.',
    intro: 'Вот сохранённая информация пульс-опроса, связанная с твоими предыдущими сообщениями в этом разговоре:',
    exactIntro: 'Вот сохранённая информация пульс-опроса, связанная с этим конкретным сообщением:',
    temporary: 'временная рабочая интерпретация; не подлежит отчётности',
    confirmed: 'подтверждено; только это точное обезличенное резюме может участвовать в агрегированной командной отчётности, но это не означает, что оно уже вошло в отчёт',
    withdrawn: 'отозвано из будущей отчётности; это не означает удаление исходного сообщения или изменение уже доставленного отчёта',
  },
  uk: {
    absent: 'Я не бачу збережених даних пульс-опитування, пов’язаних із твоїми попередніми повідомленнями в цій розмові. Вилучення може завершитися вже після відповіді, тому останні повідомлення могли бути ще не опрацьовані.',
    exactAbsent: 'Я не бачу збережених даних пульс-опитування для цього конкретного повідомлення. Вилучення може завершитися вже після відповіді, тому це повідомлення могло бути ще не опрацьоване.',
    unresolved: 'Я не зміг однозначно визначити одне попереднє повідомлення. Уточни або процитуй потрібне повідомлення, і я перевірю лише його.',
    intro: 'Ось збережена інформація пульс-опитування, пов’язана з твоїми попередніми повідомленнями в цій розмові:',
    exactIntro: 'Ось збережена інформація пульс-опитування, пов’язана з цим конкретним повідомленням:',
    temporary: 'тимчасова робоча інтерпретація; не підлягає звітності',
    confirmed: 'підтверджено; лише це точне знеособлене резюме може брати участь в агрегованій командній звітності, але це не означає, що воно вже ввійшло до звіту',
    withdrawn: 'відкликано з майбутньої звітності; це не означає видалення початкового повідомлення або зміну вже доставленого звіту',
  },
} as const;

const CONCISE_PULSE_CAPTURE_TEXT = {
  en: {
    absent: 'No persisted pulse evidence is linked to earlier messages here. Extraction may finish after a reply, so recent messages may not be evaluated yet.',
    exactAbsent: 'No persisted pulse evidence is linked to this exact message. Extraction may still be pending.',
    unresolved: 'I could not identify one exact earlier message. Please identify or quote it.',
    intro: 'Persisted pulse information linked to earlier messages:',
    exactIntro: 'Persisted pulse information linked to this exact message:',
    temporary: 'temporary; not reportable',
    confirmed: 'confirmed; exact de-identified summary eligible for team reporting, not proof of inclusion',
    withdrawn: 'withdrawn from future reporting; source message not deleted and past reports unchanged',
  },
  ru: {
    absent: 'Нет сохранённых пульс-данных для предыдущих сообщений. Извлечение может завершиться после ответа, поэтому последние сообщения могли ещё не быть обработаны.',
    exactAbsent: 'Нет сохранённых пульс-данных для этого конкретного сообщения. Обработка могла ещё не завершиться.',
    unresolved: 'Я не смог определить одно предыдущее сообщение. Уточни или процитируй его.',
    intro: 'Сохранённые пульс-данные для предыдущих сообщений:',
    exactIntro: 'Сохранённые пульс-данные для этого конкретного сообщения:',
    temporary: 'временно; не подлежит отчётности',
    confirmed: 'подтверждено; обезличенное резюме допустимо для командной отчётности, но не доказывает включение',
    withdrawn: 'отозвано; исходное сообщение не удалено, прошлые отчёты не меняются',
  },
  uk: {
    absent: 'Немає збережених пульс-даних для попередніх повідомлень. Вилучення може завершитися після відповіді, тому останні повідомлення могли ще не бути оброблені.',
    exactAbsent: 'Немає збережених пульс-даних для цього конкретного повідомлення. Обробка могла ще не завершитися.',
    unresolved: 'Я не зміг визначити одне попереднє повідомлення. Уточни або процитуй його.',
    intro: 'Збережені пульс-дані для попередніх повідомлень:',
    exactIntro: 'Збережені пульс-дані для цього конкретного повідомлення:',
    temporary: 'тимчасово; не придатне для звітності',
    confirmed: 'підтверджено; знеособлене резюме допустиме для командної звітності, але не доводить включення',
    withdrawn: 'відкликано; вихідне повідомлення не видалено, минулі звіти не змінюються',
  },
} as const;

const EXPLICIT_PULSE_CAPTURE_REQUEST =
  /^(?:(?:(?:can|could)\s+you\s+)?help\s+me\s+understand\s+|(?:(?:but\s+)?i\s+(?:don['’]?t|do not)\s+understand\s+)?)what\s+exact\s+(?:pulse\s+)?information\s+(?:did\s+you|you\s+(?:already\s+)?)\s*(?:pick(?:ed)?(?:\s+up)?|captur(?:e|ed)|record(?:ed)?|sav(?:e|ed))\s+from\s+(?:our|this)\s+(?:discussion|conversation|chat)\s*\?$|^(?:what|which)\s+(?:exact\s+)?(?:pulse\s+)?(?:information|data|details?)\s+(?:did|have)\s+you\s+(?:already\s+)?(?:pick(?:ed)?(?:\s+up)?|captur(?:e|ed)|record(?:ed)?|sav(?:e|ed))\s+from\s+(?:our|this)\s+(?:discussion|conversation|chat)\s*\?$|^(?:какую|что)\s+именно.{0,40}(?:пульс|информац|данн).{0,50}(?:сохранил|зафиксировал|извл[её]к).{0,50}(?:разговор|обсужден)\s*\??\s*$|^(?:яку|що)\s+саме.{0,40}(?:пульс|інформац|дан).{0,50}(?:зберіг|зафіксував|витяг).{0,50}(?:розмов|обговорен)\s*\??\s*$/iu;

export function getReportingDisclosureText(language?: string): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_DISCLOSURE_TEXT;
  return REPORTING_DISCLOSURE_TEXT[baseLanguage] ?? REPORTING_DISCLOSURE_TEXT.en;
}

export function getReportingExplanationText(language?: string, concise = false): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof REPORTING_ACCESS_EXPLANATION_TEXT;
  if (concise) {
    return CONCISE_REPORTING_ACCESS_EXPLANATION_TEXT[baseLanguage]
      ?? CONCISE_REPORTING_ACCESS_EXPLANATION_TEXT.en;
  }
  const explanation = REPORTING_ACCESS_EXPLANATION_TEXT[baseLanguage]
    ?? REPORTING_ACCESS_EXPLANATION_TEXT.en;
  return `${explanation}\n\n${getReportingDisclosureText(language)}`;
}

export function getDataUseExplanationText(language?: string, concise = false): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof DATA_USE_EXPLANATION_TEXT;
  if (concise) {
    return CONCISE_DATA_USE_EXPLANATION_TEXT[baseLanguage]
      ?? CONCISE_DATA_USE_EXPLANATION_TEXT.en;
  }
  return DATA_USE_EXPLANATION_TEXT[baseLanguage] ?? DATA_USE_EXPLANATION_TEXT.en;
}

export function getPulseCaptureExplanationText(
  captures: PulseCaptureRecord[],
  language?: string,
  concise = false,
  scope: 'conversation' | 'exact' | 'unresolved' = 'conversation',
): string {
  const baseLanguage = language?.toLowerCase().split('-')[0] as keyof typeof PULSE_CAPTURE_TEXT;
  const localized = concise ? CONCISE_PULSE_CAPTURE_TEXT : PULSE_CAPTURE_TEXT;
  const copy = localized[baseLanguage] ?? localized.en;
  if (captures.length === 0) {
    if (scope === 'exact') return copy.exactAbsent;
    if (scope === 'unresolved') return copy.unresolved;
    return copy.absent;
  }
  const intro = scope === 'exact' ? copy.exactIntro : copy.intro;
  return `${intro}\n${captures.map((capture) => `- ${capture.evidenceSummary} — ${copy[capture.status]}.`).join('\n')}`;
}

export function isExplicitPulseCaptureRequest(text: string): boolean {
  const normalizedText = text.trim().replace(/\s+\*Sent using\*\s+<@[A-Z0-9]+>\s*$/iu, '').trim();
  return EXPLICIT_PULSE_CAPTURE_REQUEST.test(normalizedText);
}

export function appendReportingDisclosure(responseText: string, language?: string): string {
  const disclosure = getReportingDisclosureText(language);
  if (responseText.includes(disclosure)) return responseText;
  return responseText ? `${responseText}\n\n${disclosure}` : disclosure;
}
