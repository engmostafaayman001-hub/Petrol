export function printDetails() {
  const details = document.querySelector<HTMLElement>('.modal-backdrop .modal-card');
  if (!details) return;
  const clone = details.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.no-print').forEach((element) => element.remove());
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) return;
  printWindow.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>تفاصيل العملية</title><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #172033; font-family: Cairo, Arial, sans-serif; direction: rtl; }
    body { padding: 0; }
    .modal-card { width: 100%; max-width: 720px; margin: 0 auto; padding: 28px; border: 1px solid #d9e1eb; border-radius: 10px; background: #fff; }
    .section-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 18px; margin-bottom: 12px; border-bottom: 2px solid #1769f5; }
    h3 { margin: 0; color: #102a43; font-size: 22px; font-weight: 800; }
    p { margin: 5px 0 0; color: #64748b; font-size: 13px; }
    .expense-details { display: grid; gap: 0; margin: 0; }
    .expense-details > div { display: flex; justify-content: space-between; gap: 20px; padding: 13px 0; border-bottom: 1px solid #e5eaf1; }
    .expense-details dt { color: #64748b; font-size: 13px; font-weight: 600; }
    .expense-details dd { max-width: 65%; margin: 0; color: #172033; font-size: 14px; font-weight: 800; text-align: left; overflow-wrap: anywhere; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eaf4fb; color: #1264a3; font-size: 12px; font-weight: 700; }
    @media print { .modal-card { max-width: none; border: 0; padding: 0; } }
  </style></head><body>${clone.outerHTML}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.setTimeout(() => {
    printWindow.print();
    printWindow.onafterprint = () => printWindow.close();
  }, 300);
}
