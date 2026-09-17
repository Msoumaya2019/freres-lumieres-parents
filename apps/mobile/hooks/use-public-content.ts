import { useCallback, useEffect, useState } from 'react';

export function usePublicContent<T>(loader: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loader()
      .then((loadedItems) => {
        if (!active) return;
        setItems(loadedItems);
        setError('');
      })
      .catch(() => {
        if (active)
          setError('Impossible de charger les informations pour le moment.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loader]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await loader());
      setError('');
    } catch {
      setError('Impossible de charger les informations pour le moment.');
    } finally {
      setRefreshing(false);
    }
  }, [loader]);

  return {
    items,
    loading,
    refreshing,
    error,
    refresh: () => void refresh(),
  };
}
