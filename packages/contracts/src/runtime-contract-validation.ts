import schemaDocument from '../runtime/openapi.json';

export const RUNTIME_OPENAPI_SCHEMA = schemaDocument as unknown;

export type RuntimeContractValidationResult =
  | { ok: true }
  | {
      ok: false;
      errorCategory: string;
      message: string;
      path: string;
    };

export type ValidateRuntimeContractInput = {
  schemaDocument: unknown;
  schemaName: string;
  value: unknown;
};

export type ValidateNamedRuntimeContractInput = Omit<
  ValidateRuntimeContractInput,
  'schemaName'
>;

type JsonObject = Record<string, unknown>;

const DEFAULT_ERROR_CATEGORY = 'CONTRACT_SCHEMA_INVALID';
const MAX_SCHEMA_DEPTH = 64;

export function validateRuntimeContract({
  schemaDocument,
  schemaName,
  value,
}: ValidateRuntimeContractInput): RuntimeContractValidationResult {
  const schemas = getComponentSchemas(schemaDocument);
  const schema = schemas[schemaName];

  if (!isRecord(schema)) {
    return fail(
      '$schema',
      DEFAULT_ERROR_CATEGORY,
      `Missing OpenAPI component schema: ${schemaName}`,
    );
  }

  const result = validateSchema(schema, value, '$', schemas, 0);
  if (!result.ok) {
    return result;
  }

  if (schemaName === 'RuntimeResult') {
    return validateRuntimeResultSemantics(value);
  }

  return result;
}

export function validateRuntimeProcessMessageRequest(
  input: ValidateNamedRuntimeContractInput,
): RuntimeContractValidationResult {
  return validateRuntimeContract({
    ...input,
    schemaName: 'RuntimeProcessMessageRequest',
  });
}

export function validateRuntimeResult(
  input: ValidateNamedRuntimeContractInput,
): RuntimeContractValidationResult {
  return validateRuntimeContract({
    ...input,
    schemaName: 'RuntimeResult',
  });
}

export function validateRuntimeErrorResponse(
  input: ValidateNamedRuntimeContractInput,
): RuntimeContractValidationResult {
  return validateRuntimeContract({
    ...input,
    schemaName: 'RuntimeErrorResponse',
  });
}

function validateSchema(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
  depth: number,
): RuntimeContractValidationResult {
  if (depth > MAX_SCHEMA_DEPTH) {
    return fail(path, errorCategory(schema), 'Maximum schema depth exceeded');
  }

  if (Array.isArray(schema.oneOf)) {
    return validateOneOf(schema, value, path, schemas, depth + 1);
  }

  const ref = typeof schema.$ref === 'string' ? schema.$ref : null;
  if (ref) {
    const resolved = resolveRef(ref, schemas);
    if (!resolved) {
      return fail(path, errorCategory(schema), `Unresolvable schema ref: ${ref}`);
    }
    return validateSchema(resolved, value, path, schemas, depth + 1);
  }

  if (allowsNull(schema) && value === null) {
    return { ok: true };
  }

  const schemaType = firstNonNullType(schema);
  if (schemaType && !matchesType(schemaType, value)) {
    return fail(path, errorCategory(schema), `Expected ${schemaType}`);
  }

  if (schemaType === 'object') {
    return validateObject(schema, value, path, schemas, depth + 1);
  }

  if (schemaType === 'array') {
    return validateArray(schema, value, path, schemas, depth + 1);
  }

  if (schemaType === 'string') {
    return validateString(schema, value, path);
  }

  if (schemaType === 'integer') {
    return validateInteger(schema, value, path);
  }

  if (schemaType === 'number') {
    return validateNumber(schema, value, path);
  }

  return { ok: true };
}

