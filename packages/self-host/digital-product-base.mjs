/** Portable installation input. Each Host resolves its own file, order and Project identifiers. */
const digitalProductBaseSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'package', 'packageVersion', 'presentation', 'settings'],
  properties: {
    version: { const: 1 }, package: { const: 'member-resources' }, packageVersion: { const: 1 },
    presentation: {
      type: 'object', additionalProperties: false, required: ['heading', 'introduction', 'layout'],
      properties: {
        heading: { type: 'string', minLength: 1, maxLength: 100 },
        introduction: { type: 'string', minLength: 1, maxLength: 600 },
        layout: { const: 'standard' },
      },
    },
    settings: {
      type: 'object', additionalProperties: false, required: ['workflow', 'support'],
      properties: { workflow: { enum: ['flapbase:resource-distribution', 'flapbase:customer-support'] }, support: { const: 'buyer-order' } },
    },
  },
}

function validate(value, schema) {
  if ('const' in schema) return value === schema.const
  if ('enum' in schema) return schema.enum.includes(value)
  if (schema.type === 'string') {
    return typeof value === 'string' && value.trim().length >= schema.minLength && value.length <= schema.maxLength && !value.includes('\0')
  }
  return value != null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === schema.required.length &&
    schema.required.every(key => Object.hasOwn(value, key) && validate(value[key], schema.properties[key]))
}

export function parseDigitalProductBase(value) {
  if (!validate(value, digitalProductBaseSchema)) throw new Error('Invalid digital product base')
  return {
    version: 1, package: 'member-resources', packageVersion: 1,
    presentation: { heading: value.presentation.heading.trim(), introduction: value.presentation.introduction.trim(), layout: 'standard' },
    settings: { workflow: value.settings.workflow, support: 'buyer-order' },
  }
}
