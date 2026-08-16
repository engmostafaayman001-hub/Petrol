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

    supabase
      .from('profiles')
      .select('station_id')
      .eq('id', userId)
      .maybeSingle()
      .then((result: { data: { station_id?: string } | null; error: { message?: string } | null }) => {
        if (!mounted) return;
        const profile = result.data;
        if (result.error || !profile?.station_id) {
          setStationId(null);
          return;
        }
        setStationId(profile.station_id);
      })
      .catch(() => {
        if (mounted) setStationId(null);
      });

    return () => {
      mounted = false;
    };
  }, [userId]);

  return stationId;
}
