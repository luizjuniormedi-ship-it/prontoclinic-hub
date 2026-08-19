import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Custom hook for debouncing a value.
 * Returns the debounced value after the specified delay.
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Custom hook for debouncing a callback function.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => unknown,
  delay: number = 300
): (...args: Args) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedFn = useCallback(
    (...args: Args) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callback(...args), delay);
    },
    [callback, delay]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return debouncedFn;
}
