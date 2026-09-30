import { Box, Flex, Link, Typography } from '@strapi/design-system';
import { ExternalLink } from '@strapi/icons';
import { Widget, useFetchClient } from '@strapi/strapi/admin';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

interface WebsiteTotals {
  visitors: number;
  pageviews: number;
}

interface StatsSummary {
  configured: boolean;
  top: { documentId: string; locale: string; title: string | null; views30d: number }[];
  totals: { last7d: WebsiteTotals; last30d: WebsiteTotals } | null;
  syncedAt: string | null;
  dashboardUrl: string | null;
}

const ARTICLE_EDIT_PATH = '/content-manager/collection-types/api::article.article';
const numberFormat = new Intl.NumberFormat();
const ELLIPSIS = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function Total({ label, totals }: { label: string; totals: WebsiteTotals }) {
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Typography variant="beta">{numberFormat.format(totals.visitors)}</Typography>
      <Typography variant="pi" textColor="neutral600">
        {numberFormat.format(totals.pageviews)} page views
      </Typography>
    </Flex>
  );
}

export function VisitorsWidget() {
  const { get } = useFetchClient();
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    get<{ data: StatsSummary }>('/article-stats/summary')
      .then((response) => setSummary(response.data.data))
      .catch(() => setFailed(true));
  }, [get]);

  if (failed) return <Widget.Error />;
  if (!summary) return <Widget.Loading />;
  if (!summary.configured) {
    return <Widget.NoData>Umami isn't configured (UMAMI_URL).</Widget.NoData>;
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3} paddingRight={1}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
        {summary.totals ? (
          <Flex gap={6}>
            <Total label="Visitors, 7 days" totals={summary.totals.last7d} />
            <Total label="Visitors, 30 days" totals={summary.totals.last30d} />
          </Flex>
        ) : (
          <Typography variant="pi" textColor="neutral600">
            Umami didn't answer: site totals unavailable.
          </Typography>
        )}
        {summary.dashboardUrl && (
          <Link href={summary.dashboardUrl} isExternal endIcon={<ExternalLink />}>
            Umami
          </Link>
        )}
      </Flex>

      <Box>
        <Flex justifyContent="space-between" gap={2}>
          <Typography variant="sigma" textColor="neutral600">
            Most read, 30 days
          </Typography>
          <Typography variant="pi" textColor="neutral500">
            {summary.syncedAt
              ? `Synced ${new Date(summary.syncedAt).toLocaleString()}`
              : 'Not synced yet'}
          </Typography>
        </Flex>
        {summary.top.length === 0 ? (
          <Box paddingTop={2}>
            <Typography variant="omega" textColor="neutral600">
              No article visits yet.
            </Typography>
          </Box>
        ) : (
          <Flex tag="ol" direction="column" alignItems="stretch" gap={1} paddingTop={2}>
            {summary.top.map((article) => (
              <Flex
                tag="li"
                key={`${article.documentId}-${article.locale}`}
                justifyContent="space-between"
                gap={2}
              >
                <Box style={ELLIPSIS}>
                  <Link
                    tag={RouterLink}
                    to={`${ARTICLE_EDIT_PATH}/${article.documentId}?plugins[i18n][locale]=${article.locale}`}
                  >
                    {article.title ?? article.documentId} ({article.locale})
                  </Link>
                </Box>
                <Typography variant="omega" fontWeight="bold">
                  {numberFormat.format(article.views30d)}
                </Typography>
              </Flex>
            ))}
          </Flex>
        )}
      </Box>
    </Flex>
  );
}
