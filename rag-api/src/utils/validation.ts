/**
 * Validation Schemas - Zod schemas for API input validation
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ============================================
// Common Schemas
// ============================================

export const projectNameSchema = z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, {
  message: 'Project name must contain only alphanumeric characters, dashes, and underscores',
});

export const collectionNameSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i);

export const limitSchema = z.number().int().min(1).max(100).default(5);

// ============================================
// Search Schemas
// ============================================

export const searchSchema = z.object({
  collection: collectionNameSchema,
  query: z.string().min(1).max(10000),
  limit: limitSchema.optional(),
  filters: z.object({
    language: z.string().optional(),
    path: z.string().optional(),
  }).optional(),
});

export const searchSimilarSchema = z.object({
  collection: collectionNameSchema,
  code: z.string().min(1).max(50000),
  limit: limitSchema.optional(),
});

export const askSchema = z.object({
  collection: collectionNameSchema,
  question: z.string().min(1).max(5000),
});

export const explainSchema = z.object({
  code: z.string().min(1).max(50000),
  collection: collectionNameSchema.optional(),
  filePath: z.string().optional(),
});

export const findFeatureSchema = z.object({
  collection: collectionNameSchema,
  description: z.string().min(1).max(2000),
});

// ============================================
// Index Schemas
// ============================================

export const indexSchema = z.object({
  projectName: projectNameSchema.optional(),
  path: z.string().min(1).optional(),
  force: z.boolean().default(false),
  patterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

export const indexConfluenceSchema = z.object({
  projectName: projectNameSchema.optional(),
  spaceKeys: z.array(z.string()).optional(),
  pageIds: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  maxPages: z.number().int().min(1).max(5000).default(500),
  force: z.boolean().default(false),
});

export const confluenceSearchSchema = z.object({
  cql: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(100).default(20),
});

// ============================================
// Memory Schemas
// ============================================

export const memoryTypeSchema = z.enum([
  'decision',
  'insight',
  'context',
  'todo',
  'conversation',
  'note',
]);

export const todoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'cancelled',
]);

export const createMemorySchema = z.object({
  projectName: projectNameSchema.optional(),
  content: z.string().min(1).max(50000),
  type: memoryTypeSchema.default('note'),
  tags: z.array(z.string().max(50)).max(20).optional(),
  relatedTo: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const recallMemorySchema = z.object({
  projectName: projectNameSchema.optional(),
  query: z.string().min(1).max(5000),
  type: z.union([memoryTypeSchema, z.literal('all')]).default('all'),
  limit: limitSchema.optional(),
  tag: z.string().max(50).optional(),
});

export const listMemorySchema = z.object({
  projectName: projectNameSchema.optional(),
  type: z.union([memoryTypeSchema, z.literal('all')]).optional(),
  tag: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const updateTodoSchema = z.object({
  projectName: projectNameSchema.optional(),
  status: todoStatusSchema,
  note: z.string().max(1000).optional(),
});

// ============================================
// Validation Middleware
// ============================================

export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Create a validation middleware for a Zod schema
 */
export function validate<T extends z.ZodType>(
  schema: T,
  target: ValidationTarget = 'body'
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = target === 'body' ? req.body :
                   target === 'query' ? req.query :
                   req.params;

      const validated = await schema.parseAsync(data);

      // Replace with validated data
      if (target === 'body') {
        req.body = validated;
      } else if (target === 'query') {
        (req as any).validatedQuery = validated;
      } else {
        (req as any).validatedParams = validated;
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Validate project name from headers or body
 */
export function validateProjectName(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const projectName = req.headers['x-project-name'] as string ||
                      req.body?.projectName ||
                      req.query?.projectName as string;

  if (!projectName) {
    return res.status(400).json({
      error: 'projectName is required (via X-Project-Name header or body/query)',
    });
  }

  const result = projectNameSchema.safeParse(projectName);
  if (!result.success) {
    return res.status(400).json({
      error: 'Invalid project name',
      details: result.error.errors,
    });
  }

  // Ensure consistent access
  req.body.projectName = projectName;
  next();
}

// Type exports for use in routes
export type SearchInput = z.infer<typeof searchSchema>;
export type SearchSimilarInput = z.infer<typeof searchSimilarSchema>;
export type AskInput = z.infer<typeof askSchema>;
export type ExplainInput = z.infer<typeof explainSchema>;
export type FindFeatureInput = z.infer<typeof findFeatureSchema>;
export type IndexInput = z.infer<typeof indexSchema>;
export type IndexConfluenceInput = z.infer<typeof indexConfluenceSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type RecallMemoryInput = z.infer<typeof recallMemorySchema>;
export type ListMemoryInput = z.infer<typeof listMemorySchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
