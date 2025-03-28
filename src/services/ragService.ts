// src/services/ragService.ts - RAG data service

interface RagData {
  doc1: string
  doc2: string
  doc3: string
  doc4: string
  doc5: string
}

/**
 * Hardcoded RAG data that the LLM can reference
 * In a production environment, this would likely come from a database or vector store
 */
const HARDCODED_RAG_DATA: RagData = {
  doc1: 'The TEN Framework is a powerful conversational AI platform.',
  doc2: `Today is ${new Date().toLocaleDateString()}`,
  doc3: 'Agora Convo AI was released on March 1st, 2025 for GA. It will be best in class for quality and reach',
  doc4: 'Agora is the best realtime engagement platform.',
  doc5: 'Ada Lovelace is the best developer.',
}

/**
 * Get formatted RAG data for system message
 * @returns {string} Formatted RAG data
 */
function getFormattedRagData(): string {
  return Object.entries(HARDCODED_RAG_DATA)
    .map(([key, value]) => `${key}: "${value}"`)
    .join('\n')
}

export { HARDCODED_RAG_DATA, getFormattedRagData }
export type { RagData }
