import React, { ReactNode } from 'react';

/**
 * Skeleton loader for smooth content transitions.
 * Improves perceived performance while data loads.
 */
export function SkeletonLoader({ 
  width = '100%', 
  height = '24px', 
  count = 1, 
  className = '' 
}: {
  width?: string;
  height?: string;
  count?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-container ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ width, height, marginBottom: i < count - 1 ? '12px' : '0' }} />
      ))}
    </div>
  );
}

/**
 * Loading state for table rows
 */
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i}>
          <SkeletonLoader width="80%" height="16px" />
        </td>
      ))}
    </tr>
  );
}

/**
 * Loading state for card content
 */
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <SkeletonLoader height="20px" width="60%" />
      <SkeletonLoader height="16px" width="100%" count={2} />
      <SkeletonLoader height="32px" width="30%" />
    </div>
  );
}

/**
 * Suspense boundary with error handling
 */
export function SuspenseBoundary({ 
  children, 
  fallback = null 
}: { 
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <React.Suspense fallback={fallback || <SkeletonCard />}>
      {children}
    </React.Suspense>
  );
}
