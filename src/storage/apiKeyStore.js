import { LOCAL_STORAGE_API_KEY } from '../config/constants.js';

export function getApiKey() {
  return localStorage.getItem(LOCAL_STORAGE_API_KEY);
}

export function setApiKey(key) {
  localStorage.setItem(LOCAL_STORAGE_API_KEY, key.trim());
}

export function hasApiKey() {
  const key = getApiKey();
  return typeof key === 'string' && key.length > 0;
}

export function clearApiKey() {
  localStorage.removeItem(LOCAL_STORAGE_API_KEY);
}
