/**
 * Data fetching hooks with caching and optimization
 */

import { useEffect, useRef, useState } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * useOptimizedFetch - Fetch data with caching and deduplication
 */
export function useOptimizedFetch<T>(
  url: string,
  options: { ttl?: number; skip?: boolean } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (options.skip) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      // Check cache first
      const cached = cache.get(url);
      if (cached && Date.now() - cached.timestamp < (cached.ttl || CACHE_TTL)) {
        setData(cached.data);
        setLoading(false);
        return;
      }

      abortControllerRef.current = new AbortController();
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) throw new Error(await response.text());

        const result = await response.json();
        cache.set(url, {
          data: result,
          timestamp: Date.now(),
          ttl: options.ttl || CACHE_TTL,
        });

        setData(result);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to fetch data');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => abortControllerRef.current?.abort();
  }, [url, options.skip]);

  return { data, loading, error, invalidate: () => cache.delete(url) };
}

/**
 * useParallelFetch - Fetch multiple endpoints in parallel with Promise.all
 */
export function useParallelFetch<T extends any[]>(
  urls: string[],
  options: { ttl?: number; skip?: boolean } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (options.skip) {
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          urls.map(async (url) => {
            const cached = cache.get(url);
            if (cached && Date.now() - cached.timestamp < (cached.ttl || CACHE_TTL)) {
              return cached.data;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed: ${url}`);

            const result = await response.json();
            cache.set(url, {
              data: result,
              timestamp: Date.now(),
              ttl: options.ttl || CACHE_TTL,
            });

            return result;
          })
        );

        setData(results as T);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [urls.join(','), options.skip]);

  return { data, loading, error };
}

/**
 * Clear all cache
 */
export function clearCache() {
  cache.clear();
}

/**
 * Invalidate specific cache entry
 */
export function invalidateCache(url: string) {
  cache.delete(url);
}
