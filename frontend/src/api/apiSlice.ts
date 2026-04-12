import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getApiBaseUrl } from '@helpers/environment';
import type { GenerateRequest, GenerateResponse, HealthResponse, RuntimeConfigResponse } from '@features/builder/api/contracts';

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: getApiBaseUrl(),
  }),
  endpoints: (builder) => ({
    runtimeConfig: builder.query<RuntimeConfigResponse, void>({
      query: () => '/config',
    }),
    health: builder.query<HealthResponse, void>({
      query: () => '/health',
    }),
    generate: builder.mutation<GenerateResponse, GenerateRequest>({
      query: (body) => ({
        url: '/llm/generate',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const { useGenerateMutation, useHealthQuery, useLazyHealthQuery, useRuntimeConfigQuery } = apiSlice;