function validateOneOf(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
  depth: number,
): RuntimeContractValidationResult {
  const candidates = schema.oneOf;
  if (!Array.isArray(candidates)) {
    return { ok: true };
  }

  let matchCount = 0;
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const result = validateSchema(candidate, value, path, schemas, depth + 1);
    if (result.ok) {
      matchCount += 1;
    }
  }

  if (matchCount === 1) {
    return { ok: true };
  }

  return fail(path, errorCategory(schema), 'Expected exactly one matching oneOf schema');
}

function validateObject(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
  depth: number,
): RuntimeContractValidationResult {
  if (!isRecord(value)) {
    return fail(path, errorCategory(schema), 'Expected object');
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const property of required) {
    if (typeof property !== 'string') {
      continue;
    }

    if (!(property in value)) {
      return fail(
        `${path}.${property}`,
        errorCategory(propertySchema(properties, property)),
        `Missing required property: ${property}`,
      );
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const childSchema = propertySchema(properties, key);

    if (!childSchema) {
      if (schema.additionalProperties === false) {
        return fail(
          `${path}.${key}`,
          errorCategory(schema),
          `Unexpected property: ${key}`,
        );
      }
      if (isRecord(schema.additionalProperties)) {
        const result = validateSchema(
          schema.additionalProperties,
          propertyValue,
          `${path}.${key}`,
          schemas,
          depth + 1,
        );
        if (!result.ok) {
          return result;
        }
      }
      continue;
    }

    const result = validateSchema(
      childSchema,
      propertyValue,
      `${path}.${key}`,
      schemas,
      depth + 1,
    );

    if (!result.ok) {
      return result;
    }
  }

  if (schema['x-action-lifecycle'] === true) {
    const result = validateActionLifecycle(schema, value, path);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

function validateRuntimeResultSemantics(value: unknown): RuntimeContractValidationResult {
  if (!isRecord(value) || !isRecord(value.diagnostics)) {
    return { ok: true };
  }

  const diagnostics = value.diagnostics;
  const retryCount = diagnostics.retryCount;
  const modelRetryCount = diagnostics.modelRetryCount;
  const toolRetryCount = diagnostics.toolRetryCount;
  const httpRetryCount = diagnostics.httpRetryCount;

  if (
    typeof retryCount === 'number' &&
    typeof modelRetryCount === 'number' &&
    typeof toolRetryCount === 'number' &&
    typeof httpRetryCount === 'number' &&
    retryCount !== modelRetryCount + toolRetryCount + httpRetryCount
  ) {
    return fail(
      '$.diagnostics.retryCount',
      DEFAULT_ERROR_CATEGORY,
      'retryCount must equal modelRetryCount + toolRetryCount + httpRetryCount',
    );
  }

  return { ok: true };
}

function validateActionLifecycle(
  schema: JsonObject,
  value: JsonObject,
  path: string,
): RuntimeContractValidationResult {
  const validationResult = value.validationResult;
  const validationStatus = isRecord(validationResult)
    ? validationResult.status
    : null;
  const executionStatus = value.executionStatus;
  const commitMarker = value.commitMarker;
  const category = errorCategory(schema);

  if (executionStatus === 'committed') {
    if (validationStatus !== 'valid') {
      return fail(
        `${path}.validationResult.status`,
        category,
        'Committed action must have a valid validation result',
      );
    }

    if (!isRecord(commitMarker)) {
      return fail(
        `${path}.commitMarker`,
        category,
        'Committed action must include a commit marker',
      );
    }

    return { ok: true };
  }

  if (commitMarker !== null) {
    return fail(
      `${path}.commitMarker`,
      category,
      'Uncommitted action must not include a commit marker',
    );
  }

  return { ok: true };
}

function validateArray(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
  depth: number,
): RuntimeContractValidationResult {
  if (!Array.isArray(value)) {
    return fail(path, errorCategory(schema), 'Expected array');
  }

  if (!isRecord(schema.items)) {
    return { ok: true };
  }

  for (const [index, item] of value.entries()) {
    const result = validateSchema(
      schema.items,
      item,
      `${path}[${index}]`,
      schemas,
      depth + 1,
    );
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

function validateString(
  schema: JsonObject,
  value: unknown,
  path: string,
): RuntimeContractValidationResult {
  if (typeof value !== 'string') {
    return fail(path, errorCategory(schema), 'Expected string');
  }

  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    return fail(path, errorCategory(schema), 'String is shorter than minLength');
  }

  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
    return fail(path, errorCategory(schema), 'String does not match pattern');
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return fail(path, errorCategory(schema), 'String is not in enum');
  }

  if (schema.format === 'uuid' && !isUuid(value)) {
    return fail(path, errorCategory(schema), 'String is not a UUID');
  }

  if (schema.format === 'date-time' && !isDateTime(value)) {
    return fail(path, errorCategory(schema), 'String is not a date-time');
  }

  return { ok: true };
}

function validateInteger(
  schema: JsonObject,
  value: unknown,
  path: string,
): RuntimeContractValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(path, errorCategory(schema), 'Expected integer');
  }

  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    return fail(path, errorCategory(schema), 'Integer is below minimum');
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    return fail(path, errorCategory(schema), 'Integer is above maximum');
  }

  return { ok: true };
}

