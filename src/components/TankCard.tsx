import React from 'react';
import { formatCompact, formatVolume } from '../core/units';

export default function TankCard({ tank }: { tank: any }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-sm dark:bg-slate-950 dark:shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-slate-600 dark:text-slate-200">{tank.tank_code} · {tank.tank_name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{tank.fuel_name} • {tank.fuel_code}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">{formatCompact(tank.system_quantity)}</div>
          <div className="text-xs text-slate-500">{formatVolume(tank.system_quantity, { unit: tank.display_unit_code ?? 'L' })}</div>
        </div>
      </div>

      <div className="mt-3 text-sm text-slate-600">
        <div>Available: {formatVolume(tank.available_quantity)}</div>
        <div>Measured: {tank.measured_quantity ?? '—'}</div>
        <div className="mt-2 text-xs text-slate-400">Status: {tank.status}</div>
      </div>
    </div>
  );
}
