import type { Core } from '@strapi/strapi';

const CATEGORY_UID = 'api::category.category';
const ARTICLE_UID = 'api::article.article';

export type CategoryKey = 'privacidad' | 'diy' | 'ia' | 'software' | 'linux';

/** Locales the categories are translated into. Spanish is the blog's own language. */
export const CATEGORY_LOCALES = ['es', 'en'] as const;
export type CategoryLocale = (typeof CATEGORY_LOCALES)[number];

interface CategoryText {
  name: string;
  description: string;
}

export interface CategoryTarget {
  slug: string;
  /** Stable identifier the frontend paints the category with; never shown. */
  key: CategoryKey;
  /** Common and scientific name of the category's bird. */
  bird: string;
  pillar: boolean;
  order: number;
  /** Localized fields, per locale. */
  text: Record<CategoryLocale, CategoryText>;
  sources: string[];
}

export interface ConsolidationReport {
  created: string[];
  updated: string[];
  /** `<slug>:<locale>` of every localization created or brought in sync. */
  localized: string[];
  merged: Record<string, string>;
  removed: string[];
  uncategorized: number;
  /** Article rows moved to the category of their own locale. */
  relinked: number;
  untouched: string[];
}

/**
 * The five categories of the redesign (`docs/design/DESIGN.md` §3 in the
 * frontend), each with the legacy names or slugs it absorbs. Matching is
 * case-insensitive on the slug, falling back to the name for rows that never
 * had a slug.
 */
export const CATEGORY_TARGETS: CategoryTarget[] = [
  {
    slug: 'privacidad',
    key: 'privacidad',
    bird: 'Pinchaflor (Diglossa cyanea)',
    pillar: true,
    order: 1,
    text: {
      es: {
        name: 'Privacidad',
        description: 'Soberanía digital, autoalojamiento y herramientas para cuidar tus datos.',
      },
      en: {
        name: 'Privacy',
        description: 'Digital sovereignty, self-hosting and tools to take care of your data.',
      },
    },
    sources: ['privacy'],
  },
  {
    slug: 'diy',
    key: 'diy',
    bird: 'Golondrina (Pygochelidon cyanoleuca)',
    pillar: true,
    order: 2,
    text: {
      es: {
        name: 'DIY · Hazlo tú mismo',
        description: 'Laboratorios locales, hardware y proyectos construidos en casa.',
      },
      en: {
        name: 'DIY · Do it yourself',
        description: 'Local labs, hardware and projects built at home.',
      },
    },
    sources: [],
  },
  {
    slug: 'ia',
    key: 'ia',
    bird: 'Colibrí chillón (Colibri coruscans)',
    pillar: false,
    order: 3,
    text: {
      es: {
        name: 'Inteligencia artificial',
        description:
          'Modelos de lenguaje, RAG y cómo conectarlos con tus propios datos, sin depender de nadie.',
      },
      en: {
        name: 'Artificial intelligence',
        description:
          'Language models, RAG and how to connect them to your own data, without depending on anyone.',
      },
    },
    sources: ['ia', 'rag'],
  },
  {
    slug: 'software',
    key: 'software',
    bird: 'Mirla patinaranja (Turdus fuscater)',
    pillar: false,
    order: 4,
    text: {
      es: {
        name: 'Desarrollo de software',
        description:
          'Arquitectura frontend, rendimiento, accesibilidad y el camino que recorre el código hasta producción.',
      },
      en: {
        name: 'Software development',
        description:
          'Frontend architecture, performance, accessibility and the path code travels to production.',
      },
    },
    sources: ['web-development', 'mobile', 'devops'],
  },
  {
    slug: 'linux',
    key: 'linux',
    bird: 'Monjita bogotana (Chrysomus icterocephalus bogotensis)',
    pillar: false,
    order: 5,
    text: {
      es: {
        name: 'Linux y código abierto',
        description: 'Software libre como filosofía de transparencia y colaboración.',
      },
      en: {
        name: 'Linux and open source',
        description: 'Free software as a philosophy of transparency and collaboration.',
      },
    },
    sources: ['linux', 'foss'],
  },
];

/** Legacy categories that stop existing; their articles are left without a category. */
export const REMOVED_CATEGORIES = ['tutorial'];

