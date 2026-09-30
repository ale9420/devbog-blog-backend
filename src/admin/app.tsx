import type { StrapiApp } from '@strapi/strapi/admin';
import { ChartPie } from '@strapi/icons';

export default {
  config: {
    locales: [],
  },
  register(app: StrapiApp) {
    // Visitors synced from Umami (docs/ANALYTICS.md), on the admin homepage.
    app.widgets.register({
      id: 'visitors',
      icon: ChartPie,
      title: { id: 'bogdev.widgets.visitors.title', defaultMessage: 'Visitors' },
      component: async () => {
        const { VisitorsWidget } = await import('./components/VisitorsWidget');
        return VisitorsWidget;
      },
    });
  },
  bootstrap() {},
};
