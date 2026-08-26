import type { NextApiRequest, NextApiResponse } from "next";
import getServiceSupabase from "../../../src/lib/supabaseServer";
import { requireStationManager } from "../../../src/lib/reconciliationAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "الطريقة غير مسموحة." });
  const stationId = String(req.body?.station_id || req.query.stationId || "").trim();
  if (!stationId) return res.status(400).json({ error: "معرف المحطة مطلوب." });
  try {
    const actor = await requireStationManager(req, stationId);
    const db = getServiceSupabase();
    const { data, error } = await db.rpc("fn_backfill_meter_inventory", { p_station_id: stationId, p_actor: actor.id });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ processed_sessions: data || 0 });
  } catch (error: any) {
    return res.status(/المدير فقط|صلاحية|permission|insufficient/i.test(error.message || "") ? 403 : 400).json({ error: error.message || "تعذر إعادة معالجة خصومات العدادات." });
  }
}