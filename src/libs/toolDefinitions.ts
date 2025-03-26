// src/services/toolDefinitions.ts - Function definitions for OpenAI

interface FunctionParameter {
  type: string
  properties: Record<
    string,
    {
      type: string
      description: string
    }
  >
  required: string[]
}

interface FunctionDefinition {
  name: string
  description: string
  parameters: FunctionParameter
}

/**
 * Function definitions for LLM function calling
 */
const functions: FunctionDefinition[] = [
  {
    name: 'order_sandwich',
    description: 'Place a sandwich order with a given filling. Logs the order to console.',
    parameters: {
      type: 'object',
      properties: {
        filling: {
          type: 'string',
          description: "Type of filling (e.g. 'Turkey', 'Ham', 'Veggie')",
        },
      },
      required: ['filling'],
    },
  },
  {
    name: 'send_photo',
    description: 'Request a photo to be sent. This allows you to send a photo to the user (No arguments needed.)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]

export { functions }
export type { FunctionDefinition, FunctionParameter }
