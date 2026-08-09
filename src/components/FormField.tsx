import React from 'react';

export default function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-right">
      <div className="text-sm font-medium mb-1">{label}</div>
      <div>{children}</div>
    </label>
  );
}

