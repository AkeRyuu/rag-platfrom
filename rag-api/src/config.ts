/**
 * Shared RAG API Configuration
 */

import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  // Server
  API_PORT: number;
  API_HOST: string;

  // Qdrant
  QDRANT_URL: string;
  QDRANT_API_KEY?: string;

  // Embedding
  EMBEDDING_PROVIDER: 'bge-m3-server' | 'ollama' | 'openai';
  BGE_M3_URL: string;
  OLLAMA_URL: string;
  OLLAMA_EMBEDDING_MODEL: string;
  OPENAI_API_KEY?: string;

  // LLM
  LLM_PROVIDER: 'ollama' | 'openai' | 'anthropic';
  OLLAMA_MODEL: string;
  OPENAI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;

  // Vector
  VECTOR_SIZE: number;

  // Redis (caching)
  REDIS_URL?: string;

  // Agent Runtime
  AGENT_OLLAMA_MODEL: string;
  AGENT_MAX_ITERATIONS: number;
  AGENT_TIMEOUT: number;

  // Ingestion Pipeline
  SEPARATE_COLLECTIONS: boolean;
  LEGACY_CODEBASE_COLLECTION: boolean;

  // Logging
  LOG_LEVEL: string;
}

const config: Config = {
  // Server
  API_PORT: parseInt(process.env.API_PORT || '3100', 10),
  API_HOST: process.env.API_HOST || '0.0.0.0',

  // Qdrant
  QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
  QDRANT_API_KEY: process.env.QDRANT_API_KEY,

  // Embedding
  EMBEDDING_PROVIDER: (process.env.EMBEDDING_PROVIDER || 'bge-m3-server') as Config['EMBEDDING_PROVIDER'],
  BGE_M3_URL: process.env.BGE_M3_URL || 'http://localhost:8080',
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // LLM
  LLM_PROVIDER: (process.env.LLM_PROVIDER || 'ollama') as Config['LLM_PROVIDER'],
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:32b',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229',

  // Vector size based on embedding provider
  VECTOR_SIZE: parseInt(process.env.VECTOR_SIZE || '1024', 10),

  // Agent Runtime
  AGENT_OLLAMA_MODEL: process.env.AGENT_OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:32b',
  AGENT_MAX_ITERATIONS: parseInt(process.env.AGENT_MAX_ITERATIONS || '8', 10),
  AGENT_TIMEOUT: parseInt(process.env.AGENT_TIMEOUT || '120000', 10),

  // Redis
  REDIS_URL: process.env.REDIS_URL,

  // Ingestion Pipeline
  SEPARATE_COLLECTIONS: process.env.SEPARATE_COLLECTIONS !== 'false',
  LEGACY_CODEBASE_COLLECTION: process.env.LEGACY_CODEBASE_COLLECTION !== 'false',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

export default config;
