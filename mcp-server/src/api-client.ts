/**
 * API Client - Shared axios instance for RAG API calls.
 */

import axios from "axios";

export function createApiClient(ragApiUrl: string, projectName: string, projectPath: string) {
  return axios.create({
    baseURL: ragApiUrl,
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      "X-Project-Name": projectName,
      "X-Project-Path": projectPath,
    },
  });
}
