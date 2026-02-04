/**
 * Embedding Service - Multi-provider support
 */

import axios from 'axios';
import config from '../config';
import { logger } from '../utils/logger';

export interface EmbeddingResult {
  embedding: number[];
  tokens?: number;
}

class EmbeddingService {
  private provider: string;

  constructor() {
    this.provider = config.EMBEDDING_PROVIDER;
  }

  async embed(text: string): Promise<number[]> {
    switch (this.provider) {
      case 'bge-m3-server':
        return this.embedWithBGE(text);
      case 'ollama':
        return this.embedWithOllama(text);
      case 'openai':
        return this.embedWithOpenAI(text);
      default:
        throw new Error(`Unknown embedding provider: ${this.provider}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // For BGE-M3 server, we can batch
    if (this.provider === 'bge-m3-server') {
      return this.embedBatchWithBGE(texts);
    }

    // Otherwise, embed one by one
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  private async embedWithBGE(text: string): Promise<number[]> {
    try {
      const response = await axios.post(`${config.BGE_M3_URL}/embed`, {
        text,
      });
      return response.data.embedding;
    } catch (error: any) {
      logger.error('BGE-M3 embedding failed', { error: error.message });
      throw error;
    }
  }

  private async embedBatchWithBGE(texts: string[]): Promise<number[][]> {
    try {
      const response = await axios.post(`${config.BGE_M3_URL}/embed_batch`, {
        texts,
      });
      return response.data.embeddings;
    } catch (error: any) {
      logger.error('BGE-M3 batch embedding failed', { error: error.message });
      throw error;
    }
  }

  private async embedWithOllama(text: string): Promise<number[]> {
    try {
      const response = await axios.post(`${config.OLLAMA_URL}/api/embeddings`, {
        model: config.OLLAMA_EMBEDDING_MODEL,
        prompt: text,
      });
      return response.data.embedding;
    } catch (error: any) {
      logger.error('Ollama embedding failed', { error: error.message });
      throw error;
    }
  }

  private async embedWithOpenAI(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: 'text-embedding-3-small',
          input: text,
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.data[0].embedding;
    } catch (error: any) {
      logger.error('OpenAI embedding failed', { error: error.message });
      throw error;
    }
  }
}

export const embeddingService = new EmbeddingService();
export default embeddingService;
