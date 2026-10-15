'use client';

import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import type { ImportLossGroup, ImportLossSummary } from '@/pipes/commerce/import-loss-report';

export type InventoryImportLossReportProps = {
  summary: ImportLossSummary;
  onDownload?: () => void;
};

const SEVERITY_HEADING: Record<ImportLossGroup['severity'], string> = {
  skipped: 'Not imported',
  changed: 'Changed',
  dropped: 'Left behind',
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function MarketplaceInventoryImportLossReport({ summary, onDownload }: InventoryImportLossReportProps) {
  const headline = `${summary.listingsImported} of ${plural(summary.listingsRead, 'listing')} ready${
    summary.listingsSkipped > 0 ? `, ${summary.listingsSkipped} skipped` : ''
  }.`;
  const severities = (['skipped', 'changed', 'dropped'] as const).filter((severity) =>
    summary.groups.some((group) => group.severity === severity),
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Loss report" data-testid="inventory-import-loss-report">
      <div className="flex flex-col gap-1">
        <Typography as="h3" className="text-base font-semibold">
          Loss report
        </Typography>
        <Typography as="p" className="text-sm text-muted-foreground" data-testid="inventory-import-loss-headline">
          {headline}
        </Typography>
      </div>
      {summary.groups.length === 0 ? (
        <Typography as="p" className="text-sm text-muted-foreground">
          Nothing was left behind.
        </Typography>
      ) : (
        severities.map((severity) => (
          <div key={severity} className="flex flex-col gap-1.5">
            <Typography as="h4" className="text-sm font-medium">
              {SEVERITY_HEADING[severity]}
            </Typography>
            <ul className="flex flex-col gap-1.5 text-sm">
              {summary.groups
                .filter((group) => group.severity === severity)
                .map((group) => (
                  <li key={`${group.severity}:${group.code}`} className="flex flex-col">
                    <span>
                      <span className="font-medium">{group.label}</span>
                      <span className="text-muted-foreground"> · {group.count}</span>
                    </span>
                    <span className="text-muted-foreground">{group.detail}</span>
                    {group.examples.length > 0 && (
                      <span className="text-xs text-muted-foreground">e.g. {group.examples.join(', ')}</span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
      <div>
        <Button variant="secondary" className="rounded-full" onClick={onDownload}>
          Download loss report
        </Button>
      </div>
    </section>
  );
}
