import { useEffect, useState } from 'react';
import supabase from './supabaseClient';

export function useCurrentStationId(userId?: string | null) {
  const [stationId, setStationId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setStationId(null);
      return;
    }

    let mounted = true;

    const loadStation = async (attempt = 0): Promise<void> => {
      try {
        const result = await supabase.from('profiles').select('station_id').eq('id', userId).maybeSingle() as { data: { station_id?: string } | null; error: { message?: string } | null };
        if (!mounted) return;
        const profile = result.data;
        if (result.error || !profile?.station_id) {
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            return loadStation(attempt + 1);
          }
          setStationId(null);
          return;
        }
        setStationId(profile.station_id);
      } catch {
        if (mounted && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          return loadStation(attempt + 1);
        }
        if (mounted) setStationId(null);
      }
    };
    loadStation();

    return () => {
      mounted = false;
    };
  }, [userId]);

  return stationId;
}