interface CategoryRow {
  id: number;
  documentId: string;
  locale: string | null;
  name: string | null;
  slug: string | null;
  description: string | null;
  key: CategoryKey | null;
  bird: string | null;
  pillar: boolean | null;
  order: number | null;
}

/** Every row (one per locale) of a category document. */
interface CategoryDocument {
  documentId: string;
  /** The row in the default locale, or the first one: what matching looks at. */
  main: CategoryRow;
  rows: CategoryRow[];
}

type CategoryFields = Pick<CategoryRow, 'slug' | 'key' | 'bird' | 'pillar' | 'order'> &
  CategoryText;

function fieldsOf(target: CategoryTarget, locale: CategoryLocale): CategoryFields {
  const { slug, key, bird, pillar, order } = target;
  return { slug, key, bird, pillar, order, ...target.text[locale] };
}

function isInSync(row: CategoryRow, fields: CategoryFields): boolean {
  return (Object.keys(fields) as (keyof CategoryFields)[]).every(
    // SQLite returns booleans as 0/1, hence the loose comparison for `pillar`.
    (field) =>
      field === 'pillar' ? Boolean(row.pillar) === fields.pillar : row[field] === fields[field]
  );
}

function keyOf(category: CategoryRow): string {
  return (category.slug || category.name || '').trim().toLowerCase();
}

function labelOf(category: CategoryRow): string {
  return category.name || category.slug || String(category.id);
}

function isCategoryLocale(code: string): code is CategoryLocale {
  return (CATEGORY_LOCALES as readonly string[]).includes(code);
}

interface JoinTable {
  name: string;
  articleColumn: string;
  categoryColumn: string;
}

function joinTableOf(strapi: Core.Strapi): JoinTable {
  const attribute = strapi.db.metadata.get(ARTICLE_UID).attributes.category as {
    joinTable?: { name: string; joinColumn: { name: string }; inverseJoinColumn: { name: string } };
  };
  if (!attribute.joinTable) {
    throw new Error('consolidate-categories: article.category has no join table');
  }
  return {
    name: attribute.joinTable.name,
    articleColumn: attribute.joinTable.joinColumn.name,
    categoryColumn: attribute.joinTable.inverseJoinColumn.name,
  };
}

async function loadDocuments(strapi: Core.Strapi, defaultLocale: string) {
  const rows = (await strapi.db.query(CATEGORY_UID).findMany({
    select: [
      'id',
      'documentId',
      'locale',
      'name',
      'slug',
      'description',
      'key',
      'bird',
      'pillar',
      'order',
    ],
    orderBy: { id: 'asc' },
  })) as CategoryRow[];

  const documents = new Map<string, CategoryDocument>();
  for (const row of rows) {
    const document = documents.get(row.documentId);
    if (!document) {
      documents.set(row.documentId, { documentId: row.documentId, main: row, rows: [row] });
      continue;
    }
    document.rows.push(row);
    if (row.locale === defaultLocale && document.main.locale !== defaultLocale) {
      document.main = row;
    }
  }
  return [...documents.values()];
}

/**
 * Points every article row at the row of its category in the article's own
 * locale, when that localization exists. Categories were not localized before,
 * so English articles still point at the Spanish row.
 */
async function relinkByLocale(strapi: Core.Strapi, joinTable: JoinTable): Promise<number> {
  const knex = strapi.db.connection;
  const articleTable = strapi.db.metadata.get(ARTICLE_UID).tableName;
  const categoryTable = strapi.db.metadata.get(CATEGORY_UID).tableName;

  const links = (await knex(joinTable.name)
    .join(
      `${articleTable} as article`,
      `article.id`,
      `${joinTable.name}.${joinTable.articleColumn}`
    )
    .join(
      `${categoryTable} as category`,
      `category.id`,
      `${joinTable.name}.${joinTable.categoryColumn}`
    )
    .whereRaw('?? <> ??', ['article.locale', 'category.locale'])
    .select(
      `${joinTable.name}.id as linkId`,
      'article.locale as locale',
      'category.document_id as documentId'
    )) as { linkId: number; locale: string; documentId: string }[];

  let relinked = 0;
  for (const link of links) {
    const target = await knex(categoryTable)
      .where({ document_id: link.documentId, locale: link.locale })
      .first('id');
    if (!target) continue;
    await knex(joinTable.name)
      .where('id', link.linkId)
      .update({ [joinTable.categoryColumn]: target.id });
    relinked += 1;
  }
  return relinked;
}

