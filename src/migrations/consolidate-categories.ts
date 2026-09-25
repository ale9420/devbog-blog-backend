import type { Core } from '@strapi/strapi';

const CATEGORY_UID = 'api::category.category';
const ARTICLE_UID = 'api::article.article';

export type CategoryKey = 'privacidad' | 'diy' | 'ia' | 'software' | 'linux';

export interface CategoryTarget {
  slug: string;
  /** Stable identifier the frontend paints the category with; never shown. */
  key: CategoryKey;
  name: string;
  /** English name, for when the frontend localizes it. Not stored. */
  nameEn: string;
  description: string;
  /** Common and scientific name of the category's bird. */
  bird: string;
  pillar: boolean;
  order: number;
  sources: string[];
}

/** The fields the migration keeps in sync on every target category. */
type CategoryFields = Pick<
  CategoryTarget,
  'slug' | 'key' | 'name' | 'description' | 'bird' | 'pillar' | 'order'
>;

export interface ConsolidationReport {
  created: string[];
  updated: string[];
  merged: Record<string, string>;
  removed: string[];
  uncategorized: number;
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
    nameEn: 'Privacy',
    bird: 'Pinchaflor (Diglossa cyanea)',
    pillar: true,
    order: 1,
    name: 'Privacidad',
    description: 'Soberanía digital, autoalojamiento y herramientas para cuidar tus datos.',
    sources: ['privacy'],
  },
  {
    slug: 'diy',
    key: 'diy',
    nameEn: 'DIY · Do it yourself',
    bird: 'Golondrina (Pygochelidon cyanoleuca)',
    pillar: true,
    order: 2,
    name: 'DIY · Hazlo tú mismo',
    description: 'Laboratorios locales, hardware y proyectos construidos en casa.',
    sources: [],
  },
  {
    slug: 'ia',
    key: 'ia',
    nameEn: 'Artificial intelligence',
    bird: 'Colibrí chillón (Colibri coruscans)',
    pillar: false,
    order: 3,
    name: 'Inteligencia artificial',
    description:
      'Modelos de lenguaje, RAG y cómo conectarlos con tus propios datos, sin depender de nadie.',
    sources: ['ia', 'rag'],
  },
  {
    slug: 'software',
    key: 'software',
    nameEn: 'Software development',
    bird: 'Mirla patinaranja (Turdus fuscater)',
    pillar: false,
    order: 4,
    name: 'Desarrollo de software',
    description:
      'Arquitectura frontend, rendimiento, accesibilidad y el camino que recorre el código hasta producción.',
    sources: ['web-development', 'mobile', 'devops'],
  },
  {
    slug: 'linux',
    key: 'linux',
    nameEn: 'Linux and open source',
    bird: 'Monjita bogotana (Chrysomus icterocephalus bogotensis)',
    pillar: false,
    order: 5,
    name: 'Linux y código abierto',
    description: 'Software libre como filosofía de transparencia y colaboración.',
    sources: ['linux', 'foss'],
  },
];

/** Legacy categories that stop existing; their articles are left without a category. */
export const REMOVED_CATEGORIES = ['tutorial'];

interface CategoryRow {
  id: number;
  documentId: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  key: CategoryKey | null;
  bird: string | null;
  pillar: boolean | null;
  order: number | null;
}

function fieldsOf(target: CategoryTarget): CategoryFields {
  const { slug, key, name, description, bird, pillar, order } = target;
  return { slug, key, name, description, bird, pillar, order };
}

function isInSync(category: CategoryRow, fields: CategoryFields): boolean {
  return (Object.keys(fields) as (keyof CategoryFields)[]).every(
    // SQLite returns booleans as 0/1, hence the loose comparison for `pillar`.
    (field) =>
      field === 'pillar'
        ? Boolean(category.pillar) === fields.pillar
        : category[field] === fields[field]
  );
}

function keyOf(category: CategoryRow): string {
  return (category.slug || category.name || '').trim().toLowerCase();
}

function joinTableOf(strapi: Core.Strapi): { name: string; categoryColumn: string } {
  const attribute = strapi.db.metadata.get(ARTICLE_UID).attributes.category as {
    joinTable?: { name: string; inverseJoinColumn: { name: string } };
  };
  if (!attribute.joinTable) {
    throw new Error('consolidate-categories: article.category has no join table');
  }
  return {
    name: attribute.joinTable.name,
    categoryColumn: attribute.joinTable.inverseJoinColumn.name,
  };
}

/**
 * Brings the categories to the five of the redesign, with their key, bird,
 * pillar flag and order. Idempotent: once the targets exist in sync and no
 * legacy rows remain, it changes nothing.
 * Articles are moved by rewriting the article → category join table, so the
 * draft and published rows of every locale move together and nothing gets
 * republished.
 */
export async function consolidateCategories(strapi: Core.Strapi): Promise<ConsolidationReport> {
  const report: ConsolidationReport = {
    created: [],
    updated: [],
    merged: {},
    removed: [],
    uncategorized: 0,
    untouched: [],
  };
  const categories = strapi.documents(CATEGORY_UID);
  const joinTable = joinTableOf(strapi);
  const knex = strapi.db.connection;

  const existing = (await strapi.db.query(CATEGORY_UID).findMany({
    select: ['id', 'documentId', 'name', 'slug', 'description', 'key', 'bird', 'pillar', 'order'],
    orderBy: { id: 'asc' },
  })) as CategoryRow[];
  const claimed = new Set<number>();

  for (const target of CATEGORY_TARGETS) {
    const matches = existing.filter(
      (category) => keyOf(category) === target.slug || target.sources.includes(keyOf(category))
    );
    const keeper =
      matches.find((category) => category.slug === target.slug) ??
      matches.find((category) => keyOf(category) === target.slug) ??
      matches[0];

    const fields = fieldsOf(target);
    let keeperId: number;
    if (keeper) {
      keeperId = keeper.id;
      if (!isInSync(keeper, fields)) {
        await categories.update({ documentId: keeper.documentId, data: fields });
        report.updated.push(target.slug);
      }
    } else {
      const created = await categories.create({ data: fields });
      keeperId = created.id as number;
      report.created.push(target.slug);
    }

    for (const match of matches) {
      claimed.add(match.id);
      if (match.id === keeperId) continue;
      await knex(joinTable.name)
        .where(joinTable.categoryColumn, match.id)
        .update({ [joinTable.categoryColumn]: keeperId });
      await categories.delete({ documentId: match.documentId });
      report.merged[match.name || match.slug || String(match.id)] = target.slug;
    }
  }

  for (const category of existing) {
    if (claimed.has(category.id)) continue;
    if (REMOVED_CATEGORIES.includes(keyOf(category))) {
      report.uncategorized += Number(
        await knex(joinTable.name).where(joinTable.categoryColumn, category.id).del()
      );
      await categories.delete({ documentId: category.documentId });
      report.removed.push(category.name || category.slug || String(category.id));
    } else {
      report.untouched.push(category.name || category.slug || String(category.id));
    }
  }

  return report;
}

export function hasChanges(report: ConsolidationReport): boolean {
  return (
    report.created.length > 0 ||
    report.updated.length > 0 ||
    Object.keys(report.merged).length > 0 ||
    report.removed.length > 0
  );
}
