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

type JsonObject = Record<string, unknown>;

const DEFAULT_ERROR_CATEGORY = 'CONTRACT_SCHEMA_INVALID';

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

  return validateSchema(schema, value, '$', schemas);
}

function validateSchema(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
): RuntimeContractValidationResult {
  if (Array.isArray(schema.oneOf)) {
    return validateOneOf(schema, value, path, schemas);
  }

  const ref = typeof schema.$ref === 'string' ? schema.$ref : null;
  if (ref) {
    const resolved = resolveRef(ref, schemas);
    if (!resolved) {
      return fail(path, errorCategory(schema), `Unresolvable schema ref: ${ref}`);
    }
    return validateSchema(resolved, value, path, schemas);
  }

  if (allowsNull(schema) && value === null) {
    return { ok: true };
  }

  const schemaType = firstNonNullType(schema);
  if (schemaType && !matchesType(schemaType, value)) {
    return fail(path, errorCategory(schema), `Expected ${schemaType}`);
  }

  if (schemaType === 'object') {
    return validateObject(schema, value, path, schemas);
  }

  if (schemaType === 'array') {
    return validateArray(schema, value, path, schemas);
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

    const result = validateSchema(candidate, value, path, schemas);
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
    );

    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

function validateArray(
  schema: JsonObject,
  value: unknown,
  path: string,
  schemas: Record<string, unknown>,
): RuntimeContractValidationResult {
  if (!Array.isArray(value)) {
    return fail(path, errorCategory(schema), 'Expected array');
  }

  if (!isRecord(schema.items)) {
    return { ok: true };
  }

  for (const [index, item] of value.entries()) {
    const result = validateSchema(schema.items, item, `${path}[${index}]`, schemas);
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
  return Array.isArray(schema.type) && schema.type.includes('null');
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
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}
