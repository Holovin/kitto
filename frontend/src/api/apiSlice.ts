import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getBackendBaseUrl } from '@helpers/environment';
import type { GenerateRequest, GenerateResponse, HealthResponse } from '@features/builder/api/contracts';

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: getBackendBaseUrl(),
  }),
  endpoints: (builder) => ({
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

export const { useGenerateMutation, useHealthQuery, useLazyHealthQuery } = apiSlice;
