import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BuilderConfigResponse, BuilderLlmRequest, BuilderLlmResponse, HealthResponse } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: getBackendApiBaseUrl(),
  }),
  endpoints: (builder) => ({
    config: builder.query<BuilderConfigResponse, void>({
      query: () => '/config',
    }),
    health: builder.query<HealthResponse, void>({
      query: () => '/health',
    }),
    generateApp: builder.mutation<BuilderLlmResponse, BuilderLlmRequest>({
      query: (body) => ({
        url: '/llm/generate',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const { useConfigQuery, useGenerateAppMutation, useHealthQuery } = apiSlice;
