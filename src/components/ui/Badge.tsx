import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'purple' | 'indigo' | 'cyan';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'slate',
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  const variantClasses = {
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    slate: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full border tracking-wide uppercase ${sizeClasses} ${variantClasses}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
};

export function getStatusBadge(status: string) {
  switch (status) {
    // Client Leads
    case 'Won':
      return <Badge variant="emerald">Won</Badge>;
    case 'Lost':
      return <Badge variant="slate">Lost</Badge>;
    case 'Quotation Sent':
      return <Badge variant="blue">Quotation Sent</Badge>;
    case 'Site Visit Scheduled':
      return <Badge variant="purple">Site Visit</Badge>;
    case 'New Inquiry':
      return <Badge variant="amber">New Inquiry</Badge>;

    // Quotations
    case 'Accepted':
      return <Badge variant="emerald">Accepted</Badge>;
    case 'Declined':
      return <Badge variant="rose">Declined</Badge>;
    case 'Sent':
      return <Badge variant="blue">Sent</Badge>;
    case 'Draft':
      return <Badge variant="slate">Draft</Badge>;
    case 'Expired':
      return <Badge variant="rose">Expired</Badge>;

    // Invoices
    case 'Paid':
      return <Badge variant="emerald">Paid</Badge>;
    case 'Partially Paid':
      return <Badge variant="amber">Partially Paid</Badge>;
    case 'Issued':
      return <Badge variant="blue">Issued</Badge>;
    case 'Overdue':
      return <Badge variant="rose">Overdue</Badge>;
    case 'Void':
      return <Badge variant="slate">Void</Badge>;

    // Projects
    case 'Ongoing':
      return <Badge variant="blue">Ongoing</Badge>;
    case 'Approved':
      return <Badge variant="indigo">Approved</Badge>;
    case 'Survey':
      return <Badge variant="purple">Survey</Badge>;
    case 'Planning':
      return <Badge variant="amber">Planning</Badge>;
    case 'Completed':
      return <Badge variant="emerald">Completed</Badge>;
    case 'Closed':
      return <Badge variant="slate">Closed</Badge>;

    default:
      return <Badge variant="slate">{status}</Badge>;
  }
}