/**
 * Brings the categories to the five of the redesign, with their key, bird,
 * pillar flag and order, translated into every configured locale among
 * `CATEGORY_LOCALES`. Idempotent: once the targets exist in sync and no legacy
 * rows remain, it changes nothing.
 * Articles are moved by rewriting the article → category join table, so the
 * draft and published rows of every locale move together and nothing gets
 * republished.
 */
export async function consolidateCategories(strapi: Core.Strapi): Promise<ConsolidationReport> {
  const report: ConsolidationReport = {
    created: [],
    updated: [],
    localized: [],
    merged: {},
    removed: [],
    uncategorized: 0,
    relinked: 0,
    untouched: [],
  };
  const categories = strapi.documents(CATEGORY_UID);
  const joinTable = joinTableOf(strapi);
  const knex = strapi.db.connection;
  const localesService = strapi.plugin('i18n').service('locales');

  const defaultLocale: string = await localesService.getDefaultLocale();
  // Spanish content goes in the default locale unless it is English itself.
  const mainLocale: CategoryLocale = defaultLocale === 'en' ? 'en' : 'es';
  const otherLocales = ((await localesService.find()) as { code: string }[])
    .map((locale) => locale.code)
    .filter((code): code is CategoryLocale => isCategoryLocale(code) && code !== defaultLocale);

  const existing = await loadDocuments(strapi, defaultLocale);
  const claimed = new Set<string>();

  for (const target of CATEGORY_TARGETS) {
    const matches = existing.filter(
      ({ main }) => keyOf(main) === target.slug || target.sources.includes(keyOf(main))
    );
    const keeper =
      matches.find(({ main }) => main.slug === target.slug) ??
      matches.find(({ main }) => keyOf(main) === target.slug) ??
      matches[0];

    let documentId: string;
    let keeperId: number;
    const mainFields = fieldsOf(target, mainLocale);
    if (keeper) {
      documentId = keeper.documentId;
      keeperId = keeper.main.id;
      if (!isInSync(keeper.main, mainFields)) {
        await categories.update({ documentId, locale: defaultLocale, data: mainFields });
        report.updated.push(target.slug);
      }
    } else {
      const created = await categories.create({ locale: defaultLocale, data: mainFields });
      documentId = created.documentId;
      keeperId = created.id as number;
      report.created.push(target.slug);
    }

    for (const locale of otherLocales) {
      const fields = fieldsOf(target, locale);
      const row = keeper?.rows.find((entry) => entry.locale === locale);
      if (row && isInSync(row, fields)) continue;
      // Updating a locale the document does not have yet creates that localization.
      await categories.update({ documentId, locale, data: fields });
      report.localized.push(`${target.slug}:${locale}`);
    }

    for (const match of matches) {
      claimed.add(match.documentId);
      if (match.documentId === documentId) continue;
      await knex(joinTable.name)
        .whereIn(
          joinTable.categoryColumn,
          match.rows.map((row) => row.id)
        )
        .update({ [joinTable.categoryColumn]: keeperId });
      await categories.delete({ documentId: match.documentId, locale: '*' });
      report.merged[labelOf(match.main)] = target.slug;
    }
  }

  for (const document of existing) {
    if (claimed.has(document.documentId)) continue;
    if (REMOVED_CATEGORIES.includes(keyOf(document.main))) {
      report.uncategorized += Number(
        await knex(joinTable.name)
          .whereIn(
            joinTable.categoryColumn,
            document.rows.map((row) => row.id)
          )
          .del()
      );
      await categories.delete({ documentId: document.documentId, locale: '*' });
      report.removed.push(labelOf(document.main));
    } else {
      report.untouched.push(labelOf(document.main));
    }
  }

  report.relinked = await relinkByLocale(strapi, joinTable);

  return report;
}

export function hasChanges(report: ConsolidationReport): boolean {
  return (
    report.created.length > 0 ||
    report.updated.length > 0 ||
    report.localized.length > 0 ||
    Object.keys(report.merged).length > 0 ||
    report.removed.length > 0 ||
    report.relinked > 0
  );
}
