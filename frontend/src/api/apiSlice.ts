import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BuilderConfigResponse, HealthResponse, PromptsInfoResponse } from '@pages/Chat/builder/types';
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
    getPromptsInfo: builder.query<PromptsInfoResponse, void>({
      query: () => '/prompts/info',
    }),
  }),
});

export const { useConfigQuery, useGetPromptsInfoQuery, useHealthQuery } = apiSlice;
