import { createSlice } from '@reduxjs/toolkit';

export type SettingsState = Record<string, never>;

const initialState: SettingsState = {};

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {},
});

export const settingsReducer = settingsSlice.reducer;