function validateNumber(
  schema: JsonObject,
  value: unknown,
  path: string,
): RuntimeContractValidationResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(path, errorCategory(schema), 'Expected number');
  }

  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    return fail(path, errorCategory(schema), 'Number is below minimum');
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    return fail(path, errorCategory(schema), 'Number is above maximum');
  }

  return { ok: true };
}

function getComponentSchemas(schemaDocument: unknown): Record<string, unknown> {
  if (!isRecord(schemaDocument) || !isRecord(schemaDocument.components)) {
    return {};
  }

  const schemas = schemaDocument.components.schemas;
  return isRecord(schemas) ? schemas : {};
}

function resolveRef(
  ref: string,
  schemas: Record<string, unknown>,
): JsonObject | null {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) {
    return null;
  }

  const resolved = schemas[ref.slice(prefix.length)];
  return isRecord(resolved) ? resolved : null;
}

function propertySchema(
  properties: Record<string, unknown>,
  property: string,
): JsonObject | null {
  const schema = properties[property];
  return isRecord(schema) ? schema : null;
}

function allowsNull(schema: JsonObject): boolean {
  return (
    schema.type === 'null' ||
    (Array.isArray(schema.type) && schema.type.includes('null'))
  );
}

function firstNonNullType(schema: JsonObject): string | null {
  if (typeof schema.type === 'string') {
    return schema.type;
  }

  if (Array.isArray(schema.type)) {
    const type = schema.type.find((candidate) => candidate !== 'null');
    return typeof type === 'string' ? type : null;
  }

  return null;
}

function matchesType(schemaType: string, value: unknown): boolean {
  if (schemaType === 'null') {
    return value === null;
  }

  if (schemaType === 'integer') {
    return Number.isInteger(value);
  }

  if (schemaType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (schemaType === 'array') {
    return Array.isArray(value);
  }

  if (schemaType === 'object') {
    return isRecord(value);
  }

  return typeof value === schemaType;
}

function errorCategory(schema: JsonObject | null): string {
  if (!schema) {
    return DEFAULT_ERROR_CATEGORY;
  }

  return typeof schema['x-error-category'] === 'string'
    ? schema['x-error-category']
    : DEFAULT_ERROR_CATEGORY;
}

function fail(
  path: string,
  errorCategoryValue: string,
  message: string,
): RuntimeContractValidationResult {
  return {
    ok: false,
    errorCategory: errorCategoryValue,
    message,
    path,
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );

  if (!match) {
    return false;
  }

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const offsetHour = match[9] ? Number(match[9]) : 0;
  const offsetMinute = match[10] ? Number(match[10]) : 0;

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
