/**
 * API Client - Shared axios instance for RAG API calls.
 */

import axios from "axios";

export function createApiClient(ragApiUrl: string, projectName: string, projectPath: string, apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Project-Name": projectName,
    "X-Project-Path": projectPath,
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return axios.create({
    baseURL: ragApiUrl,
    timeout: 120000,
    headers,
  });
}
