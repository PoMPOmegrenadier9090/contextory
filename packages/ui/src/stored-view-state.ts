import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

// View preferences are device-local; unavailable or malformed storage never blocks a view.
export const useStoredViewState = <
  T extends string | boolean | null | string[],
>(
  storageKey: string | undefined,
  field: string,
  fallback: T,
  valid?: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] => {
  const key = storageKey === undefined ? undefined : `${storageKey}:${field}`;
  const read = (): T => {
    if (key === undefined) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const value: unknown = JSON.parse(raw);
      const matches = valid
        ? valid(value)
        : Array.isArray(fallback)
          ? Array.isArray(value) &&
            value.every((item) => typeof item === "string")
          : fallback === null
            ? value === null || typeof value === "string"
            : typeof value === typeof fallback;
      return matches ? (value as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  if (state.key !== key) setState({ key, value: read() });
  useEffect(() => {
    if (key === undefined || state.key !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state.value));
    } catch {
      /* Preferences are optional. */
    }
  }, [key, state]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setState((current) => ({
      ...current,
      value: typeof next === "function" ? next(current.value) : next,
    }));
  }, []);
  return [state.value, setValue];
};
